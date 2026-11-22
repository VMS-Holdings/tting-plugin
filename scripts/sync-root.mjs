#!/usr/bin/env node
// 기본 브랜치에 두는 Claude Code 마켓 선언을 설정에서 다시 만든다.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ROOT_DIR, log, runCli } from './lib/cli.mjs';
import { loadConfig } from './lib/config.mjs';
import { rootClaudeMarketplace, toJson } from './lib/targets.mjs';

const ROOT_MARKETPLACE = '.claude-plugin/marketplace.json';

await runCli(async () => {
  const config = await loadConfig(join(ROOT_DIR, 'plugin.config.json'));
  const path = join(ROOT_DIR, ROOT_MARKETPLACE);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, toJson(rootClaudeMarketplace(config)));
  log('sync', ROOT_MARKETPLACE, '설정에서 다시 만들었다');
});
