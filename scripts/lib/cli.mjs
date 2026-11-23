import { fileURLToPath } from 'node:url';
import { AGENTS } from './config.mjs';

export const ROOT_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const ALL_AGENTS = 'all';

/** 워크스페이스 스크립트와 같은 `[action] target: message` 모양으로 찍는다. */
export function log(action, target, message) {
  process.stdout.write(`[${action}] ${target}: ${message}\n`);
}

/** `--agent` 값을 설정에 있는 에이전트 목록으로 푼다. */
export function selectAgents(requested, config) {
  const configured = AGENTS.filter((agent) => config.agents.includes(agent));
  if (requested === ALL_AGENTS) return configured;
  if (!configured.includes(requested)) {
    throw new Error(`--agent 는 ${[...configured, ALL_AGENTS].join(', ')} 중 하나여야 한다 (받은 값: ${requested})`);
  }
  return [requested];
}

/** 사유를 바꿔 던진 오류는 원래 사유를 `cause` 에 싣는다. 둘 다 보여 준다. */
export function formatError(error) {
  const cause = error.cause?.message;
  return cause === undefined ? error.message : `${error.message}\n원인: ${cause}`;
}

/** 실패를 삼키지 않는다. 사유를 찍고 0 이 아닌 코드로 끝낸다. */
export async function runCli(main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  }
}
