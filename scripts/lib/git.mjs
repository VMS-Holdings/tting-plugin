import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function git(cwd, args, env = {}) {
  const { stdout } = await run('git', args, { cwd, env: { ...process.env, ...env } });
  return stdout.trim();
}

// --force 는 개인 전역 ignore 가 산출물의 파일을 빼지 못하게 한다.
export async function writeTree(repoDir, dir) {
  const gitDir = await git(repoDir, ['rev-parse', '--absolute-git-dir']);
  const scratch = await mkdtemp(join(tmpdir(), 'tting-plugin-index-'));
  const env = { GIT_DIR: gitDir, GIT_WORK_TREE: dir, GIT_INDEX_FILE: join(scratch, 'index') };
  try {
    await git(dir, ['add', '--all', '--force', '.'], env);
    return await git(dir, ['write-tree'], env);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
