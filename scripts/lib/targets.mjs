// 에이전트마다 릴리스 브랜치에 놓일 파일을 만든다. 형식의 근거는 README 의 「에이전트별 형식」 표에 있다.

const GITHUB = 'https://github.com';
const GITHUB_SSH = 'git@github.com:';
// 저장소가 비공개인 동안 HTTPS 주소는 자격 증명 도우미가 있어야 받아진다. SSH 만 쓰는 사람을 위해 함께 싣는다.
const SSH_NOTE = 'If you reach GitHub over SSH, use the SSH address instead:';
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

/**
 * 저장소의 "latest" GitHub Release 표시를 받을 에이전트. Gemini CLI 는 `--ref` 없이 설치하거나 갱신할 때
 * 그 표시가 붙은 릴리스를 받는다. 다른 에이전트의 릴리스가 그 자리를 차지하면 Gemini 사용자가 남의 묶음을 받는다.
 */
const LATEST_RELEASE_AGENT = 'gemini';

export function isLatestRelease(agent) {
  return agent === LATEST_RELEASE_AGENT;
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

function repositorySshUrl(config) {
  return `${GITHUB_SSH}${config.repository}.git`;
}

function codeBlock(...commands) {
  return ['```bash', ...commands, '```'];
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
  const install = codeBlock(`claude plugin install ${config.name} --marketplace ${config.repository}`);
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
  const branch = releaseBranch('grok');
  const folder = `${config.name}-grok`;
  const install = [
    'Grok Build reads Claude Code plugins. Download this branch and point Grok at it:',
    '',
    ...codeBlock(`git clone --branch ${branch} ${repositoryUrl(config)}.git ${folder}`, `grok --plugin-dir ./${folder}`),
    '',
    SSH_NOTE,
    '',
    ...codeBlock(`git clone --branch ${branch} ${repositorySshUrl(config)} ${folder}`),
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
    ...codeBlock(`gemini extensions install ${repositoryUrl(config)} --auto-update`),
    '',
    'This installs the latest Gemini release of this repository and keeps it updated.',
    '',
    'While the repository is private, Gemini CLI needs a token to read its releases. Set `GITHUB_TOKEN` to a',
    'token that can read the repository. Or install from the release branch over SSH, and answer yes when',
    'Gemini CLI offers to use git clone:',
    '',
    ...codeBlock(
      `gemini extensions install ${repositorySshUrl(config)} --ref ${releaseBranch('gemini')} --auto-update`,
    ),
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
    ...codeBlock(`codex plugin marketplace add ${config.repository}@${releaseBranch('codex')}`),
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
