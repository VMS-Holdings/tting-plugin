#!/usr/bin/env node
// 에이전트별 산출물을 dist/<agent> 에 짓는다.
//   node scripts/build.mjs                 # 전부
//   node scripts/build.mjs --agent gemini  # 하나만
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildAgent } from './lib/build.mjs';
import { ALL_AGENTS, ROOT_DIR, log, runCli, selectAgents } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';

await runCli(async () => {
  const { values } = parseArgs({
    options: { agent: { type: 'string', default: ALL_AGENTS }, out: { type: 'string', default: 'dist' } },
  });
  const config = await loadConfig(join(ROOT_DIR, 'plugin.config.json'));

  for (const agent of selectAgents(values.agent, config)) {
    const built = await buildAgent({
      config,
      agent,
      skillsDir: join(ROOT_DIR, 'skills'),
      outDir: resolve(ROOT_DIR, values.out),
    });
    log('build', agent, `${relative(ROOT_DIR, built.dir)} (v${built.version}, 스킬 ${built.skills.length}개)`);
  }
});
