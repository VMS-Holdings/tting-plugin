import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { packageAssets } from '../scripts/lib/assets.mjs';
import { GIT_ENV, createOriginAndClone, writeTreeFiles } from '../test-support/git.mjs';

const run = promisify(execFile);
const VERSION = '26.11.23.0';
const CLAUDE_ASSET = 'tting-plugin-claude-26.11.23.0.tar.gz';
const GEMINI_ASSETS = ['darwin', 'linux', 'win32'].map((platform) => `${platform}.tting-plugin-gemini-26.11.23.0.tar.gz`);

let root;
let work;
let builds;

async function filesIn(archive) {
  const { stdout } = await run('tar', ['-tzf', archive]);
  return stdout
    .split('\n')
    .filter((entry) => entry !== '' && !entry.endsWith('/'))
    .sort();
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tting-plugin-assets-'));
  ({ work } = await createOriginAndClone(root));
  await writeTreeFiles(join(root, 'built', 'claude'), { '.claude-plugin/plugin.json': '{}\n', 'skills/using-tting/SKILL.md': 'skill\n' });
  await writeTreeFiles(join(root, 'built', 'gemini'), { 'gemini-extension.json': '{}\n', 'skills/using-tting/SKILL.md': 'skill\n' });
  builds = ['claude', 'gemini'].map((agent) => ({ agent, dir: join(root, 'built', agent) }));
  Object.assign(process.env, GIT_ENV);
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test('에이전트마다 묶음을 만든다. gemini 는 플랫폼 이름만 다른 셋이다', async () => {
  const assetsDir = join(root, 'out');

  const names = await packageAssets({ repoDir: work, builds, version: VERSION, assetsDir });

  assert.deepEqual(names, [CLAUDE_ASSET, ...GEMINI_ASSETS]);
  assert.deepEqual((await readdir(assetsDir)).sort(), [...names].sort());
});

test('묶음은 선언 파일이 맨 위에 오게 싼다', async () => {
  const assetsDir = join(root, 'layout');

  await packageAssets({ repoDir: work, builds, version: VERSION, assetsDir });

  assert.deepEqual(await filesIn(join(assetsDir, CLAUDE_ASSET)), ['.claude-plugin/plugin.json', 'skills/using-tting/SKILL.md']);
  for (const asset of GEMINI_ASSETS) {
    assert.deepEqual(await filesIn(join(assetsDir, asset)), ['gemini-extension.json', 'skills/using-tting/SKILL.md']);
  }
});

test('지난 묶음은 남기지 않는다', async () => {
  const assetsDir = join(root, 'stale');
  await mkdir(assetsDir, { recursive: true });
  await writeFile(join(assetsDir, 'tting-plugin-claude-26.11.22.0.tar.gz'), 'old');

  const names = await packageAssets({ repoDir: work, builds, version: VERSION, assetsDir });

  assert.deepEqual((await readdir(assetsDir)).sort(), [...names].sort());
});
