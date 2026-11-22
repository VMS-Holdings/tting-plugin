import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { ReleaseError, isReleased, releaseAgent } from '../scripts/lib/release.mjs';
import { GIT_ENV, createOriginAndClone, git, writeTreeFiles } from '../test-support/git.mjs';

let root;
let origin;
let work;

async function writeBuilt(name, files) {
  const dir = join(root, name);
  await writeTreeFiles(dir, files);
  return dir;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tting-plugin-release-'));
  ({ origin, work } = await createOriginAndClone(root));
  Object.assign(process.env, GIT_ENV);
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test('push 를 켜지 않으면 원격에 아무것도 올리지 않는다', async () => {
  const builtDir = await writeBuilt('dry', { 'gemini-extension.json': '{"version":"0.1.0"}\n' });

  const result = await releaseAgent({ repoDir: work, agent: 'gemini', version: '0.1.0', builtDir, push: false });

  assert.equal(result.tag, 'gemini-v0.1.0');
  assert.equal(result.branch, 'release/gemini');
  assert.equal(result.pushed, false);
  assert.equal(await git(work, 'ls-remote', 'origin', 'refs/heads/release/gemini'), '');
  assert.equal(await git(work, 'ls-remote', 'origin', 'refs/tags/gemini-v0.1.0'), '');
});

test('릴리스 브랜치와 태그를 올리고, 브랜치에는 산출물만 담는다', async () => {
  const builtDir = await writeBuilt('first', {
    '.claude-plugin/plugin.json': '{"version":"0.1.0"}\n',
    'skills/using-tting/SKILL.md': 'skill\n',
  });

  const result = await releaseAgent({ repoDir: work, agent: 'claude', version: '0.1.0', builtDir, push: true });

  assert.equal(result.pushed, true);
  const branchHead = (await git(work, 'ls-remote', 'origin', 'refs/heads/release/claude')).split('\t')[0];
  const tagHead = (await git(work, 'ls-remote', 'origin', 'refs/tags/claude-v0.1.0')).split('\t')[0];
  assert.equal(branchHead, result.commit);
  assert.equal(tagHead, result.commit);
  const files = (await git(origin, 'ls-tree', '-r', '--name-only', 'release/claude')).split('\n').sort();
  assert.deepEqual(files, ['.claude-plugin/plugin.json', 'skills/using-tting/SKILL.md']);
  assert.equal(await git(origin, 'show', 'release/claude:.claude-plugin/plugin.json'), '{"version":"0.1.0"}');
});

test('릴리스 커밋은 어느 원본 커밋에서 지었는지 적는다', async () => {
  const source = await git(work, 'rev-parse', 'HEAD');

  const message = await git(origin, 'log', '-1', '--format=%B', 'release/claude');

  assert.match(message, /^release: claude v0\.1\.0\n/);
  assert.ok(message.includes(`Source: ${source}`), message);
});

test('다음 버전은 지난 릴리스 위에 쌓인다', async () => {
  const builtDir = await writeBuilt('second', { '.claude-plugin/plugin.json': '{"version":"0.2.0"}\n' });

  const result = await releaseAgent({ repoDir: work, agent: 'claude', version: '0.2.0', builtDir, push: true });

  assert.equal(await git(origin, 'rev-list', '--count', 'release/claude'), '2');
  assert.equal(await git(origin, 'rev-parse', 'release/claude'), result.commit);
  const files = (await git(origin, 'ls-tree', '-r', '--name-only', 'release/claude')).split('\n');
  assert.deepEqual(files, ['.claude-plugin/plugin.json']);
});

test('지난 릴리스를 받아 둔 적 없는 얕은 클론에서도 그 위에 쌓는다', async () => {
  const shallow = join(root, 'shallow');
  await git(root, 'clone', '-q', '--depth', '1', '--single-branch', '--branch', 'main', `file://${origin}`, shallow);
  const builtDir = await writeBuilt('third', { '.claude-plugin/plugin.json': '{"version":"0.3.0"}\n' });

  const result = await releaseAgent({ repoDir: shallow, agent: 'claude', version: '0.3.0', builtDir, push: true });

  assert.equal(await git(origin, 'rev-list', '--count', 'release/claude'), '3');
  assert.equal(await git(origin, 'rev-parse', 'release/claude'), result.commit);
});

test('개인 전역 ignore 가 산출물의 파일을 빼지 못한다', async () => {
  const builtDir = await writeBuilt('ignored', { 'gemini-extension.json': '{"version":"0.4.0"}\n', 'README.md': 'readme\n' });
  await writeFile(join(root, 'global-ignore'), '*.json\n');
  await writeFile(join(root, 'global-config'), `[core]\n\texcludesFile = ${join(root, 'global-ignore')}\n`);
  process.env.GIT_CONFIG_GLOBAL = join(root, 'global-config');

  try {
    await releaseAgent({ repoDir: work, agent: 'gemini', version: '0.4.0', builtDir, push: true });
  } finally {
    process.env.GIT_CONFIG_GLOBAL = GIT_ENV.GIT_CONFIG_GLOBAL;
  }

  const files = (await git(origin, 'ls-tree', '-r', '--name-only', 'release/gemini')).split('\n').sort();
  assert.deepEqual(files, ['README.md', 'gemini-extension.json']);
});

test('이미 낸 버전은 다시 낼 수 없다', async () => {
  const builtDir = await writeBuilt('again', { '.claude-plugin/plugin.json': '{"version":"0.2.0"}\n' });

  await assert.rejects(
    releaseAgent({ repoDir: work, agent: 'claude', version: '0.2.0', builtDir, push: true }),
    (error) => error instanceof ReleaseError && /claude-v0\.2\.0/.test(error.message),
  );
});

test('에이전트끼리 브랜치와 태그가 섞이지 않는다', async () => {
  const builtDir = await writeBuilt('codex', { 'plugins/tting/plugin.json': '{"version":"0.1.0"}\n' });

  await releaseAgent({ repoDir: work, agent: 'codex', version: '0.1.0', builtDir, push: true });

  assert.equal(await git(origin, 'rev-list', '--count', 'release/codex'), '1');
  assert.equal(await git(origin, 'rev-list', '--count', 'release/claude'), '3');
});

test('작업 중인 브랜치와 작업 트리를 건드리지 않는다', async () => {
  assert.equal(await git(work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(await git(work, 'status', '--porcelain'), '');
});

test('빈 산출물은 릴리스하지 않는다', async () => {
  const builtDir = join(root, 'empty');
  await mkdir(builtDir, { recursive: true });

  await assert.rejects(
    releaseAgent({ repoDir: work, agent: 'grok', version: '0.1.0', builtDir, push: false }),
    ReleaseError,
  );
});

test('커밋하지 않은 변경이 있으면 올리지 않는다. 올리지 않는 미리보기는 된다', async () => {
  const builtDir = await writeBuilt('dirty', { 'gemini-extension.json': '{"version":"0.5.0"}\n' });
  await writeFile(join(work, 'uncommitted.txt'), 'wip\n');

  try {
    await assert.rejects(
      releaseAgent({ repoDir: work, agent: 'gemini', version: '0.5.0', builtDir, push: true }),
      (error) => error instanceof ReleaseError && /uncommitted\.txt/.test(error.message),
    );
    const preview = await releaseAgent({ repoDir: work, agent: 'gemini', version: '0.5.0', builtDir, push: false });
    assert.equal(preview.pushed, false);
  } finally {
    await rm(join(work, 'uncommitted.txt'));
  }
  assert.equal(await git(work, 'ls-remote', 'origin', 'refs/tags/gemini-v0.5.0'), '');
});

test('이름 끝만 같은 다른 ref 를 릴리스 태그로 잘못 읽지 않는다', async () => {
  await git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/mirror/refs/tags/gemini-v7.0.0');

  assert.equal(await isReleased({ repoDir: work, agent: 'gemini', version: '7.0.0' }), false);
});

test('옵션처럼 보이는 원격 이름은 거절한다', async () => {
  const builtDir = await writeBuilt('remote', { 'gemini-extension.json': '{"version":"0.6.0"}\n' });

  await assert.rejects(
    releaseAgent({ repoDir: work, agent: 'gemini', version: '0.6.0', builtDir, remote: '--upload-pack=x' }),
    ReleaseError,
  );
  await assert.rejects(isReleased({ repoDir: work, agent: 'gemini', version: '0.6.0', remote: '-x' }), ReleaseError);
});

test('커밋이 하나도 없는 저장소에서는 릴리스하지 않는다', async () => {
  const empty = join(root, 'unborn');
  await git(root, 'init', '-q', '-b', 'main', empty);
  await git(empty, 'remote', 'add', 'origin', origin);
  const builtDir = await writeBuilt('unborn-built', { 'gemini-extension.json': '{"version":"0.7.0"}\n' });

  await assert.rejects(
    releaseAgent({ repoDir: empty, agent: 'gemini', version: '0.7.0', builtDir, push: false }),
    ReleaseError,
  );
});

test('원격 main 의 끝이 아닌 커밋에서는 올리지 않는다. 미리보기는 된다', async () => {
  const ahead = join(root, 'ahead');
  await git(root, 'clone', '-q', origin, ahead);
  await writeFile(join(ahead, 'unreviewed.txt'), 'wip\n');
  await git(ahead, 'add', '.');
  await git(ahead, 'commit', '-q', '-m', 'feat: unreviewed');
  const builtDir = await writeBuilt('ahead-built', { 'gemini-extension.json': '{"version":"0.8.0"}\n' });

  await assert.rejects(
    releaseAgent({ repoDir: ahead, agent: 'gemini', version: '0.8.0', builtDir, push: true }),
    (error) => error instanceof ReleaseError && /main/.test(error.message),
  );
  const preview = await releaseAgent({ repoDir: ahead, agent: 'gemini', version: '0.8.0', builtDir, push: false });

  assert.equal(preview.pushed, false);
  assert.equal(await git(work, 'ls-remote', 'origin', 'refs/tags/gemini-v0.8.0'), '');
});
