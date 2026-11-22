import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { formatError, selectAgents } from '../scripts/lib/cli.mjs';
import { validateConfig } from '../scripts/lib/config.mjs';

const run = promisify(execFile);
const BUILD_CLI = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const RELEASE_CLI = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));

const config = validateConfig({
  name: 'tting',
  description: 'Create and run tting workflows.',
  author: { name: 'tting' },
  repository: 'VMS-Holdings/tting-plugin',
  mcp: { serverName: 'tting', url: 'https://mcp.tting.ai/mcp' },
  agents: { grok: { version: '0.1.0' }, claude: { version: '0.1.0' } },
});

let outDir;

before(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'tting-plugin-cli-'));
});

after(async () => {
  await rm(outDir, { recursive: true, force: true });
});

test('all 은 설정에 있는 에이전트를 정해진 순서로 돌려준다', () => {
  assert.deepEqual(selectAgents('all', config), ['claude', 'grok']);
});

test('에이전트 하나를 지목하면 그것만 돌려준다', () => {
  assert.deepEqual(selectAgents('grok', config), ['grok']);
});

test('설정에 없는 에이전트를 지목하면 거절한다', () => {
  assert.throws(() => selectAgents('gemini', config), /gemini/);
});

test('짓기 명령은 고른 에이전트의 산출물만 지정한 폴더에 짓는다', async () => {
  const { stdout } = await run('node', [BUILD_CLI, '--agent', 'gemini', '--out', outDir]);

  assert.match(stdout, /\[build\] gemini:/);
  await access(join(outDir, 'gemini', 'gemini-extension.json'));
  await access(join(outDir, 'gemini', 'skills', 'using-tting', 'SKILL.md'));
  await assert.rejects(access(join(outDir, 'claude')));
});

test('짓기 명령은 모르는 에이전트를 받으면 사유를 찍고 실패한다', async () => {
  await assert.rejects(
    run('node', [BUILD_CLI, '--agent', 'cursor', '--out', outDir]),
    (error) => error.code === 1 && /cursor/.test(error.stderr),
  );
});

test('릴리스 명령은 에이전트를 고르지 않으면 사유를 찍고 실패한다', async () => {
  await assert.rejects(
    run('node', [RELEASE_CLI]),
    (error) => error.code === 1 && /--agent/.test(error.stderr),
  );
});

test('실패 사유에 원인이 있으면 함께 적는다', () => {
  const error = new Error('커밋이 없다', { cause: new Error('fatal: needed a single revision') });

  assert.equal(formatError(error), '커밋이 없다\n원인: fatal: needed a single revision');
  assert.equal(formatError(new Error('사유만')), '사유만');
});
