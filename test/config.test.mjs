import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGENTS, ConfigError, loadConfig, validateConfig } from '../scripts/lib/config.mjs';

const VALID = {
  name: 'tting',
  displayName: 'tting',
  description: 'Create and run tting workflows.',
  author: { name: 'tting', url: 'https://tting.ai' },
  homepage: 'https://tting.ai',
  repository: 'VMS-Holdings/tting-plugin',
  keywords: ['tting'],
  version: '26.11.23.0',
  mcp: { serverName: 'tting', url: 'https://mcp.tting.ai/mcp' },
  agents: ['claude', 'gemini'],
};

function withChange(change) {
  return { ...VALID, ...change };
}

test('지원하는 에이전트는 넷이다', () => {
  assert.deepEqual([...AGENTS], ['claude', 'gemini', 'codex', 'grok']);
});

test('올바른 설정은 그대로 돌려주고 고칠 수 없게 얼린다', () => {
  const config = validateConfig(VALID);

  assert.equal(config.name, 'tting');
  assert.equal(config.version, '26.11.23.0');
  assert.deepEqual([...config.agents], ['claude', 'gemini']);
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.agents));
});

test('이름이 kebab-case 가 아니면 거절한다', () => {
  assert.throws(() => validateConfig(withChange({ name: 'Tting Plugin' })), ConfigError);
});

test('MCP 주소가 https 가 아니면 거절한다', () => {
  const change = { mcp: { serverName: 'tting', url: 'http://mcp.tting.ai/mcp' } };

  assert.throws(() => validateConfig(withChange(change)), /mcp\.url/);
});

test('모르는 에이전트가 있으면 거절한다', () => {
  assert.throws(() => validateConfig(withChange({ agents: ['claude', 'cursor'] })), /cursor/);
});

test('에이전트 목록이 비었거나 배열이 아니면 거절한다', () => {
  for (const agents of [[], { claude: {} }, 'claude', undefined]) {
    assert.throws(() => validateConfig(withChange({ agents })), /agents/);
  }
});

test('같은 에이전트가 두 번 있으면 거절한다', () => {
  assert.throws(() => validateConfig(withChange({ agents: ['claude', 'claude'] })), /claude 가 두 번/);
});

test('버전은 yy.mm.dd.n 모양의 실제 날짜여야 한다', () => {
  const invalid = ['1.2.3', 'v26.11.23.0', '26.11.23', '26.13.01.0', '26.02.30.0', '26.11.23.01', '26.1.5.0', 26, null, ['26.11.23.0']];

  for (const version of invalid) {
    assert.throws(() => validateConfig(withChange({ version })), /version/, String(version));
  }
});

test('같은 날의 다음 릴리스는 마지막 칸을 올린다', () => {
  assert.equal(validateConfig(withChange({ version: '26.01.05.12' })).version, '26.01.05.12');
});

test('저장소가 owner/repo 모양이 아니면 거절한다', () => {
  for (const repository of ['tting-plugin', '../tting-plugin', '-owner/repo', 'owner/..', 'owner/-repo', 'a/b/c']) {
    assert.throws(() => validateConfig(withChange({ repository })), /repository/, repository);
  }
});

test('한 줄이어야 하는 값에 줄바꿈이 있으면 거절한다', () => {
  assert.throws(() => validateConfig(withChange({ description: 'one\ntwo' })), /description/);
  assert.throws(() => validateConfig(withChange({ displayName: 'tting\r\n# injected' })), /displayName/);
  assert.throws(() => validateConfig(withChange({ author: { name: 'tting\nx' } })), /author\.name/);
});

test('문제가 여럿이면 한 번에 모두 알려 준다', () => {
  const change = { name: '', repository: 'x', version: 'bad' };

  assert.throws(
    () => validateConfig(withChange(change)),
    (error) =>
      error instanceof ConfigError &&
      error.problems.length === 3 &&
      /name/.test(error.message) &&
      /repository/.test(error.message) &&
      /version/.test(error.message),
  );
});

test('저장소의 설정 파일은 검증을 통과한다', async () => {
  const config = await loadConfig(new URL('../plugin.config.json', import.meta.url));

  assert.equal(config.mcp.url, 'https://mcp.tting.ai/mcp');
  assert.deepEqual([...config.agents].sort(), [...AGENTS].sort());
});
