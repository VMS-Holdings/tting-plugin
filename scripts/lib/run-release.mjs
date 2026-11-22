import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAgent } from './build.mjs';
import { ALL_AGENTS, log, selectAgents } from './cli.mjs';
import { assertNoIgnoredFiles, isReleased, releaseAgent } from './release.mjs';
import { isLatestRelease, releaseBranch, releaseTag, toJson } from './targets.mjs';

/** 워크플로가 이 목록을 읽어 GitHub Release 를 만든다. */
export const RELEASES_FILE = 'releases.json';

async function writeReleases(outDir, releases) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, RELEASES_FILE), toJson(releases));
}

async function releaseOne({ config, agent, skipReleased, repoDir, skillsDir, outDir, remote, push }) {
  const version = config.agents[agent].version;
  // 전부를 고른 경우에는 이미 나간 버전을 건너뛴다. 하나를 지목했으면 releaseAgent 가 거절한다.
  const latest = isLatestRelease(agent);
  if (skipReleased && (await isReleased({ repoDir, agent, version, remote }))) {
    const identity = { agent, version, branch: releaseBranch(agent), tag: releaseTag(agent, version) };
    return { ...identity, pushed: false, skipped: true, latest };
  }
  const built = await buildAgent({ config, agent, skillsDir, outDir });
  const released = await releaseAgent({ repoDir, agent, version, builtDir: built.dir, remote, push });
  return { ...released, skipped: false, latest };
}

function describe(release) {
  if (release.skipped) return `${release.tag} 는 이미 나갔다. 건너뛴다`;
  const outcome = release.pushed ? '올렸다' : '올리지 않았다. --push 로 올린다';
  return `${release.tag} -> ${release.branch} (${outcome})`;
}

/**
 * 고른 에이전트를 차례로 짓고 릴리스한다. 목록은 에이전트 하나가 끝날 때마다 다시 쓴다. 도중에
 * 실패해도 그 앞에 올린 릴리스를 다음 단계가 알 수 있게 하려는 것이다.
 */
export async function runRelease({ config, requested, repoDir, skillsDir, outDir, remote, push = false, report = log }) {
  const agents = selectAgents(requested, config);
  // 지난 실행의 목록이 남아 있으면 다음 단계가 그것을 이번 결과로 읽는다. 먼저 비운다.
  await writeReleases(outDir, []);
  if (push) await assertNoIgnoredFiles(repoDir, skillsDir);

  let releases = [];
  for (const agent of agents) {
    const release = await releaseOne({
      config,
      agent,
      skipReleased: requested === ALL_AGENTS,
      repoDir,
      skillsDir,
      outDir,
      remote,
      push,
    });
    releases = [...releases, release];
    await writeReleases(outDir, releases);
    report('release', agent, describe(release));
  }
  return releases;
}
