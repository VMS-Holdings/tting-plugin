#!/usr/bin/env node
// 에이전트의 산출물을 release/<agent> 브랜치에 올리고 <agent>-v<version> 태그를 단다.
//   node scripts/release.mjs --agent claude          # 무엇이 나갈지만 본다
//   node scripts/release.mjs --agent claude --push   # 실제로 올린다
//   node scripts/release.mjs --agent all --push      # 아직 안 나간 버전만 올린다
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT_DIR, runCli } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { runRelease } from './lib/run-release.mjs';

const OUT_DIR = 'dist';

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      agent: { type: 'string' },
      push: { type: 'boolean', default: false },
      remote: { type: 'string', default: 'origin' },
    },
  });
  if (values.agent === undefined) throw new Error('--agent 가 필요하다');

  const config = await loadConfig(join(ROOT_DIR, 'plugin.config.json'));
  await runRelease({
    config,
    requested: values.agent,
    repoDir: ROOT_DIR,
    skillsDir: join(ROOT_DIR, 'skills'),
    outDir: join(ROOT_DIR, OUT_DIR),
    remote: values.remote,
    push: values.push,
  });
});
