// 에이전트마다 릴리스 브랜치에 놓일 파일을 만든다. 형식의 근거는 README 의 「에이전트별 형식」 표에 있다.

const GITHUB = 'https://github.com';
const PORTABLE_PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const PORTABLE_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const CODEX_CATEGORY = 'Productivity';
const MARKETPLACE_ROOT_SOURCE = './';

const AGENT_TITLES = Object.freeze({
  claude: 'Claude Code',
  gemini: 'Gemini CLI',
  codex: 'Codex',
  grok: 'Grok Build',
});

export function toJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function releaseBranch(agent) {
  return `release/${agent}`;
}

export function releaseTag(agent, version) {
  return `${agent}-v${version}`;
}

function versionOf(config, agent) {
  const settings = config.agents[agent];
  if (settings === undefined) {
    throw new Error(`plugin.config.json 의 agents 에 ${agent} 가 없다`);
  }
  return settings.version;
}

function repositoryUrl(config) {
  return `${GITHUB}/${config.repository}`;
}

/** 값이 없는 칸은 키째 뺀다. 빈 칸을 내보내면 검증기가 경고한다. */
function withoutUndefined(entries) {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));
}

function metadata(config, version) {
  return withoutUndefined({
    name: config.name,
    displayName: config.displayName,
    version,
    description: config.description,
    author: config.author,
    homepage: config.homepage,
    repository: repositoryUrl(config),
    keywords: config.keywords,
  });
}

function readme(config, agent, version, installSteps) {
  const lines = [
    `# ${config.displayName ?? config.name} for ${AGENT_TITLES[agent]}`,
    '',
    config.description,
    '',
    `Version ${version}. This branch (\`${releaseBranch(agent)}\`) is generated from`,
    `[${config.repository}](${repositoryUrl(config)}). Do not edit it by hand.`,
    '',
    '## Install',
    '',
    ...installSteps,
    '',
    'Sign in to tting when your agent asks to authorize the tting MCP server.',
    '',
  ];
  return lines.join('\n');
}

function claudeFormatFiles(config, version) {
  return [
    { path: '.claude-plugin/plugin.json', content: toJson(metadata(config, version)) },
    {
      path: '.mcp.json',
      content: toJson({ mcpServers: { [config.mcp.serverName]: { type: 'http', url: config.mcp.url } } }),
    },
  ];
}

function claudeTarget(config) {
  const version = versionOf(config, 'claude');
  const install = [
    '```bash',
    `claude plugin install ${config.name} --marketplace ${config.repository}`,
    '```',
  ];
  return {
    skillsDir: 'skills',
    files: [
      ...claudeFormatFiles(config, version),
      { path: 'README.md', content: readme(config, 'claude', version, install) },
    ],
  };
}

/** Grok Build 는 Claude Code 의 플러그인과 마켓을 그대로 읽는다고 문서에 적혀 있다. 그래서 같은 형식을 낸다. */
function grokTarget(config) {
  const version = versionOf(config, 'grok');
  const marketplace = {
    name: config.name,
    description: config.description,
    owner: { name: config.author.name },
    plugins: [{ name: config.name, source: MARKETPLACE_ROOT_SOURCE, description: config.description }],
  };
  const install = [
    'Grok Build reads Claude Code plugins. Download this branch and point Grok at it:',
    '',
    '```bash',
    `git clone --branch ${releaseBranch('grok')} ${repositoryUrl(config)}.git ${config.name}-grok`,
    `grok --plugin-dir ./${config.name}-grok`,
    '```',
  ];
  return {
    skillsDir: 'skills',
    files: [
      ...claudeFormatFiles(config, version),
      { path: '.claude-plugin/marketplace.json', content: toJson(marketplace) },
      { path: 'README.md', content: readme(config, 'grok', version, install) },
    ],
  };
}

function geminiTarget(config) {
  const version = versionOf(config, 'gemini');
  const extension = {
    name: config.name,
    version,
    description: config.description,
    mcpServers: { [config.mcp.serverName]: { httpUrl: config.mcp.url } },
  };
  const install = [
    '```bash',
    `gemini extensions install ${repositoryUrl(config)} --ref ${releaseBranch('gemini')} --auto-update`,
    '```',
  ];
  return {
    skillsDir: 'skills',
    files: [
      { path: 'gemini-extension.json', content: toJson(extension) },
      { path: 'README.md', content: readme(config, 'gemini', version, install) },
    ],
  };
}

function codexTarget(config) {
  const version = versionOf(config, 'codex');
  const pluginDir = `plugins/${config.name}`;
  const marketplace = {
    name: config.name,
    plugins: [
      {
        name: config.name,
        source: { source: 'local', path: `./${pluginDir}` },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: CODEX_CATEGORY,
      },
    ],
  };
  const mcp = {
    $schema: PORTABLE_MCP_SCHEMA,
    mcpServers: { [config.mcp.serverName]: { type: 'streamable-http', url: config.mcp.url } },
  };
  const install = [
    '```bash',
    `codex plugin marketplace add ${config.repository}@${releaseBranch('codex')}`,
    '```',
    '',
    `Then open \`/plugins\` in Codex and install \`${config.name}\`.`,
  ];
  return {
    skillsDir: `${pluginDir}/skills`,
    files: [
      { path: '.agents/plugins/marketplace.json', content: toJson(marketplace) },
      {
        path: `${pluginDir}/plugin.json`,
        content: toJson({ $schema: PORTABLE_PLUGIN_SCHEMA, ...metadata(config, version) }),
      },
      { path: `${pluginDir}/mcp.json`, content: toJson(mcp) },
      { path: 'README.md', content: readme(config, 'codex', version, install) },
    ],
  };
}

const TARGETS = Object.freeze({
  claude: claudeTarget,
  gemini: geminiTarget,
  codex: codexTarget,
  grok: grokTarget,
});

/** 한 에이전트의 릴리스 브랜치에 놓일 파일과, 스킬을 복사할 자리를 돌려준다. */
export function targetFor(agent, config) {
  const build = TARGETS[agent];
  if (build === undefined) throw new Error(`지원하지 않는 에이전트다: ${agent}`);
  return build(config);
}

/**
 * 기본 브랜치에 두는 Claude Code 마켓 선언. `claude plugin marketplace add owner/repo` 는 기본 브랜치를
 * 읽으므로, 플러그인 본체는 릴리스 브랜치를 가리키게 한다.
 */
export function rootClaudeMarketplace(config) {
  return {
    name: config.name,
    description: config.description,
    owner: { name: config.author.name },
    plugins: [
      {
        name: config.name,
        source: { source: 'github', repo: config.repository, ref: releaseBranch('claude') },
        description: config.description,
      },
    ],
  };
}
