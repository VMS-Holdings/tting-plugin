import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { loadConfig } from '../scripts/lib/config.mjs';
import { rootClaudeMarketplace, toJson } from '../scripts/lib/targets.mjs';

const ROOT = new URL('../', import.meta.url);

test('기본 브랜치의 Claude 마켓 선언이 설정과 어긋나지 않는다', async () => {
  const config = await loadConfig(new URL('plugin.config.json', ROOT));

  const committed = await readFile(new URL('.claude-plugin/marketplace.json', ROOT), 'utf8');

  assert.equal(committed, toJson(rootClaudeMarketplace(config)), '`npm run sync:root` 로 다시 만든다');
});
