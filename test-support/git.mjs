// 릴리스 테스트가 함께 쓰는 git 도우미. `test/` 밖에 둔다. 그 안의 파일은 모두 테스트로 실행된다.
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { devNull } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** 테스트가 개발자의 전역 git 설정(서명, 전역 ignore)에 기대지 않게 한다. */
export const GIT_ENV = Object.freeze({
  GIT_AUTHOR_NAME: 'release-test',
  GIT_AUTHOR_EMAIL: 'release-test@example.com',
  GIT_COMMITTER_NAME: 'release-test',
  GIT_COMMITTER_EMAIL: 'release-test@example.com',
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
});

export async function git(cwd, ...args) {
  const { stdout } = await run('git', args, { cwd, env: { ...process.env, ...GIT_ENV } });
  return stdout.trim();
}

export async function writeTreeFiles(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

/** 빈 원격과 그 클론을 만들고, 받은 파일을 main 의 첫 커밋으로 올린다. */
export async function createOriginAndClone(dir, files = { 'source.txt': 'source\n' }) {
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'work');
  await mkdir(dir, { recursive: true });
  await git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  await git(dir, 'clone', '-q', origin, work);
  await writeTreeFiles(work, files);
  await git(work, 'add', '.');
  await git(work, 'commit', '-q', '-m', 'chore: source');
  await git(work, 'push', '-q', 'origin', 'HEAD:main');
  return { origin, work };
}
