# tting-plugin

tting 을 코딩 에이전트에 붙이는 플러그인의 원본이다. 원본 하나에서 에이전트별 플러그인을 짓고, 에이전트마다 따로 릴리스한다.

플러그인에 담기는 것은 둘이다.

- **원격 MCP 서버 연결**: `https://mcp.tting.ai/mcp`
- **스킬**: `skills/` 아래의 영어 안내. tting 도구를 어떤 순서로 부르고 언제 사용자에게 물어야 하는지 적는다.

## 지원하는 에이전트

| 에이전트 | 릴리스 브랜치 | 형식 | 설치 |
| --- | --- | --- | --- |
| Claude Code | `release/claude` | 플러그인. `.claude-plugin/plugin.json`, `.mcp.json`, `skills/` | `claude plugin install tting --marketplace VMS-Holdings/tting-plugin` |
| Gemini CLI | `release/gemini` | 익스텐션. `gemini-extension.json`, `skills/` | `gemini extensions install git@github.com:VMS-Holdings/tting-plugin.git --ref release/gemini --auto-update` |
| Codex | `release/codex` | 포터블 플러그인과 마켓 선언. `.agents/plugins/marketplace.json`, `plugins/tting/` | `codex plugin marketplace add VMS-Holdings/tting-plugin@release/codex` |
| Grok Build | `release/grok` | Claude Code 형식 그대로 | `grok --plugin-dir <받은 폴더>` |

Claude Code 는 기본 브랜치의 `.claude-plugin/marketplace.json` 을 읽는다. 그 선언이 플러그인 본체를 `release/claude` 에서 가져오게 한다.

저장소가 비공개인 동안에는 저장소를 읽을 수 있는 사람만 설치할 수 있다. Gemini CLI 의 HTTPS 주소(`https://github.com/VMS-Holdings/tting-plugin`)는 git 에 HTTPS 자격 증명이 있을 때만 받아진다. SSH 만 쓰면 표의 SSH 주소를 쓴다.

### 형식의 근거와 확인 상태

| 에이전트 | 근거 | 확인 |
| --- | --- | --- |
| Claude Code | [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference), [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces) | `claude plugin validate --strict` 통과 (2.1.311) |
| Gemini CLI | [Extension reference](https://geminicli.com/docs/extensions/reference), [MCP servers](https://geminicli.com/docs/tools/mcp-server/) | `gemini extensions validate` 통과 (0.26.0) |
| Codex | [Build plugins](https://developers.openai.com/codex/plugins/build) | 문서만 따랐다. Codex 로 설치해 보지 못했다 |
| Grok Build | [Skills, Plugins, Marketplaces](https://docs.x.ai/build/features/skills-plugins-marketplaces). Claude Code 의 플러그인을 그대로 읽는다고 적혀 있다 | Claude 검증기는 통과. Grok 으로 설치해 보지 못했다 |

## 구조

```text
plugin.config.json        이름, 설명, MCP 주소, 에이전트별 버전. 원본은 이 파일 하나다
skills/<이름>/SKILL.md    모든 에이전트가 함께 쓰는 스킬
scripts/build.mjs         dist/<agent> 에 산출물을 짓는다
scripts/release.mjs       산출물을 release/<agent> 에 올리고 태그를 단다
scripts/sync-root.mjs     기본 브랜치의 Claude 마켓 선언을 다시 만든다
scripts/lib/              설정 검증, 에이전트별 형식, 짓기, 릴리스
test-support/             테스트가 함께 쓰는 git 도우미
.github/workflows/        verify (PR 과 main), release (손으로 실행)
test/                     node:test 로 쓴 테스트
.claude-plugin/marketplace.json   생성물. 손으로 고치지 않는다
```

## 고치는 법

- **스킬을 더한다**: `skills/<이름>/SKILL.md` 를 만든다. 머리말의 `name` 은 폴더 이름과 같아야 하고 `description` 이 있어야 한다. 어기면 짓기가 실패한다.
- **스킬 폴더에 둘 수 있는 것**: 보통 파일과 폴더뿐이다. 링크와 숨김 파일(`.env` 같은 것)이 있으면 짓기가 실패한다. 그대로 릴리스에 섞여 나가는 것을 막으려는 것이다.
- **머리말을 쓰는 법**: 짓기는 YAML 을 다 읽지 않는다. `name` 과 `description` 은 한 줄 값, 따옴표로 싼 값, 여러 줄 블록(`>`, `|`) 가운데 하나로 쓴다. 값 뒤에 주석을 달거나 값을 다음 줄에 쓰면 짓기가 실패한다.
- **설정을 고친다**: `plugin.config.json` 을 고친 뒤 `npm run sync:root` 를 돌린다. 돌리지 않으면 테스트가 어긋남을 잡는다.
- **에이전트를 더한다**: `scripts/lib/config.mjs` 의 `AGENTS` 와 `scripts/lib/targets.mjs` 에 그 에이전트의 형식을 더한다.

스킬과 MCP 응답에 싣는 문장은 영어로 쓴다.

## 릴리스

에이전트마다 버전이 따로다. 한 에이전트만 올려도 된다.

1. `plugin.config.json` 의 `agents.<agent>.version` 을 올려 main 에 넣는다.
2. GitHub Actions 의 `release` 워크플로를 main 에서 실행하고 에이전트를 고른다. `dry_run` 을 켜면 올리지 않고 산출물만 남긴다.

로컬에서도 같은 일을 할 수 있다.

```bash
npm run release -- --agent claude          # 무엇이 나갈지만 본다
npm run release -- --agent claude --push   # 실제로 올린다
npm run release -- --agent all --push      # 아직 나가지 않은 버전만 올린다
```

릴리스 하나가 남기는 것은 셋이다.

- `release/<agent>` 브랜치의 커밋 하나. 브랜치에는 그 에이전트의 산출물만 있다. 커밋 메시지의 `Source:` 줄이 어느 원본 커밋에서 지었는지 알려 준다.
- `<agent>-v<version>` 태그
- GitHub Release 와 `tting-plugin-<agent>-<version>.tar.gz` (워크플로로 실행했을 때)

지켜지는 것은 다음과 같다.

- 이미 나간 버전은 다시 낼 수 없다. 버전을 올려야 한다.
- 원격 main 의 끝에서만 올린다. 올리지 않은 작업 브랜치나 뒤처진 main 에서는 올리지 않는다.
- 커밋하지 않은 변경이 있으면 올리지 않는다. `skills/` 에 git 이 무시하는 파일이 있어도 올리지 않는다.
- 미리보기(`--push` 없이)는 어느 커밋에서든 된다. 원격에는 아무것도 올리지 않는다.
- 릴리스는 작업 중인 브랜치와 작업 트리를 건드리지 않는다.
- 워크플로는 main 에서만 릴리스한다. 쓰기 권한은 `release` 환경을 쓰는 잡에만 있고, 그 환경은 main 에서만 쓸 수 있다.

### 러너

워크플로는 리포 변수 `HOSTED_RUNNERS` 가 `off` 이면 조직의 셀프 호스트 러너에서 돈다. 검증과 테스트는 검사 풀(`vms-arm64-check`), 릴리스는 배포 풀(`vms-arm64-deploy`)을 쓴다. 변수를 지우면 GitHub 호스티드 러너로 돌아간다. tting, tting-cloud 와 같은 스위치다.

### 도중에 실패했을 때

- 에이전트 하나가 실패하면 그 앞의 에이전트는 이미 나가 있다. 원인을 고친 뒤 `all` 로 다시 실행한다. 나간 버전은 건너뛴다.
- 태그는 올라갔는데 GitHub Release 가 없으면 워크플로를 `all` 로 다시 실행한다. 빠진 GitHub Release 만 태그에서 다시 만든다.

## 검증

```bash
npm test
npm run build
claude plugin validate --strict dist/claude
claude plugin validate --strict .
gemini extensions validate dist/gemini
```

## 아직 확인하지 못한 것

- Codex 와 Grok Build 에서 실제로 설치되는지.
- 네 에이전트에서 tting 로그인(OAuth)까지 끝나는지.
- Claude 의 `claude plugin marketplace add` 로 비공개 저장소의 릴리스 브랜치를 받아 오는지. 첫 릴리스 뒤에 확인한다.
- Anthropic 디렉터리에 올리려면 LICENSE 와 아이콘, 개인정보처리방침 주소가 더 필요하다. `claude plugin validate` 가 알려 준다.
