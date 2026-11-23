import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { packageAssets } from './assets.mjs';
import { buildAgent } from './build.mjs';
import { log } from './cli.mjs';
import { assertNoIgnoredFiles, publishRelease } from './release.mjs';
import { releaseNotes, toJson } from './targets.mjs';

// 워크플로가 이 셋을 읽어 GitHub Release 를 만든다.
export const RELEASE_FILE = 'release.json';
export const NOTES_FILE = 'release-notes.md';
export const ASSETS_DIR = 'assets';

async function buildAll({ config, skillsDir, outDir }) {
  let builds = [];
  for (const agent of config.agents) {
    builds = [...builds, await buildAgent({ config, agent, skillsDir, outDir })];
  }
  return builds;
}

function describe(release) {
  if (release.skipped) return '이 커밋에서 이미 나갔다. 올리지 않고 묶음만 다시 만들었다';
  if (!release.pushed) return `브랜치 ${release.agents.length}개와 태그를 올리지 않았다. --push 로 올린다`;
  return `브랜치 ${release.agents.length}개와 태그를 올렸다`;
}

export async function runRelease({ config, repoDir, skillsDir, outDir, remote, push = false, report = log }) {
  await mkdir(outDir, { recursive: true });
  // 지난 실행의 결과가 남아 있으면 실패한 뒤에 뒤 단계가 그것을 이번 결과로 읽는다.
  await rm(join(outDir, RELEASE_FILE), { force: true });
  if (push) await assertNoIgnoredFiles(repoDir, skillsDir);

  const builds = await buildAll({ config, skillsDir, outDir });
  const published = await publishRelease({ repoDir, version: config.version, builds, remote, push });
  const assets = await packageAssets({ repoDir, builds, version: config.version, assetsDir: join(outDir, ASSETS_DIR) });
  const release = { ...published, assets };

  await writeFile(join(outDir, NOTES_FILE), releaseNotes(config));
  await writeFile(join(outDir, RELEASE_FILE), toJson(release));
  report('release', release.tag, describe(release));
  return release;
}
