#!/usr/bin/env node
// 모든 에이전트의 산출물을 release/<agent> 브랜치에 올리고 v<version> 태그 하나를 단다.
//   node scripts/release.mjs [--push]   # --push 가 없으면 무엇이 나갈지만 본다
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ROOT_DIR, runCli } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { runRelease } from './lib/run-release.mjs';

const OUT_DIR = 'dist';

await runCli(async () => {
  const { values } = parseArgs({
    options: {
      push: { type: 'boolean', default: false },
      remote: { type: 'string', default: 'origin' },
    },
  });

  const config = await loadConfig(join(ROOT_DIR, 'plugin.config.json'));
  await runRelease({
    config,
    repoDir: ROOT_DIR,
    skillsDir: join(ROOT_DIR, 'skills'),
    outDir: join(ROOT_DIR, OUT_DIR),
    remote: values.remote,
    push: values.push,
  });
});
