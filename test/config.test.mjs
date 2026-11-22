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
  mcp: { serverName: 'tting', url: 'https://mcp.tting.ai/mcp' },
  agents: { claude: { version: '0.1.0' }, gemini: { version: '1.2.3' } },
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
  assert.equal(config.agents.gemini.version, '1.2.3');
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.agents.claude));
});

test('이름이 kebab-case 가 아니면 거절한다', () => {
  assert.throws(() => validateConfig(withChange({ name: 'Tting Plugin' })), ConfigError);
});

test('MCP 주소가 https 가 아니면 거절한다', () => {
  const change = { mcp: { serverName: 'tting', url: 'http://mcp.tting.ai/mcp' } };

  assert.throws(() => validateConfig(withChange(change)), /mcp\.url/);
});

test('모르는 에이전트가 있으면 거절한다', () => {
  const change = { agents: { cursor: { version: '0.1.0' } } };

  assert.throws(() => validateConfig(withChange(change)), /cursor/);
});

test('에이전트가 하나도 없으면 거절한다', () => {
  assert.throws(() => validateConfig(withChange({ agents: {} })), /agents/);
});

test('버전이 semver 가 아니면 거절한다', () => {
  const change = { agents: { claude: { version: 'v1' } } };

  assert.throws(() => validateConfig(withChange(change)), /agents\.claude\.version/);
});

test('버전이 문자열이 아니면 거절한다', () => {
  for (const version of [['1.2.3'], 1, null]) {
    const change = { agents: { claude: { version } } };

    assert.throws(() => validateConfig(withChange(change)), /agents\.claude\.version/);
  }
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
  const change = { name: '', repository: 'x', agents: { claude: { version: 'bad' } } };

  assert.throws(
    () => validateConfig(withChange(change)),
    (error) =>
      error instanceof ConfigError &&
      error.problems.length === 3 &&
      /name/.test(error.message) &&
      /repository/.test(error.message),
  );
});

test('저장소의 설정 파일은 검증을 통과한다', async () => {
  const config = await loadConfig(new URL('../plugin.config.json', import.meta.url));

  assert.equal(config.mcp.url, 'https://mcp.tting.ai/mcp');
  assert.deepEqual(Object.keys(config.agents).sort(), [...AGENTS].sort());
});
