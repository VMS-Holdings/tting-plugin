import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateConfig } from '../scripts/lib/config.mjs';
import {
  releaseBranch,
  releaseTag,
  rootClaudeMarketplace,
  targetFor,
} from '../scripts/lib/targets.mjs';

const config = validateConfig({
  name: 'tting',
  displayName: 'tting',
  description: 'Create and run tting workflows.',
  author: { name: 'tting', url: 'https://tting.ai' },
  homepage: 'https://tting.ai',
  repository: 'VMS-Holdings/tting-plugin',
  keywords: ['tting', 'mcp'],
  mcp: { serverName: 'tting', url: 'https://mcp.tting.ai/mcp' },
  agents: {
    claude: { version: '0.1.0' },
    gemini: { version: '0.2.0' },
    codex: { version: '0.3.0' },
    grok: { version: '0.4.0' },
  },
});

function jsonOf(target, path) {
  const file = target.files.find((candidate) => candidate.path === path);
  assert.ok(file, `${path} 가 없다`);
  return JSON.parse(file.content);
}

test('릴리스 브랜치와 태그 이름은 에이전트마다 다르다', () => {
  assert.equal(releaseBranch('gemini'), 'release/gemini');
  assert.equal(releaseTag('gemini', '0.2.0'), 'gemini-v0.2.0');
});

test('claude: 설치 안내는 마켓을 한 번에 더하고 설치하는 명령을 싣는다', () => {
  const readme = targetFor('claude', config).files.find((file) => file.path === 'README.md');

  assert.match(readme.content, /claude plugin install tting --marketplace VMS-Holdings\/tting-plugin/);
});

test('claude: 플러그인 선언과 원격 MCP 서버를 낸다', () => {
  const target = targetFor('claude', config);

  const manifest = jsonOf(target, '.claude-plugin/plugin.json');
  assert.equal(manifest.name, 'tting');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.repository, 'https://github.com/VMS-Holdings/tting-plugin');
  assert.deepEqual(jsonOf(target, '.mcp.json'), {
    mcpServers: { tting: { type: 'http', url: 'https://mcp.tting.ai/mcp' } },
  });
  assert.equal(target.skillsDir, 'skills');
  assert.equal(
    target.files.some((file) => file.path === '.claude-plugin/marketplace.json'),
    false,
  );
});

test('grok: Claude Code 형식에 자기 마켓 선언을 더한다', () => {
  const target = targetFor('grok', config);

  assert.equal(jsonOf(target, '.claude-plugin/plugin.json').version, '0.4.0');
  const marketplace = jsonOf(target, '.claude-plugin/marketplace.json');
  assert.equal(marketplace.description, 'Create and run tting workflows.');
  assert.equal(marketplace.plugins[0].name, 'tting');
  assert.equal(marketplace.plugins[0].source, './');
  assert.equal(target.skillsDir, 'skills');
});

test('gemini: 익스텐션 선언에 스트리밍 HTTP 주소를 싣는다', () => {
  const target = targetFor('gemini', config);

  assert.deepEqual(jsonOf(target, 'gemini-extension.json'), {
    name: 'tting',
    version: '0.2.0',
    description: 'Create and run tting workflows.',
    mcpServers: { tting: { httpUrl: 'https://mcp.tting.ai/mcp' } },
  });
  assert.equal(target.skillsDir, 'skills');
});

test('codex: 마켓 선언과 포터블 플러그인을 낸다', () => {
  const target = targetFor('codex', config);

  const marketplace = jsonOf(target, '.agents/plugins/marketplace.json');
  assert.deepEqual(marketplace.plugins[0].source, { source: 'local', path: './plugins/tting' });
  assert.equal(marketplace.plugins[0].policy.installation, 'AVAILABLE');
  assert.equal(jsonOf(target, 'plugins/tting/plugin.json').version, '0.3.0');
  assert.deepEqual(jsonOf(target, 'plugins/tting/mcp.json').mcpServers, {
    tting: { type: 'streamable-http', url: 'https://mcp.tting.ai/mcp' },
  });
  assert.equal(target.skillsDir, 'plugins/tting/skills');
});

test('모든 에이전트가 설치 안내 README 를 낸다', () => {
  for (const agent of ['claude', 'gemini', 'codex', 'grok']) {
    const readme = targetFor(agent, config).files.find((file) => file.path === 'README.md');

    assert.ok(readme, `${agent} README 가 없다`);
    assert.match(readme.content, new RegExp(`release/${agent}`));
  }
});

test('gemini 와 grok 의 설치 안내는 SSH 로 받는 명령도 싣는다', () => {
  const readmeOf = (agent) => targetFor(agent, config).files.find((file) => file.path === 'README.md').content;

  assert.ok(
    readmeOf('gemini').includes(
      'gemini extensions install git@github.com:VMS-Holdings/tting-plugin.git --ref release/gemini --auto-update',
    ),
  );
  assert.ok(
    readmeOf('grok').includes('git clone --branch release/grok git@github.com:VMS-Holdings/tting-plugin.git tting-grok'),
  );
});

test('파일 내용은 줄바꿈으로 끝난다', () => {
  for (const file of targetFor('claude', config).files) {
    assert.ok(file.content.endsWith('\n'), file.path);
  }
});

test('설정에 없는 에이전트는 만들 수 없다', () => {
  const partial = validateConfig({ ...config, agents: { claude: { version: '0.1.0' } } });

  assert.throws(() => targetFor('gemini', partial), /gemini/);
});

test('기본 브랜치의 Claude 마켓 선언은 릴리스 브랜치를 가리킨다', () => {
  assert.deepEqual(rootClaudeMarketplace(config), {
    name: 'tting',
    description: 'Create and run tting workflows.',
    owner: { name: 'tting' },
    plugins: [
      {
        name: 'tting',
        source: { source: 'github', repo: 'VMS-Holdings/tting-plugin', ref: 'release/claude' },
        description: 'Create and run tting workflows.',
      },
    ],
  });
});
