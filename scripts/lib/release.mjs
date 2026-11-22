import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { IGNORED_FILES } from './build.mjs';
import { releaseBranch, releaseTag } from './targets.mjs';

const run = promisify(execFile);
const DEFAULT_REMOTE = 'origin';
/** 릴리스의 원본이 되는 브랜치. 검토를 거친 커밋만 나가게 하려고 이 브랜치의 끝에서만 올린다. */
const SOURCE_BRANCH = 'main';
const PARENT_DIR = '..';
const OPTION_PREFIX = '-';
const LS_REMOTE_SEPARATOR = '\t';

export class ReleaseError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ReleaseError';
  }
}

async function git(cwd, args, env = {}) {
  const { stdout } = await run('git', args, { cwd, env: { ...process.env, ...env } });
  return stdout.trim();
}

/** 원격 이름은 git 명령의 인자로 그대로 들어간다. `-` 로 시작하면 git 이 옵션으로 읽는다. */
function assertRemote(remote) {
  if (typeof remote !== 'string' || remote === '' || remote.startsWith(OPTION_PREFIX)) {
    throw new ReleaseError(`원격 이름이 올바르지 않다: ${remote}`);
  }
}

/**
 * 원격에서 그 이름의 ref 가 가리키는 커밋을 찾는다. `ls-remote` 는 이름의 끝이 같은 ref 도 함께
 * 돌려주므로, 이름이 정확히 같은 줄만 고른다.
 */
async function remoteSha(repoDir, remote, ref) {
  assertRemote(remote);
  const output = await git(repoDir, ['ls-remote', remote, ref]);
  const match = output
    .split('\n')
    .map((line) => line.split(LS_REMOTE_SEPARATOR))
    .find(([, name]) => name === ref);
  return match?.[0];
}

export async function isReleased({ repoDir, agent, version, remote = DEFAULT_REMOTE }) {
  return (await remoteSha(repoDir, remote, `refs/tags/${releaseTag(agent, version)}`)) !== undefined;
}

/** 지난 릴리스 위에 쌓으려고 그 커밋을 받아 온다. 첫 릴리스면 부모가 없다. */
async function fetchParent(repoDir, remote, branch) {
  const ref = `refs/heads/${branch}`;
  const sha = await remoteSha(repoDir, remote, ref);
  if (sha === undefined) return undefined;
  await git(repoDir, ['fetch', '--quiet', '--no-tags', remote, ref]);
  return sha;
}

/** 릴리스가 어느 원본에서 나왔는지 남기려고 지금 체크아웃한 커밋을 읽는다. */
async function sourceCommit(repoDir) {
  try {
    return await git(repoDir, ['rev-parse', '--verify', 'HEAD']);
  } catch (error) {
    throw new ReleaseError('원본 저장소에 커밋이 없다. 먼저 커밋한다', { cause: error });
  }
}

/** 산출물은 작업 트리에서 짓는다. 커밋하지 않은 변경이 있으면 원본 커밋과 다른 것이 나간다. */
async function assertCleanTree(repoDir) {
  const changes = await git(repoDir, ['status', '--porcelain']);
  if (changes !== '') {
    throw new ReleaseError(`커밋하지 않은 변경이 있어 올리지 않는다. 커밋하거나 치운다:\n${changes}`);
  }
}

/** 원격 원본 브랜치의 끝이 아닌 커밋(올리지 않은 작업 브랜치, 뒤처진 main)에서는 올리지 않는다. */
async function assertSourceIsRemoteHead(repoDir, remote, source) {
  const head = await remoteSha(repoDir, remote, `refs/heads/${SOURCE_BRANCH}`);
  if (head !== source) {
    throw new ReleaseError(
      `${remote} 의 ${SOURCE_BRANCH} 끝(${head ?? '없음'})에서만 올린다. 지금 커밋은 ${source} 다`,
    );
  }
}

/**
 * 짓기는 작업 트리를 읽는다. git 이 무시하는 파일은 `git status` 에 보이지 않아 깨끗한 트리 검사를
 * 지나가므로, 원본 폴더에 그런 파일이 있는지 따로 본다.
 */
export async function assertNoIgnoredFiles(repoDir, sourceDir) {
  const path = relative(repoDir, sourceDir);
  if (path === '' || path.startsWith(PARENT_DIR) || isAbsolute(path)) {
    throw new ReleaseError(`원본 폴더가 저장소 안에 있어야 한다: ${sourceDir}`);
  }
  const listed = await git(repoDir, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', path]);
  const ignored = listed.split('\n').filter((file) => file !== '' && !IGNORED_FILES.has(basename(file)));
  if (ignored.length > 0) {
    throw new ReleaseError(`git 이 무시하는 파일이 ${path} 에 있어 올리지 않는다. 지운다:\n${ignored.join('\n')}`);
  }
}

/**
 * 산출물 디렉터리를 트리 객체로 만든다. 임시 인덱스를 써서 작업 중인 브랜치와 작업 트리, 인덱스를
 * 건드리지 않는다. `--force` 는 개인 전역 ignore 가 산출물을 빼지 못하게 하려는 것이다.
 */
async function writeTree(repoDir, builtDir) {
  const gitDir = await git(repoDir, ['rev-parse', '--absolute-git-dir']);
  const scratch = await mkdtemp(join(tmpdir(), 'tting-plugin-index-'));
  const env = { GIT_DIR: gitDir, GIT_WORK_TREE: builtDir, GIT_INDEX_FILE: join(scratch, 'index') };
  try {
    await git(builtDir, ['add', '--all', '--force', '.'], env);
    return await git(builtDir, ['write-tree'], env);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * 산출물을 그 에이전트의 릴리스 브랜치에 커밋 하나로 쌓고 버전 태그를 단다.
 * `push` 가 꺼져 있으면 커밋 객체만 만들고 원격에는 아무것도 올리지 않는다.
 */
export async function releaseAgent({ repoDir, agent, version, builtDir, remote = DEFAULT_REMOTE, push = false }) {
  const branch = releaseBranch(agent);
  const tag = releaseTag(agent, version);

  if ((await readdir(builtDir)).length === 0) {
    throw new ReleaseError(`${agent}: 산출물이 비어 있다 (${builtDir})`);
  }
  if (await isReleased({ repoDir, agent, version, remote })) {
    throw new ReleaseError(
      `${tag} 는 이미 릴리스됐다. plugin.config.json 의 agents.${agent}.version 을 올린다`,
    );
  }
  const source = await sourceCommit(repoDir);
  if (push) {
    await assertCleanTree(repoDir);
    await assertSourceIsRemoteHead(repoDir, remote, source);
  }

  const parent = await fetchParent(repoDir, remote, branch);
  const tree = await writeTree(repoDir, builtDir);
  const parentArgs = parent === undefined ? [] : ['-p', parent];
  const messageArgs = ['-m', `release: ${agent} v${version}`, '-m', `Source: ${source}`];
  const commit = await git(repoDir, ['commit-tree', tree, ...parentArgs, ...messageArgs]);

  if (push) {
    await git(repoDir, [
      'push',
      '--atomic',
      remote,
      `${commit}:refs/heads/${branch}`,
      `${commit}:refs/tags/${tag}`,
    ]);
  }
  return { agent, version, branch, tag, commit, source, pushed: push };
}
