import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { buildAgent, SkillError } from '../scripts/lib/build.mjs';
import { validateConfig } from '../scripts/lib/config.mjs';

const config = validateConfig({
  name: 'tting',
  description: 'Create and run tting workflows.',
  author: { name: 'tting' },
  repository: 'VMS-Holdings/tting-plugin',
  mcp: { serverName: 'tting', url: 'https://mcp.tting.ai/mcp' },
  agents: { claude: { version: '0.1.0' }, codex: { version: '0.1.0' } },
});

const SKILL = '---\nname: using-tting\ndescription: Use tting.\n---\n\n# Using tting\n';

let root;

async function writeSkill(skillsDir, name, content) {
  await mkdir(join(skillsDir, name), { recursive: true });
  await writeFile(join(skillsDir, name, 'SKILL.md'), content);
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'tting-plugin-build-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

test('선언 파일을 쓰고 스킬을 에이전트의 자리에 복사한다', async () => {
  const skillsDir = join(root, 'ok', 'skills');
  await writeSkill(skillsDir, 'using-tting', SKILL);
  await writeFile(join(skillsDir, 'using-tting', 'notes.md'), 'extra\n');

  const result = await buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'ok', 'dist') });

  assert.equal(result.dir, join(root, 'ok', 'dist', 'claude'));
  assert.equal(result.version, '0.1.0');
  const manifest = JSON.parse(await readFile(join(result.dir, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'tting');
  assert.equal(await readFile(join(result.dir, 'skills', 'using-tting', 'SKILL.md'), 'utf8'), SKILL);
  assert.equal(await readFile(join(result.dir, 'skills', 'using-tting', 'notes.md'), 'utf8'), 'extra\n');
});

test('codex 는 스킬을 플러그인 디렉터리 아래에 둔다', async () => {
  const skillsDir = join(root, 'codex', 'skills');
  await writeSkill(skillsDir, 'using-tting', SKILL);

  const result = await buildAgent({ config, agent: 'codex', skillsDir, outDir: join(root, 'codex', 'dist') });

  const copied = join(result.dir, 'plugins', 'tting', 'skills', 'using-tting', 'SKILL.md');
  assert.equal(await readFile(copied, 'utf8'), SKILL);
});

test('다시 지으면 지난 산출물이 남지 않는다', async () => {
  const skillsDir = join(root, 'clean', 'skills');
  const outDir = join(root, 'clean', 'dist');
  await writeSkill(skillsDir, 'using-tting', SKILL);
  await mkdir(join(outDir, 'claude'), { recursive: true });
  await writeFile(join(outDir, 'claude', 'stale.txt'), 'old');

  await buildAgent({ config, agent: 'claude', skillsDir, outDir });

  assert.equal((await readdir(join(outDir, 'claude'))).includes('stale.txt'), false);
});

test('SKILL.md 가 없는 스킬 폴더는 거절한다', async () => {
  const skillsDir = join(root, 'missing', 'skills');
  await mkdir(join(skillsDir, 'empty'), { recursive: true });

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'missing', 'dist') }),
    SkillError,
  );
});

test('머리말의 name 이 폴더 이름과 다르면 거절한다', async () => {
  const skillsDir = join(root, 'mismatch', 'skills');
  await writeSkill(skillsDir, 'using-tting', SKILL.replace('name: using-tting', 'name: other'));

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'mismatch', 'dist') }),
    (error) => error instanceof SkillError && /name 이 폴더 이름\(using-tting\)/.test(error.message),
  );
});

test('머리말에 description 이 없으면 거절한다', async () => {
  const skillsDir = join(root, 'nodesc', 'skills');
  await writeSkill(skillsDir, 'using-tting', '---\nname: using-tting\n---\n\nbody\n');

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'nodesc', 'dist') }),
    /description/,
  );
});

test('스킬이 하나도 없으면 거절한다', async () => {
  const skillsDir = join(root, 'none', 'skills');
  await mkdir(skillsDir, { recursive: true });

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'none', 'dist') }),
    SkillError,
  );
});

test('머리말의 description 이 빈 따옴표면 거절한다', async () => {
  const skillsDir = join(root, 'emptydesc', 'skills');
  await writeSkill(skillsDir, 'using-tting', '---\nname: using-tting\ndescription: ""\n---\n\nbody\n');

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'emptydesc', 'dist') }),
    (error) => error instanceof SkillError && /description/.test(error.message),
  );
});

test('윈도우 줄바꿈과 BOM 이 있는 머리말도 읽는다', async () => {
  const skillsDir = join(root, 'crlf', 'skills');
  await writeSkill(skillsDir, 'using-tting', `\uFEFF${SKILL.replaceAll('\n', '\r\n')}`);

  const result = await buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'crlf', 'dist') });

  assert.deepEqual(result.skills, ['using-tting']);
});

test('따옴표로 싼 값과 여러 줄 description 도 읽는다', async () => {
  const skillsDir = join(root, 'yaml', 'skills');
  const content = '---\nname: "using-tting"\ndescription: >-\n  Use tting\n  from your agent.\n---\n\nbody\n';
  await writeSkill(skillsDir, 'using-tting', content);

  const result = await buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'yaml', 'dist') });

  assert.deepEqual(result.skills, ['using-tting']);
});

test('여러 줄 description 이 비어 있으면 거절한다', async () => {
  const skillsDir = join(root, 'emptyblock', 'skills');
  await writeSkill(skillsDir, 'using-tting', '---\ndescription: >\nname: using-tting\n---\n\nbody\n');

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'emptyblock', 'dist') }),
    /description/,
  );
});

test('.DS_Store 는 산출물에 넣지 않는다', async () => {
  const skillsDir = join(root, 'dsstore', 'skills');
  await writeSkill(skillsDir, 'using-tting', SKILL);
  await writeFile(join(skillsDir, '.DS_Store'), 'x');
  await writeFile(join(skillsDir, 'using-tting', '.DS_Store'), 'x');

  const result = await buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'dsstore', 'dist') });

  assert.deepEqual(await readdir(join(result.dir, 'skills')), ['using-tting']);
  assert.deepEqual(await readdir(join(result.dir, 'skills', 'using-tting')), ['SKILL.md']);
});

test('스킬 안의 링크는 거절한다', async () => {
  const skillsDir = join(root, 'link', 'skills');
  await writeSkill(skillsDir, 'using-tting', SKILL);
  await writeFile(join(root, 'link', 'secret.txt'), 'secret\n');
  await symlink(join(root, 'link', 'secret.txt'), join(skillsDir, 'using-tting', 'notes.txt'));

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'link', 'dist') }),
    (error) => error instanceof SkillError && /using-tting\/notes\.txt/.test(error.message),
  );
  await assert.rejects(access(join(root, 'link', 'dist', 'claude')));
});

test('링크로 건 스킬 폴더는 거절한다', async () => {
  const skillsDir = join(root, 'linkdir', 'skills');
  await writeSkill(join(root, 'linkdir', 'elsewhere'), 'using-tting', SKILL);
  await mkdir(skillsDir, { recursive: true });
  await symlink(join(root, 'linkdir', 'elsewhere', 'using-tting'), join(skillsDir, 'using-tting'));

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'linkdir', 'dist') }),
    SkillError,
  );
});

test('스킬 안의 숨김 파일은 거절한다', async () => {
  const skillsDir = join(root, 'hidden', 'skills');
  await writeSkill(skillsDir, 'using-tting', SKILL);
  await writeFile(join(skillsDir, 'using-tting', '.env'), 'TOKEN=x\n');

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'hidden', 'dist') }),
    (error) => error instanceof SkillError && /\.env/.test(error.message),
  );
});

test('skills 바로 아래의 낱개 파일은 거절한다', async () => {
  const skillsDir = join(root, 'stray', 'skills');
  await writeSkill(skillsDir, 'using-tting', SKILL);
  await writeFile(join(skillsDir, 'README.md'), 'stray\n');

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'stray', 'dist') }),
    (error) => error instanceof SkillError && /README\.md/.test(error.message),
  );
});

test('따옴표를 닫지 않은 값은 거절한다', async () => {
  const skillsDir = join(root, 'unclosed', 'skills');
  await writeSkill(skillsDir, 'using-tting', '---\nname: using-tting\ndescription: "Use tting\n---\n\nbody\n');

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'unclosed', 'dist') }),
    (error) => error instanceof SkillError && /따옴표/.test(error.message),
  );
});

test('여러 폴더에 걸린 위반도 하나의 SkillError 로 알린다', async () => {
  const skillsDir = join(root, 'many', 'skills');
  await writeSkill(skillsDir, 'using-tting', SKILL);
  await mkdir(join(skillsDir, 'using-tting', 'a'), { recursive: true });
  await mkdir(join(skillsDir, 'using-tting', 'z'), { recursive: true });
  await writeFile(join(skillsDir, 'using-tting', 'a', '.env'), 'x\n');
  await writeFile(join(skillsDir, 'using-tting', 'z', '.env'), 'x\n');

  await assert.rejects(
    buildAgent({ config, agent: 'claude', skillsDir, outDir: join(root, 'many', 'dist') }),
    SkillError,
  );
});
