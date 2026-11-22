import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { validateConfig } from '../scripts/lib/config.mjs';
import { ReleaseError } from '../scripts/lib/release.mjs';
import { RELEASES_FILE, runRelease } from '../scripts/lib/run-release.mjs';
import { GIT_ENV, createOriginAndClone, git } from '../test-support/git.mjs';

const SKILL = '---\nname: using-tting\ndescription: Use tting.\n---\n\n# Using tting\n';
const SOURCE_FILES = Object.freeze({
  'skills/using-tting/SKILL.md': SKILL,
  '.gitignore': 'node_modules/\n.DS_Store\n',
});
const REJECT_GEMINI_HOOK = '#!/bin/sh\ncase "$1" in refs/heads/release/gemini) exit 1 ;; esac\n';

function configWith(agents) {
  return validateConfig({
    name: 'tting',
    description: 'Create and run tting workflows.',
    author: { name: 'tting' },
    repository: 'VMS-Holdings/tting-plugin',
    mcp: { serverName: 'tting', url: 'https://mcp.tting.ai/mcp' },
    agents,
  });
}

let root;

/** 원격과 그 클론을 새로 만든다. 테스트끼리 릴리스 이력이 섞이지 않게 한다. */
async function createRepo(name) {
  const { origin, work } = await createOriginAndClone(join(root, name), SOURCE_FILES);
  return { origin, work, skillsDir: join(work, 'skills'), outDir: join(root, name, 'dist') };
}

async function readReleases(outDir) {
  return JSON.parse(await readFile(join(outDir, RELEASES_FILE), 'utf8'));
}

function silent() {}

function outcomeOf({ agent, tag, pushed, skipped }) {
  return { agent, tag, pushed, skipped };
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tting-plugin-run-release-'));
  Object.assign(process.env, GIT_ENV);
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test('올리지 않으면 무엇이 나갈지만 목록으로 남긴다', async () => {
  const { work, skillsDir, outDir } = await createRepo('preview');
  const config = configWith({ claude: { version: '0.1.0' }, gemini: { version: '0.2.0' } });

  const releases = await runRelease({ config, requested: 'all', repoDir: work, skillsDir, outDir, report: silent });

  assert.deepEqual(releases.map(outcomeOf), [
    { agent: 'claude', tag: 'claude-v0.1.0', pushed: false, skipped: false },
    { agent: 'gemini', tag: 'gemini-v0.2.0', pushed: false, skipped: false },
  ]);
  assert.deepEqual(await readReleases(outDir), releases);
  assert.equal(await git(work, 'ls-remote', 'origin', 'refs/tags/*'), '');
});

test('전부를 고르면 아직 안 나간 버전만 올리고, 나간 버전도 목록에 남긴다', async () => {
  const { origin, work, skillsDir, outDir } = await createRepo('all');
  const first = configWith({ claude: { version: '0.1.0' } });
  const second = configWith({ claude: { version: '0.1.0' }, gemini: { version: '0.1.0' } });
  const options = { requested: 'all', repoDir: work, skillsDir, outDir, push: true, report: silent };
  await runRelease({ ...options, config: first });

  const releases = await runRelease({ ...options, config: second });

  assert.deepEqual(releases.map(outcomeOf), [
    { agent: 'claude', tag: 'claude-v0.1.0', pushed: false, skipped: true },
    { agent: 'gemini', tag: 'gemini-v0.1.0', pushed: true, skipped: false },
  ]);
  assert.equal(await git(origin, 'rev-list', '--count', 'release/claude'), '1');
  assert.equal(await git(origin, 'rev-list', '--count', 'release/gemini'), '1');
  assert.equal(await git(origin, 'show', 'release/gemini:skills/using-tting/SKILL.md'), SKILL.trim());
});

test('전부 나간 뒤에 다시 돌려도 목록을 쓴다', async () => {
  const { work, skillsDir, outDir } = await createRepo('done');
  const config = configWith({ codex: { version: '0.1.0' } });
  const options = { config, requested: 'all', repoDir: work, skillsDir, outDir, push: true, report: silent };
  await runRelease(options);
  await rm(outDir, { recursive: true, force: true });

  const releases = await runRelease(options);

  assert.deepEqual(await readReleases(outDir), releases);
  assert.deepEqual(releases.map(outcomeOf), [
    { agent: 'codex', tag: 'codex-v0.1.0', pushed: false, skipped: true },
  ]);
});

test('하나를 지목했는데 이미 나간 버전이면 거절한다', async () => {
  const { work, skillsDir, outDir } = await createRepo('single');
  const config = configWith({ grok: { version: '0.1.0' } });
  const options = { config, requested: 'grok', repoDir: work, skillsDir, outDir, push: true, report: silent };
  await runRelease(options);

  await assert.rejects(runRelease(options), ReleaseError);
  assert.deepEqual(await readReleases(outDir), []);
});

test('도중에 실패해도 그 앞에 올린 릴리스는 목록에 남는다', async () => {
  const { origin, work, skillsDir, outDir } = await createRepo('partial');
  const config = configWith({ claude: { version: '0.1.0' }, gemini: { version: '0.1.0' }, codex: { version: '0.1.0' } });
  await writeFile(join(origin, 'hooks', 'update'), REJECT_GEMINI_HOOK);
  await chmod(join(origin, 'hooks', 'update'), 0o755);

  await assert.rejects(
    runRelease({ config, requested: 'all', repoDir: work, skillsDir, outDir, push: true, report: silent }),
  );

  const releases = await readReleases(outDir);
  assert.deepEqual(releases.map(outcomeOf), [
    { agent: 'claude', tag: 'claude-v0.1.0', pushed: true, skipped: false },
  ]);
  assert.equal(await git(work, 'ls-remote', 'origin', 'refs/tags/gemini-v0.1.0'), '');
  assert.equal(await git(work, 'ls-remote', 'origin', 'refs/tags/codex-v0.1.0'), '');
});

test('git 이 무시하는 파일이 스킬에 있으면 올리지 않는다', async () => {
  const { work, skillsDir, outDir } = await createRepo('ignored');
  const config = configWith({ claude: { version: '0.1.0' } });
  await mkdir(join(skillsDir, 'using-tting', 'node_modules', 'pkg'), { recursive: true });
  await writeFile(join(skillsDir, 'using-tting', 'node_modules', 'pkg', 'index.js'), 'export {};\n');

  await assert.rejects(
    runRelease({ config, requested: 'claude', repoDir: work, skillsDir, outDir, push: true, report: silent }),
    (error) => error instanceof ReleaseError && /node_modules/.test(error.message),
  );
  assert.equal(await git(work, 'ls-remote', 'origin', 'refs/tags/claude-v0.1.0'), '');
});

test('.DS_Store 는 무시하는 파일로 치지 않는다', async () => {
  const { work, skillsDir, outDir } = await createRepo('dsstore');
  const config = configWith({ claude: { version: '0.1.0' } });
  await writeFile(join(skillsDir, 'using-tting', '.DS_Store'), 'x');

  const releases = await runRelease({ config, requested: 'claude', repoDir: work, skillsDir, outDir, push: true, report: silent });

  assert.equal(releases[0].pushed, true);
});

test('스킬 폴더가 저장소 밖에 있으면 올리지 않는다', async () => {
  const { work, outDir } = await createRepo('outside');
  const config = configWith({ claude: { version: '0.1.0' } });
  const outside = join(root, 'outside', 'elsewhere');
  await mkdir(join(outside, 'using-tting'), { recursive: true });
  await writeFile(join(outside, 'using-tting', 'SKILL.md'), SKILL);

  await assert.rejects(
    runRelease({ config, requested: 'claude', repoDir: work, skillsDir: outside, outDir, push: true, report: silent }),
    ReleaseError,
  );
});

test('진행을 한 줄씩 알린다', async () => {
  const { work, skillsDir, outDir } = await createRepo('report');
  const config = configWith({ claude: { version: '0.1.0' } });
  const lines = [];

  await runRelease({
    config,
    requested: 'claude',
    repoDir: work,
    skillsDir,
    outDir,
    report: (action, target, message) => lines.push(`${action} ${target} ${message}`),
  });

  assert.equal(lines.length, 1);
  assert.match(lines[0], /^release claude claude-v0\.1\.0 -> release\/claude/);
});
