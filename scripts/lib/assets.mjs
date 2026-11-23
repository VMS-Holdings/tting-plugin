import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { git, writeTree } from './git.mjs';
import { assetNames } from './targets.mjs';

async function archiveBuild({ repoDir, build, version, assetsDir }) {
  const tree = await writeTree(repoDir, build.dir);
  const names = assetNames(build.agent, version);
  for (const name of names) {
    await git(repoDir, ['archive', '--format=tar.gz', `--output=${join(assetsDir, name)}`, tree]);
  }
  return names;
}

// 묶음은 선언 파일이 맨 위에 오게 싼다. Gemini CLI 가 묶음의 맨 위에서 선언 파일을 찾는다.
export async function packageAssets({ repoDir, builds, version, assetsDir }) {
  await rm(assetsDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });
  const names = await Promise.all(builds.map((build) => archiveBuild({ repoDir, build, version, assetsDir })));
  return names.flat();
}
