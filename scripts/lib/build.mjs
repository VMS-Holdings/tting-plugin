import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { targetFor } from './targets.mjs';

const SKILL_FILE = 'SKILL.md';
/** 운영체제가 만들어 두는 파일. 산출물에 넣지 않고, 있어도 문제 삼지 않는다. */
export const IGNORED_FILES = Object.freeze(new Set(['.DS_Store']));
const HIDDEN_PREFIX = '.';
const BYTE_ORDER_MARK = /^﻿/;
const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/;
const BLOCK_SCALAR = /^[>|][+-]?$/;
const INDENTED = /^\s/;
const QUOTES = new Set(['"', "'"]);

export class SkillError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SkillError';
  }
}

/** 따옴표를 열고 닫지 않은 값은 YAML 로 읽히지 않는다. 에이전트가 머리말을 통째로 버리므로 여기서 막는다. */
function unquote(value, label) {
  if (!QUOTES.has(value[0])) return value;
  if (value.length < 2 || value.at(-1) !== value[0]) {
    throw new SkillError(`${label}: 따옴표를 닫지 않았다`);
  }
  return value.slice(1, -1).trim();
}

/** YAML 을 다 읽지 않는다. 한 줄 값, 따옴표로 싼 값, 여러 줄 블록(`>`, `|`)까지만 안다. */
function frontmatterValue(frontmatter, key, skill) {
  const lines = frontmatter.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index === -1) return undefined;

  const value = lines[index].slice(key.length + 1).trim();
  if (!BLOCK_SCALAR.test(value)) return unquote(value, `skills/${skill}: 머리말의 ${key}`);

  const rest = lines.slice(index + 1);
  const end = rest.findIndex((line) => line.trim() !== '' && !INDENTED.test(line));
  const block = end === -1 ? rest : rest.slice(0, end);
  return block
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
}

async function readSkill(skillsDir, name) {
  let text;
  try {
    text = await readFile(join(skillsDir, name, SKILL_FILE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new SkillError(`skills/${name}: ${SKILL_FILE} 가 없다`);
    throw error;
  }
  // 윈도우에서 저장한 파일도 읽는다. 산출물에는 원본을 그대로 복사한다.
  const normalized = text.replace(BYTE_ORDER_MARK, '').replaceAll('\r\n', '\n');
  const frontmatter = FRONTMATTER.exec(normalized)?.[1];
  if (frontmatter === undefined) throw new SkillError(`skills/${name}: 머리말(--- 블록)이 없다`);
  if (frontmatterValue(frontmatter, 'name', name) !== name) {
    throw new SkillError(`skills/${name}: 머리말의 name 이 폴더 이름(${name})과 같아야 한다`);
  }
  if (!frontmatterValue(frontmatter, 'description', name)) {
    throw new SkillError(`skills/${name}: 머리말에 description 이 없다`);
  }
  return name;
}

function isIgnored(entry) {
  return IGNORED_FILES.has(entry.name);
}

/** 모든 에이전트가 같은 스킬을 받으므로, 여기서 한 번 틀리면 넷이 함께 틀린다. 짓기 전에 확인한다. */
async function readSkills(skillsDir) {
  const entries = (await readdir(skillsDir, { withFileTypes: true })).filter((entry) => !isIgnored(entry));
  const stray = entries.find((entry) => !entry.isDirectory());
  if (stray !== undefined) {
    throw new SkillError(`skills/${stray.name}: skills 바로 아래에는 스킬 폴더만 둔다 (링크도 안 된다)`);
  }
  if (entries.length === 0) throw new SkillError('skills: 스킬이 하나도 없다');
  return Promise.all(entries.map((entry) => readSkill(skillsDir, entry.name)));
}

/**
 * 릴리스에 들어갈 파일을 모은다. 보통 파일만 받는다. 링크는 저장소 밖의 파일을 끌어올 수 있고,
 * 숨김 파일은 `.env` 같은 것이 섞여 나갈 수 있어서 둘 다 거절한다.
 */
async function listSkillFiles(skillsDir, relativeDir = '') {
  const entries = await readdir(join(skillsDir, relativeDir), { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .filter((entry) => !isIgnored(entry))
      // async 로 둔다. 동기로 던지면 먼저 시작한 하위 폴더의 거절을 아무도 받지 못한다.
      .map(async (entry) => {
        const path = join(relativeDir, entry.name);
        if (entry.name.startsWith(HIDDEN_PREFIX)) {
          throw new SkillError(`skills/${path}: 숨김 파일은 릴리스에 넣지 않는다`);
        }
        if (entry.isDirectory()) return listSkillFiles(skillsDir, path);
        if (entry.isFile()) return [path];
        throw new SkillError(`skills/${path}: 링크나 특수 파일은 릴리스에 넣지 않는다`);
      }),
  );
  return nested.flat();
}

async function writeFiles(dir, files) {
  for (const file of files) {
    const path = join(dir, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
}

async function copySkillFiles(skillsDir, destination, files) {
  for (const file of files) {
    const path = join(destination, file);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(join(skillsDir, file), path);
  }
}

/** 한 에이전트의 산출물을 `outDir/<agent>` 에 새로 짓는다. 지난 산출물은 먼저 지운다. */
export async function buildAgent({ config, agent, skillsDir, outDir }) {
  const target = targetFor(agent, config);
  const skills = await readSkills(skillsDir);
  const skillFiles = await listSkillFiles(skillsDir);
  const dir = join(outDir, agent);

  await rm(dir, { recursive: true, force: true });
  await writeFiles(dir, target.files);
  await copySkillFiles(skillsDir, join(dir, target.skillsDir), skillFiles);

  return { agent, dir, version: config.version, skills };
}
