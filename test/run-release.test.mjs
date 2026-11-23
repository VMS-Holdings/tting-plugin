import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { validateConfig } from '../scripts/lib/config.mjs';
import { ReleaseError } from '../scripts/lib/release.mjs';
import { ASSETS_DIR, NOTES_FILE, RELEASE_FILE, runRelease } from '../scripts/lib/run-release.mjs';
import { GIT_ENV, createOriginAndClone, git } from '../test-support/git.mjs';

const SKILL = '---\nname: using-tting\ndescription: Use tting.\n---\n\n# Using tting\n';
const SOURCE_FILES = Object.freeze({
  'skills/using-tting/SKILL.md': SKILL,
  '.gitignore': 'node_modules/\n.DS_Store\n',
});
const TAG = 'v26.11.23.0';
const config = validateConfig({
  name: 'tting',
  description: 'Create and run tting workflows.',
  author: { name: 'tting' },
  repository: 'VMS-Holdings/tting-plugin',
  version: '26.11.23.0',
  mcp: { serverName: 'tting', url: 'https://mcp.tting.ai/mcp' },
  agents: ['claude', 'gemini'],
});
const ASSETS = [
  'tting-plugin-claude-26.11.23.0.tar.gz',
  'darwin.tting-plugin-gemini-26.11.23.0.tar.gz',
  'linux.tting-plugin-gemini-26.11.23.0.tar.gz',
  'win32.tting-plugin-gemini-26.11.23.0.tar.gz',
];

let root;

/** 테스트끼리 릴리스 이력이 섞이지 않게 원격과 클론을 테스트마다 새로 만든다. */
async function createRepo(name) {
  const { origin, work } = await createOriginAndClone(join(root, name), SOURCE_FILES);
  const outDir = join(root, name, 'dist');
  return { origin, work, outDir, options: { config, repoDir: work, skillsDir: join(work, 'skills'), outDir, report: () => {} } };
}

async function readRelease(outDir) {
  return JSON.parse(await readFile(join(outDir, RELEASE_FILE), 'utf8'));
}

function releaseRefs(repo) {
  return git(repo, 'ls-remote', 'origin', 'refs/heads/release/*', 'refs/tags/*');
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tting-plugin-run-release-'));
  Object.assign(process.env, GIT_ENV);
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test('올리지 않으면 무엇이 나갈지를 파일로 남긴다', async () => {
  const { work, outDir, options } = await createRepo('preview');

  const release = await runRelease(options);

  assert.equal(release.tag, TAG);
  assert.equal(release.pushed, false);
  assert.deepEqual(release.assets, ASSETS);
  assert.deepEqual(await readRelease(outDir), release);
  assert.deepEqual((await readdir(join(outDir, ASSETS_DIR))).sort(), [...ASSETS].sort());
  assert.match(await readFile(join(outDir, NOTES_FILE), 'utf8'), /v26\.11\.23\.0/);
  assert.equal(await releaseRefs(work), '');
});

test('모든 에이전트의 브랜치와 태그 하나를 올린다', async () => {
  const { origin, work, options } = await createRepo('push');
  const source = await git(work, 'rev-parse', 'HEAD');

  const release = await runRelease({ ...options, push: true });

  assert.equal(release.pushed, true);
  assert.equal(await git(origin, 'rev-parse', `refs/tags/${TAG}`), source);
  assert.equal(await git(origin, 'show', 'release/gemini:skills/using-tting/SKILL.md'), SKILL.trim());
  const manifest = JSON.parse(await git(origin, 'show', 'release/claude:.claude-plugin/plugin.json'));
  assert.equal(manifest.version, '26.11.23.0');
});

test('같은 커밋에서 다시 돌리면 올리지 않고 묶음만 다시 만든다', async () => {
  const { origin, outDir, options } = await createRepo('rerun');
  await runRelease({ ...options, push: true });
  await rm(outDir, { recursive: true, force: true });

  const release = await runRelease({ ...options, push: true });

  assert.equal(release.skipped, true);
  assert.equal(release.pushed, false);
  assert.deepEqual((await readdir(join(outDir, ASSETS_DIR))).sort(), [...ASSETS].sort());
  const written = await readRelease(outDir);
  assert.deepEqual(
    { tag: written.tag, skipped: written.skipped, agents: written.agents, assets: written.assets },
    { tag: TAG, skipped: true, agents: [], assets: ASSETS },
  );
  await access(join(outDir, NOTES_FILE));
  assert.equal(await git(origin, 'rev-list', '--count', 'release/claude'), '1');
});

test('다른 커밋에서 이미 나간 버전이면 거절하고 지난 결과 파일을 남기지 않는다', async () => {
  const { work, outDir, options } = await createRepo('taken');
  await runRelease({ ...options, push: true });
  await writeFile(join(work, 'more.txt'), 'more\n');
  await git(work, 'add', '.');
  await git(work, 'commit', '-q', '-m', 'feat: more');
  await git(work, 'push', '-q', 'origin', 'HEAD:main');

  await assert.rejects(runRelease({ ...options, push: true }), ReleaseError);
  await assert.rejects(access(join(outDir, RELEASE_FILE)));
});

test('git 이 무시하는 파일이 스킬에 있으면 올리지 않는다', async () => {
  const { work, options } = await createRepo('ignored');
  await mkdir(join(work, 'skills', 'using-tting', 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(work, 'skills', 'using-tting', 'node_modules', 'pkg', 'index.js'), 'export {};\n');

  await assert.rejects(
    runRelease({ ...options, push: true }),
    (error) => error instanceof ReleaseError && /node_modules/.test(error.message),
  );
  assert.equal(await releaseRefs(work), '');
});

test('.DS_Store 는 무시하는 파일로 치지 않는다', async () => {
  const { work, options } = await createRepo('dsstore');
  await writeFile(join(work, 'skills', 'using-tting', '.DS_Store'), 'x');

  const release = await runRelease({ ...options, push: true });

  assert.equal(release.pushed, true);
});

test('스킬 폴더가 저장소 밖에 있으면 올리지 않는다', async () => {
  const { options } = await createRepo('outside');
  const outside = join(root, 'outside', 'elsewhere');
  await mkdir(join(outside, 'using-tting'), { recursive: true });
  await writeFile(join(outside, 'using-tting', 'SKILL.md'), SKILL);

  await assert.rejects(runRelease({ ...options, skillsDir: outside, push: true }), ReleaseError);
});

test('결과를 한 줄로 알린다', async () => {
  const { options } = await createRepo('report');
  const lines = [];

  await runRelease({ ...options, report: (action, target, message) => lines.push(`${action} ${target} ${message}`) });

  assert.equal(lines.length, 1);
  assert.match(lines[0], /^release v26\.11\.23\.0 /);
});
