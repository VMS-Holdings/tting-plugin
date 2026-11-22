import { readFile } from 'node:fs/promises';

/** 릴리스할 수 있는 에이전트. 하나를 더하려면 `targets.mjs` 에 그 에이전트의 산출물도 함께 더한다. */
export const AGENTS = Object.freeze(['claude', 'gemini', 'codex', 'grok']);

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
// GitHub 의 owner/repo. 각 칸이 `-` 나 `.` 로 시작하면 명령의 옵션이나 상위 경로로 읽힐 수 있어 막는다.
const REPOSITORY_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_][\w.-]*$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export class ConfigError extends Error {
  constructor(problems) {
    super(`plugin.config.json 이 올바르지 않다:\n- ${problems.join('\n- ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/** 선언 파일과 README 의 한 줄에 그대로 들어가는 값. 줄바꿈이 섞이면 문서의 모양을 바꿀 수 있다. */
function isSingleLine(value) {
  return isNonEmptyString(value) && !CONTROL_CHARACTER.test(value);
}

function isHttpsUrl(value) {
  if (!isNonEmptyString(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function metadataProblems(raw) {
  const problems = [];
  if (!isNonEmptyString(raw.name) || !KEBAB_CASE.test(raw.name)) {
    problems.push('name: kebab-case 여야 한다');
  }
  if (!isSingleLine(raw.description)) problems.push('description: 비어 있지 않은 한 줄이어야 한다');
  if (!isObject(raw.author) || !isSingleLine(raw.author.name)) {
    problems.push('author.name: 비어 있지 않은 한 줄이어야 한다');
  }
  if (!isNonEmptyString(raw.repository) || !REPOSITORY_SLUG.test(raw.repository)) {
    problems.push('repository: owner/repo 모양이어야 한다');
  }
  if (raw.displayName !== undefined && !isSingleLine(raw.displayName)) {
    problems.push('displayName: 비어 있지 않은 한 줄이어야 한다');
  }
  if (raw.homepage !== undefined && !isHttpsUrl(raw.homepage)) {
    problems.push('homepage: https 주소여야 한다');
  }
  if (isObject(raw.author) && raw.author.url !== undefined && !isHttpsUrl(raw.author.url)) {
    problems.push('author.url: https 주소여야 한다');
  }
  if (raw.keywords !== undefined && !(Array.isArray(raw.keywords) && raw.keywords.every(isSingleLine))) {
    problems.push('keywords: 문자열 배열이어야 한다');
  }
  return problems;
}

function mcpProblems(mcp) {
  if (!isObject(mcp)) return ['mcp: 없다'];
  const problems = [];
  if (!isNonEmptyString(mcp.serverName) || !KEBAB_CASE.test(mcp.serverName)) {
    problems.push('mcp.serverName: kebab-case 여야 한다');
  }
  if (!isHttpsUrl(mcp.url)) problems.push('mcp.url: https 주소여야 한다');
  return problems;
}

function agentProblems(agents) {
  if (!isObject(agents) || Object.keys(agents).length === 0) {
    return ['agents: 에이전트가 하나 이상 있어야 한다'];
  }
  return Object.entries(agents).flatMap(([agent, settings]) => {
    if (!AGENTS.includes(agent)) return [`agents.${agent}: 지원하지 않는 에이전트다 (${AGENTS.join(', ')})`];
    if (!isObject(settings) || typeof settings.version !== 'string' || !SEMVER.test(settings.version)) {
      return [`agents.${agent}.version: 1.2.3 모양이어야 한다`];
    }
    return [];
  });
}

function deepFreeze(value) {
  if (isObject(value) || Array.isArray(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** 문제를 하나씩 던지지 않고 모아서 알린다. 한 번 고쳐 한 번에 통과하게 하려는 것이다. */
export function validateConfig(raw) {
  if (!isObject(raw)) throw new ConfigError(['최상위가 객체여야 한다']);
  const problems = [...metadataProblems(raw), ...mcpProblems(raw.mcp), ...agentProblems(raw.agents)];
  if (problems.length > 0) throw new ConfigError(problems);
  return deepFreeze(structuredClone(raw));
}

export async function loadConfig(path) {
  const text = await readFile(path, 'utf8');
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError([`JSON 으로 읽을 수 없다: ${error.message}`]);
  }
  return validateConfig(raw);
}
