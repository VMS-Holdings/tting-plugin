import { readdir } from 'node:fs/promises';
import { basename, isAbsolute, relative } from 'node:path';
import { IGNORED_FILES } from './build.mjs';
import { git, writeTree } from './git.mjs';
import { releaseBranch, releaseTag } from './targets.mjs';

const DEFAULT_REMOTE = 'origin';
const SOURCE_BRANCH = 'main';
const OPTION_PREFIX = '-';
const PARENT_DIR = '..';
const LS_REMOTE_SEPARATOR = '\t';

export class ReleaseError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ReleaseError';
  }
}

/** 원격 이름은 git 명령의 인자로 그대로 들어간다. `-` 로 시작하면 git 이 옵션으로 읽는다. */
function assertRemote(remote) {
  if (typeof remote !== 'string' || remote === '' || remote.startsWith(OPTION_PREFIX)) {
    throw new ReleaseError(`원격 이름이 올바르지 않다: ${remote}`);
  }
}

// `ls-remote` 는 이름의 끝만 같은 ref 도 돌려준다. 이름이 정확히 같은 줄만 고른다.
async function remoteSha(repoDir, remote, ref) {
  assertRemote(remote);
  const output = await git(repoDir, ['ls-remote', remote, ref]);
  const match = output
    .split('\n')
    .map((line) => line.split(LS_REMOTE_SEPARATOR))
    .find(([, name]) => name === ref);
  return match?.[0];
}

async function fetchParent(repoDir, remote, branch) {
  const ref = `refs/heads/${branch}`;
  const sha = await remoteSha(repoDir, remote, ref);
  if (sha === undefined) return undefined;
  await git(repoDir, ['fetch', '--quiet', '--no-tags', remote, ref]);
  return sha;
}

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

async function assertSourceIsRemoteHead(repoDir, remote, source) {
  const head = await remoteSha(repoDir, remote, `refs/heads/${SOURCE_BRANCH}`);
  if (head !== source) {
    throw new ReleaseError(
      `${remote} 의 ${SOURCE_BRANCH} 끝(${head ?? '없음'})에서만 올린다. 지금 커밋은 ${source} 다`,
    );
  }
}

// git 이 무시하는 파일은 `git status` 에 안 보여 깨끗한 트리 검사를 지나가지만, 짓기는 그 파일도 읽는다.
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

function releaseSubject(agent, version) {
  return `release: ${agent} v${version}`;
}

function sourceLine(source) {
  return `Source: ${source}`;
}

// 태그만 손으로 먼저 달린 경우를 거른다. 그대로 건너뛰면 브랜치는 옛 내용인 채 버전만 써 버린다.
async function assertBranchesReleased({ repoDir, builds, version, source, remote }) {
  for (const { agent } of builds) {
    const branch = releaseBranch(agent);
    const head = await fetchParent(repoDir, remote, branch);
    const grep = ['--fixed-strings', `--grep=${sourceLine(source)}`, '--format=%s'];
    const subjects = head === undefined ? '' : await git(repoDir, ['log', ...grep, head]);
    if (!subjects.split('\n').includes(releaseSubject(agent, version))) {
      throw new ReleaseError(`${releaseTag(version)} 태그는 있는데 ${branch} 에 이 릴리스가 없다. 태그를 누가 달았는지 확인한다`);
    }
  }
}

async function commitBuild({ repoDir, build, version, source, remote }) {
  if ((await readdir(build.dir)).length === 0) {
    throw new ReleaseError(`${build.agent}: 산출물이 비어 있다 (${build.dir})`);
  }
  const branch = releaseBranch(build.agent);
  const parent = await fetchParent(repoDir, remote, branch);
  const tree = await writeTree(repoDir, build.dir);
  const parentArgs = parent === undefined ? [] : ['-p', parent];
  const messageArgs = ['-m', releaseSubject(build.agent, version), '-m', sourceLine(source)];
  const commit = await git(repoDir, ['commit-tree', tree, ...parentArgs, ...messageArgs]);
  return { agent: build.agent, branch, commit };
}

async function commitBuilds(options) {
  // 얕은 클론에서 fetch 를 겹쳐 돌리면 shallow 잠금이 부딪힌다. 하나씩 한다.
  let agents = [];
  for (const build of options.builds) {
    agents = [...agents, await commitBuild({ ...options, build })];
  }
  return agents;
}

export async function publishRelease({ repoDir, version, builds, remote = DEFAULT_REMOTE, push = false }) {
  const tag = releaseTag(version);
  const source = await sourceCommit(repoDir);
  const released = await remoteSha(repoDir, remote, `refs/tags/${tag}`);
  const identity = { version, tag, source };

  // 같은 실행을 다시 돌린 경우다. 올리지 않고 넘겨서 뒤 단계가 빠진 것을 채우게 한다.
  if (released === source) {
    await assertBranchesReleased({ repoDir, builds, version, source, remote });
    return { ...identity, pushed: false, skipped: true, agents: [] };
  }
  if (released !== undefined) {
    throw new ReleaseError(
      `${tag} 는 이미 다른 커밋(${released})에서 릴리스됐다. 새로 내려면 plugin.config.json 의 version 을 올린다. ` +
        'GitHub Release 만 빠졌다면 태그를 올린 실행을 다시 돌린다(Re-run)',
    );
  }
  if (push) {
    await assertCleanTree(repoDir);
    await assertSourceIsRemoteHead(repoDir, remote, source);
  }

  const agents = await commitBuilds({ repoDir, builds, version, source, remote });
  if (push) {
    const branches = agents.map(({ branch, commit }) => `${commit}:refs/heads/${branch}`);
    await git(repoDir, ['push', '--atomic', remote, ...branches, `${source}:refs/tags/${tag}`]);
  }
  return { ...identity, pushed: push, skipped: false, agents };
}
