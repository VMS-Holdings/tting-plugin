import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateConfig } from '../scripts/lib/config.mjs';
import {
  assetNames,
  releaseBranch,
  releaseNotes,
  releaseTag,
  rootClaudeMarketplace,
  targetFor,
} from '../scripts/lib/targets.mjs';

const RAW = {
  name: 'tting',
  displayName: 'tting',
  description: 'Create and run tting workflows.',
  author: { name: 'tting', url: 'https://tting.ai' },
  homepage: 'https://tting.ai',
  repository: 'VMS-Holdings/tting-plugin',
  keywords: ['tting', 'mcp'],
  version: '26.11.23.0',
  mcp: { serverName: 'tting', url: 'https://mcp.tting.ai/mcp' },
  agents: ['claude', 'gemini', 'codex', 'grok'],
};
const config = validateConfig(RAW);

function jsonOf(target, path) {
  const file = target.files.find((candidate) => candidate.path === path);
  assert.ok(file, `${path} 가 없다`);
  return JSON.parse(file.content);
}

function readmeOf(agent) {
  return targetFor(agent, config).files.find((file) => file.path === 'README.md').content;
}

test('릴리스 태그는 버전 하나에서 나오고, 브랜치는 에이전트마다 다르다', () => {
  assert.equal(releaseTag('26.11.23.0'), 'v26.11.23.0');
  assert.equal(releaseBranch('gemini'), 'release/gemini');
});

test('claude: 설치 안내는 마켓을 한 번에 더하고 설치하는 명령을 싣는다', () => {
  assert.match(readmeOf('claude'), /claude plugin install tting --marketplace VMS-Holdings\/tting-plugin/);
});

test('claude: 플러그인 선언과 원격 MCP 서버를 낸다', () => {
  const target = targetFor('claude', config);

  const manifest = jsonOf(target, '.claude-plugin/plugin.json');
  assert.equal(manifest.name, 'tting');
  assert.equal(manifest.version, '26.11.23.0');
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

  assert.equal(jsonOf(target, '.claude-plugin/plugin.json').version, '26.11.23.0');
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
    version: '26.11.23.0',
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
  assert.equal(jsonOf(target, 'plugins/tting/plugin.json').version, '26.11.23.0');
  assert.deepEqual(jsonOf(target, 'plugins/tting/mcp.json').mcpServers, {
    tting: { type: 'streamable-http', url: 'https://mcp.tting.ai/mcp' },
  });
  assert.equal(target.skillsDir, 'plugins/tting/skills');
});

test('모든 에이전트가 자기 릴리스 브랜치와 버전을 적은 README 를 낸다', () => {
  for (const agent of config.agents) {
    const readme = readmeOf(agent);

    assert.match(readme, new RegExp(`release/${agent}`));
    assert.match(readme, /Version 26\.11\.23\.0\./);
  }
});

test('gemini: 기본 설치 명령은 ref 없이 최신 GitHub Release 를 받는다', () => {
  const readme = readmeOf('gemini');

  assert.match(readme, /gemini extensions install https:\/\/github\.com\/VMS-Holdings\/tting-plugin --auto-update\n/);
  assert.match(readme, /GITHUB_TOKEN/);
});

test('gemini 와 grok 의 설치 안내는 SSH 로 받는 명령도 싣는다', () => {
  assert.ok(
    readmeOf('gemini').includes(
      'gemini extensions install git@github.com:VMS-Holdings/tting-plugin.git --ref release/gemini --auto-update',
    ),
  );
  assert.ok(
    readmeOf('grok').includes('git clone --branch release/grok git@github.com:VMS-Holdings/tting-plugin.git tting-grok'),
  );
});

test('gemini 의 묶음은 Gemini CLI 가 고르도록 플랫폼 이름을 앞에 단다', () => {
  assert.deepEqual(assetNames('gemini', '26.11.23.0'), [
    'darwin.tting-plugin-gemini-26.11.23.0.tar.gz',
    'linux.tting-plugin-gemini-26.11.23.0.tar.gz',
    'win32.tting-plugin-gemini-26.11.23.0.tar.gz',
  ]);
});

test('나머지 에이전트의 묶음은 하나다', () => {
  for (const agent of ['claude', 'codex', 'grok']) {
    assert.deepEqual(assetNames(agent, '26.11.23.0'), [`tting-plugin-${agent}-26.11.23.0.tar.gz`]);
  }
});

test('릴리스 노트는 에이전트마다 받아 가는 법과 묶음 이름을 적는다', () => {
  const notes = releaseNotes(config);

  assert.match(notes, /v26\.11\.23\.0/);
  for (const title of ['## Claude Code', '## Gemini CLI', '## Codex', '## Grok Build']) {
    assert.ok(notes.includes(title), title);
  }
  assert.ok(notes.includes('claude plugin install tting --marketplace VMS-Holdings/tting-plugin'));
  assert.ok(notes.includes('gemini extensions install https://github.com/VMS-Holdings/tting-plugin --auto-update'));
  assert.ok(notes.includes('tting-plugin-grok-26.11.23.0.tar.gz'));
  assert.ok(notes.includes('darwin.tting-plugin-gemini-26.11.23.0.tar.gz'));
});

test('릴리스 노트는 설정에 있는 에이전트만 적는다', () => {
  const notes = releaseNotes(validateConfig({ ...RAW, agents: ['claude'] }));

  assert.ok(notes.includes('## Claude Code'));
  assert.equal(notes.includes('## Gemini CLI'), false);
});

test('파일 내용은 줄바꿈으로 끝난다', () => {
  for (const file of targetFor('claude', config).files) {
    assert.ok(file.content.endsWith('\n'), file.path);
  }
});

test('설정에 없는 에이전트는 만들 수 없다', () => {
  const partial = validateConfig({ ...RAW, agents: ['claude'] });

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
