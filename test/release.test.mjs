import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { ReleaseError, publishRelease } from '../scripts/lib/release.mjs';
import { GIT_ENV, createOriginAndClone, git, writeTreeFiles } from '../test-support/git.mjs';

const VERSION = '26.11.23.0';
const NEXT_VERSION = '26.11.23.1';
const TAG = 'v26.11.23.0';
const TREES = Object.freeze({
  claude: { '.claude-plugin/plugin.json': '{"agent":"claude"}\n', 'skills/using-tting/SKILL.md': 'skill\n' },
  gemini: { 'gemini-extension.json': '{"agent":"gemini"}\n' },
});
const REJECT_GEMINI_HOOK = '#!/bin/sh\ncase "$1" in refs/heads/release/gemini) exit 1 ;; esac\n';

let root;

function createRepo(name) {
  return createOriginAndClone(join(root, name));
}

async function writeBuilds(name, trees = TREES) {
  const agents = Object.keys(trees);
  for (const agent of agents) await writeTreeFiles(join(root, name, 'built', agent), trees[agent]);
  return agents.map((agent) => ({ agent, dir: join(root, name, 'built', agent) }));
}

function releaseRefs(repo) {
  return git(repo, 'ls-remote', 'origin', 'refs/heads/release/*', 'refs/tags/*');
}

async function filesOf(origin, ref) {
  return (await git(origin, 'ls-tree', '-r', '--name-only', ref)).split('\n').sort();
}

async function commitAndPushMain(work, file) {
  await writeFile(join(work, file), 'more\n');
  await git(work, 'add', '.');
  await git(work, 'commit', '-q', '-m', 'feat: more');
  await git(work, 'push', '-q', 'origin', 'HEAD:main');
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tting-plugin-release-'));
  Object.assign(process.env, GIT_ENV);
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test('push 를 켜지 않으면 원격에 아무것도 올리지 않는다', async () => {
  const { work } = await createRepo('preview');
  const builds = await writeBuilds('preview');

  const release = await publishRelease({ repoDir: work, version: VERSION, builds });

  assert.equal(release.tag, TAG);
  assert.equal(release.pushed, false);
  assert.equal(release.skipped, false);
  assert.deepEqual(
    release.agents.map(({ agent, branch }) => ({ agent, branch })),
    [
      { agent: 'claude', branch: 'release/claude' },
      { agent: 'gemini', branch: 'release/gemini' },
    ],
  );
  assert.equal(await releaseRefs(work), '');
});

test('브랜치는 에이전트마다, 태그는 원본 커밋에 하나 올린다', async () => {
  const { origin, work } = await createRepo('push');
  const builds = await writeBuilds('push');
  const source = await git(work, 'rev-parse', 'HEAD');

  const release = await publishRelease({ repoDir: work, version: VERSION, builds, push: true });

  assert.equal(release.pushed, true);
  assert.equal(release.source, source);
  assert.equal(await git(origin, 'rev-parse', `refs/tags/${TAG}`), source);
  for (const { branch, commit } of release.agents) {
    assert.equal(await git(origin, 'rev-parse', branch), commit);
  }
  assert.deepEqual(await filesOf(origin, 'release/claude'), ['.claude-plugin/plugin.json', 'skills/using-tting/SKILL.md']);
  assert.deepEqual(await filesOf(origin, 'release/gemini'), ['gemini-extension.json']);
});

test('릴리스 커밋은 어느 원본 커밋에서 지었는지 적는다', async () => {
  const { origin, work } = await createRepo('message');
  const builds = await writeBuilds('message');
  const source = await git(work, 'rev-parse', 'HEAD');
  await publishRelease({ repoDir: work, version: VERSION, builds, push: true });

  const message = await git(origin, 'log', '-1', '--format=%B', 'release/claude');

  assert.match(message, /^release: claude v26\.11\.23\.0\n/);
  assert.ok(message.includes(`Source: ${source}`), message);
});

test('다음 버전은 지난 릴리스 위에 쌓인다', async () => {
  const { origin, work } = await createRepo('stack');
  await publishRelease({ repoDir: work, version: VERSION, builds: await writeBuilds('stack'), push: true });
  const next = await writeBuilds('stack-next', { claude: { '.claude-plugin/plugin.json': '{"next":true}\n' } });

  const release = await publishRelease({ repoDir: work, version: NEXT_VERSION, builds: next, push: true });

  assert.equal(await git(origin, 'rev-list', '--count', 'release/claude'), '2');
  assert.equal(await git(origin, 'rev-parse', 'release/claude'), release.agents[0].commit);
  assert.deepEqual(await filesOf(origin, 'release/claude'), ['.claude-plugin/plugin.json']);
  assert.equal(await git(origin, 'rev-list', '--count', 'release/gemini'), '1');
});

test('지난 릴리스를 받아 둔 적 없는 얕은 클론에서도 그 위에 쌓는다', async () => {
  const { origin, work } = await createRepo('shallow');
  await publishRelease({ repoDir: work, version: VERSION, builds: await writeBuilds('shallow'), push: true });
  const shallow = join(root, 'shallow', 'clone');
  await git(root, 'clone', '-q', '--depth', '1', '--single-branch', '--branch', 'main', `file://${origin}`, shallow);

  await publishRelease({ repoDir: shallow, version: NEXT_VERSION, builds: await writeBuilds('shallow-next'), push: true });

  assert.equal(await git(origin, 'rev-list', '--count', 'release/claude'), '2');
});

test('개인 전역 ignore 가 산출물의 파일을 빼지 못한다', async () => {
  const { origin, work } = await createRepo('ignore');
  const builds = await writeBuilds('ignore', { gemini: { 'gemini-extension.json': '{}\n', 'README.md': 'readme\n' } });
  await writeFile(join(root, 'ignore', 'global-ignore'), '*.json\n');
  await writeFile(join(root, 'ignore', 'global-config'), `[core]\n\texcludesFile = ${join(root, 'ignore', 'global-ignore')}\n`);
  process.env.GIT_CONFIG_GLOBAL = join(root, 'ignore', 'global-config');

  try {
    await publishRelease({ repoDir: work, version: VERSION, builds, push: true });
  } finally {
    process.env.GIT_CONFIG_GLOBAL = GIT_ENV.GIT_CONFIG_GLOBAL;
  }

  assert.deepEqual(await filesOf(origin, 'release/gemini'), ['README.md', 'gemini-extension.json']);
});

test('같은 커밋에서 이미 나간 버전은 다시 올리지 않고 건너뛴다', async () => {
  const { origin, work } = await createRepo('again');
  const builds = await writeBuilds('again');
  await publishRelease({ repoDir: work, version: VERSION, builds, push: true });

  const release = await publishRelease({ repoDir: work, version: VERSION, builds, push: true });

  assert.equal(release.skipped, true);
  assert.equal(release.pushed, false);
  assert.equal(await git(origin, 'rev-list', '--count', 'release/claude'), '1');
});

test('다른 커밋에서 이미 나간 버전은 거절한다', async () => {
  const { origin, work } = await createRepo('taken');
  const builds = await writeBuilds('taken');
  await publishRelease({ repoDir: work, version: VERSION, builds, push: true });
  await commitAndPushMain(work, 'more.txt');

  await assert.rejects(
    publishRelease({ repoDir: work, version: VERSION, builds, push: true }),
    (error) =>
      error instanceof ReleaseError &&
      /v26\.11\.23\.0/.test(error.message) &&
      /version/.test(error.message) &&
      /Re-run/.test(error.message),
  );
  assert.equal(await git(origin, 'rev-list', '--count', 'release/claude'), '1');
});

test('main 이 앞서 나간 뒤에도 릴리스한 커밋에서 다시 돌리면 건너뛴다', async () => {
  const { origin, work } = await createRepo('moved');
  const builds = await writeBuilds('moved');
  await publishRelease({ repoDir: work, version: VERSION, builds, push: true });
  const other = join(root, 'moved', 'other');
  await git(root, 'clone', '-q', origin, other);
  await commitAndPushMain(other, 'more.txt');

  const release = await publishRelease({ repoDir: work, version: VERSION, builds, push: true });

  assert.equal(release.skipped, true);
  assert.equal(await git(origin, 'rev-list', '--count', 'release/claude'), '1');
});

test('더 새 릴리스가 쌓인 뒤에도 지난 릴리스를 그 커밋에서 다시 돌리면 건너뛴다', async () => {
  const { origin, work } = await createRepo('older');
  const builds = await writeBuilds('older');
  await publishRelease({ repoDir: work, version: VERSION, builds, push: true });
  const released = join(root, 'older', 'released');
  await git(root, 'clone', '-q', origin, released);
  await commitAndPushMain(work, 'more.txt');
  await publishRelease({ repoDir: work, version: NEXT_VERSION, builds, push: true });

  const release = await publishRelease({ repoDir: released, version: VERSION, builds, push: true });

  assert.equal(release.skipped, true);
  assert.equal(await git(origin, 'rev-list', '--count', 'release/claude'), '2');
});

test('태그만 있고 릴리스 브랜치에 그 릴리스가 없으면 건너뛰지 않고 거절한다', async () => {
  const { work } = await createRepo('tag-only');
  await git(work, 'push', '-q', 'origin', `HEAD:refs/tags/${TAG}`);

  await assert.rejects(
    publishRelease({ repoDir: work, version: VERSION, builds: await writeBuilds('tag-only'), push: true }),
    (error) => error instanceof ReleaseError && /release\/claude/.test(error.message),
  );
  assert.equal(await git(work, 'ls-remote', 'origin', 'refs/heads/release/*'), '');
});

test('태그는 맞는데 브랜치 하나에만 그 릴리스가 없어도 거절한다', async () => {
  const { work } = await createRepo('partial');
  await publishRelease({ repoDir: work, version: VERSION, builds: await writeBuilds('partial', { claude: TREES.claude }), push: true });

  await assert.rejects(
    publishRelease({ repoDir: work, version: VERSION, builds: await writeBuilds('partial'), push: true }),
    (error) => error instanceof ReleaseError && /release\/gemini/.test(error.message),
  );
});

test('브랜치 하나가 거절되면 태그도 다른 브랜치도 올라가지 않는다', async () => {
  const { origin, work } = await createRepo('atomic');
  await writeFile(join(origin, 'hooks', 'update'), REJECT_GEMINI_HOOK);
  await chmod(join(origin, 'hooks', 'update'), 0o755);

  await assert.rejects(publishRelease({ repoDir: work, version: VERSION, builds: await writeBuilds('atomic'), push: true }));

  assert.equal(await releaseRefs(work), '');
});

test('커밋하지 않은 변경이 있으면 올리지 않는다. 올리지 않는 미리보기는 된다', async () => {
  const { work } = await createRepo('dirty');
  const builds = await writeBuilds('dirty');
  await writeFile(join(work, 'uncommitted.txt'), 'wip\n');

  await assert.rejects(
    publishRelease({ repoDir: work, version: VERSION, builds, push: true }),
    (error) => error instanceof ReleaseError && /uncommitted\.txt/.test(error.message),
  );
  const preview = await publishRelease({ repoDir: work, version: VERSION, builds });

  assert.equal(preview.pushed, false);
  assert.equal(await releaseRefs(work), '');
});

test('원격 main 의 끝이 아닌 커밋에서는 올리지 않는다. 미리보기는 된다', async () => {
  const { work } = await createRepo('ahead');
  const builds = await writeBuilds('ahead');
  await writeFile(join(work, 'unreviewed.txt'), 'wip\n');
  await git(work, 'add', '.');
  await git(work, 'commit', '-q', '-m', 'feat: unreviewed');

  await assert.rejects(
    publishRelease({ repoDir: work, version: VERSION, builds, push: true }),
    (error) => error instanceof ReleaseError && /main/.test(error.message),
  );
  const preview = await publishRelease({ repoDir: work, version: VERSION, builds });

  assert.equal(preview.pushed, false);
  assert.equal(await releaseRefs(work), '');
});

test('이름 끝만 같은 다른 ref 를 릴리스 태그로 잘못 읽지 않는다', async () => {
  const { work } = await createRepo('tail');
  await git(work, 'push', '-q', 'origin', `HEAD:refs/heads/mirror/refs/tags/${TAG}`);

  const release = await publishRelease({ repoDir: work, version: VERSION, builds: await writeBuilds('tail') });

  assert.equal(release.skipped, false);
});

test('옵션처럼 보이는 원격 이름은 거절한다', async () => {
  const { work } = await createRepo('remote');

  await assert.rejects(
    publishRelease({ repoDir: work, version: VERSION, builds: await writeBuilds('remote'), remote: '--upload-pack=x' }),
    ReleaseError,
  );
});

test('커밋이 하나도 없는 저장소에서는 릴리스하지 않는다', async () => {
  const { origin } = await createRepo('unborn');
  const empty = join(root, 'unborn', 'empty');
  await git(root, 'init', '-q', '-b', 'main', empty);
  await git(empty, 'remote', 'add', 'origin', origin);

  await assert.rejects(
    publishRelease({ repoDir: empty, version: VERSION, builds: await writeBuilds('unborn') }),
    ReleaseError,
  );
});

test('빈 산출물은 릴리스하지 않는다', async () => {
  const { work } = await createRepo('empty');
  const dir = join(root, 'empty', 'built', 'grok');
  await mkdir(dir, { recursive: true });

  await assert.rejects(
    publishRelease({ repoDir: work, version: VERSION, builds: [{ agent: 'grok', dir }] }),
    (error) => error instanceof ReleaseError && /grok/.test(error.message),
  );
});

test('작업 중인 브랜치와 작업 트리를 건드리지 않는다', async () => {
  const { work } = await createRepo('untouched');

  await publishRelease({ repoDir: work, version: VERSION, builds: await writeBuilds('untouched'), push: true });

  assert.equal(await git(work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(await git(work, 'status', '--porcelain'), '');
});
