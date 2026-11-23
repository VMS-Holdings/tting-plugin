// 에이전트마다 릴리스 브랜치에 놓일 파일을 만든다. 형식의 근거는 README 의 「형식의 근거와 확인 상태」 표에 있다.

const GITHUB = 'https://github.com';
const GITHUB_SSH = 'git@github.com:';
const SSH_NOTE = 'If you reach GitHub over SSH, use the SSH address instead:';
const PORTABLE_PLUGIN_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const PORTABLE_MCP_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';
const CODEX_CATEGORY = 'Productivity';
const MARKETPLACE_ROOT_SOURCE = './';
const ASSET_PREFIX = 'tting-plugin';
const ARCHIVE_EXTENSION = 'tar.gz';
// Gemini CLI 는 릴리스에 묶음이 여럿이면 이름이 자기 플랫폼으로 시작하는 것만 고른다.
const GEMINI_PLATFORMS = Object.freeze(['darwin', 'linux', 'win32']);

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

export function releaseTag(version) {
  return `v${version}`;
}

export function assetNames(agent, version) {
  const name = `${ASSET_PREFIX}-${agent}-${version}.${ARCHIVE_EXTENSION}`;
  return agent === 'gemini' ? GEMINI_PLATFORMS.map((platform) => `${platform}.${name}`) : [name];
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

function metadata(config) {
  return withoutUndefined({
    name: config.name,
    displayName: config.displayName,
    version: config.version,
    description: config.description,
    author: config.author,
    homepage: config.homepage,
    repository: repositoryUrl(config),
    keywords: config.keywords,
  });
}

function readme(config, agent, install) {
  const lines = [
    `# ${config.displayName ?? config.name} for ${AGENT_TITLES[agent]}`,
    '',
    config.description,
    '',
    `Version ${config.version}. This branch (\`${releaseBranch(agent)}\`) is generated from`,
    `[${config.repository}](${repositoryUrl(config)}). Do not edit it by hand.`,
    '',
    '## Install',
    '',
    ...install,
    '',
    'Sign in to tting when your agent asks to authorize the tting MCP server.',
    '',
  ];
  return lines.join('\n');
}

function claudeFormatFiles(config) {
  return [
    { path: '.claude-plugin/plugin.json', content: toJson(metadata(config)) },
    {
      path: '.mcp.json',
      content: toJson({ mcpServers: { [config.mcp.serverName]: { type: 'http', url: config.mcp.url } } }),
    },
  ];
}

function claudeTarget(config) {
  return {
    skillsDir: 'skills',
    install: codeBlock(`claude plugin install ${config.name} --marketplace ${config.repository}`),
    files: claudeFormatFiles(config),
  };
}

/** Grok Build 는 Claude Code 의 플러그인과 마켓을 그대로 읽는다고 문서에 적혀 있다. 그래서 같은 형식을 낸다. */
function grokTarget(config) {
  const branch = releaseBranch('grok');
  const folder = `${config.name}-grok`;
  const [bundle] = assetNames('grok', config.version);
  const marketplace = {
    name: config.name,
    description: config.description,
    owner: { name: config.author.name },
    plugins: [{ name: config.name, source: MARKETPLACE_ROOT_SOURCE, description: config.description }],
  };
  return {
    skillsDir: 'skills',
    install: [
      'Grok Build reads Claude Code plugins. Download this branch and point Grok at it:',
      '',
      ...codeBlock(`git clone --branch ${branch} ${repositoryUrl(config)}.git ${folder}`, `grok --plugin-dir ./${folder}`),
      '',
      SSH_NOTE,
      '',
      ...codeBlock(`git clone --branch ${branch} ${repositorySshUrl(config)} ${folder}`),
      '',
      `Or download \`${bundle}\` from the \`${releaseTag(config.version)}\` release and unpack it into a folder.`,
    ],
    files: [
      ...claudeFormatFiles(config),
      { path: '.claude-plugin/marketplace.json', content: toJson(marketplace) },
    ],
  };
}

function geminiTarget(config) {
  const extension = {
    name: config.name,
    version: config.version,
    description: config.description,
    mcpServers: { [config.mcp.serverName]: { httpUrl: config.mcp.url } },
  };
  return {
    skillsDir: 'skills',
    install: [
      ...codeBlock(`gemini extensions install ${repositoryUrl(config)} --auto-update`),
      '',
      'This installs the latest release of this repository and keeps it updated.',
      '',
      'While the repository is private, Gemini CLI needs a token to read its releases. Set `GITHUB_TOKEN` to a',
      'token that can read the repository. Or install from the release branch over SSH, and answer yes when',
      'Gemini CLI offers to use git clone:',
      '',
      ...codeBlock(
        `gemini extensions install ${repositorySshUrl(config)} --ref ${releaseBranch('gemini')} --auto-update`,
      ),
    ],
    files: [{ path: 'gemini-extension.json', content: toJson(extension) }],
  };
}

function codexTarget(config) {
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
  return {
    skillsDir: `${pluginDir}/skills`,
    install: [
      ...codeBlock(`codex plugin marketplace add ${config.repository}@${releaseBranch('codex')}`),
      '',
      `Then open \`/plugins\` in Codex and install \`${config.name}\`.`,
    ],
    files: [
      { path: '.agents/plugins/marketplace.json', content: toJson(marketplace) },
      { path: `${pluginDir}/plugin.json`, content: toJson({ $schema: PORTABLE_PLUGIN_SCHEMA, ...metadata(config) }) },
      { path: `${pluginDir}/mcp.json`, content: toJson(mcp) },
    ],
  };
}

const TARGETS = Object.freeze({
  claude: claudeTarget,
  gemini: geminiTarget,
  codex: codexTarget,
  grok: grokTarget,
});

export function targetFor(agent, config) {
  if (!config.agents.includes(agent)) throw new Error(`plugin.config.json 의 agents 에 ${agent} 가 없다`);
  const target = TARGETS[agent](config);
  const readmeFile = { path: 'README.md', content: readme(config, agent, target.install) };
  return { ...target, files: [...target.files, readmeFile] };
}

function bundleLine(agent, version) {
  const names = assetNames(agent, version);
  const label = names.length > 1 ? 'Bundles (same content, one per platform)' : 'Bundle';
  return `${label}: ${names.map((name) => `\`${name}\``).join(', ')}`;
}

export function releaseNotes(config) {
  const sections = config.agents.flatMap((agent) => [
    `## ${AGENT_TITLES[agent]}`,
    '',
    ...targetFor(agent, config).install,
    '',
    bundleLine(agent, config.version),
    '',
  ]);
  const lines = [
    `${config.displayName ?? config.name} plugin ${releaseTag(config.version)}. ${config.description}`,
    '',
    'Each coding agent installs it in its own way.',
    '',
    ...sections,
  ];
  return lines.join('\n');
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
