# tting-plugin

tting 을 코딩 에이전트에 붙이는 플러그인의 원본이다. 원본 하나에서 에이전트별 플러그인을 짓고, 버전 태그 하나로 함께 릴리스한다. 에이전트는 저마다 자기 묶음을 받아 간다.

플러그인에 담기는 것은 둘이다.

- **원격 MCP 서버 연결**: `https://mcp.tting.ai/mcp`
- **스킬**: `skills/` 아래의 영어 안내. tting 도구를 어떤 순서로 부르고 언제 사용자에게 물어야 하는지 적는다.

## 지원하는 에이전트

| 에이전트 | 받아 가는 곳 | 형식 | 설치 |
| --- | --- | --- | --- |
| Claude Code | `release/claude` 브랜치 | 플러그인. `.claude-plugin/plugin.json`, `.mcp.json`, `skills/` | `claude plugin install tting --marketplace VMS-Holdings/tting-plugin` |
| Gemini CLI | 최신 GitHub Release 의 Gemini 묶음 | 익스텐션. `gemini-extension.json`, `skills/` | `gemini extensions install https://github.com/VMS-Holdings/tting-plugin --auto-update` |
| Codex | `release/codex` 브랜치 | 포터블 플러그인과 마켓 선언. `.agents/plugins/marketplace.json`, `plugins/tting/` | `codex plugin marketplace add VMS-Holdings/tting-plugin@release/codex` |
| Grok Build | `release/grok` 브랜치나 릴리스의 Grok 묶음 | Claude Code 형식 그대로 | `grok --plugin-dir <받은 폴더>` |

### 버전과 태그

버전은 릴리스 날짜와 그날의 순번이다. `yy.mm.dd.n` 으로 쓴다. 2026년 11월 23일의 첫 릴리스는 `26.11.23.0` 이고 태그는 `v26.11.23.0` 이다. 같은 날 다시 내면 마지막 칸을 올린다.

태그 하나에 GitHub Release 하나가 붙고, 거기에 에이전트별 묶음이 실린다.

| 묶음 | 받는 쪽 |
| --- | --- |
| `tting-plugin-claude-<version>.tar.gz` | Claude Code |
| `darwin.`, `linux.`, `win32.` 로 시작하는 `tting-plugin-gemini-<version>.tar.gz` 셋 | Gemini CLI. 내용은 같다 |
| `tting-plugin-codex-<version>.tar.gz` | Codex |
| `tting-plugin-grok-<version>.tar.gz` | Grok Build |

Gemini 묶음만 셋인 것은 Gemini CLI 가 묶음을 고르는 방식 때문이다. 릴리스에 묶음이 여럿이면 이름이 자기 플랫폼으로 시작하는 것만 고르고, 없으면 태그의 원본을 통째로 받는다. 그래서 macOS, Linux, Windows 가 아닌 곳에서는 이 명령으로 설치되지 않는다. 그런 곳에서는 릴리스 브랜치로 받는다.

Claude Code 는 기본 브랜치의 `.claude-plugin/marketplace.json` 을 읽는다. 그 선언이 플러그인 본체를 `release/claude` 에서 가져오게 한다.

저장소가 비공개인 동안에는 저장소를 읽을 수 있는 사람만 설치할 수 있다. Gemini CLI 는 릴리스를 읽을 토큰이 필요하다. `GITHUB_TOKEN` 을 주거나, SSH 로 릴리스 브랜치를 받는다(`gemini extensions install git@github.com:VMS-Holdings/tting-plugin.git --ref release/gemini --auto-update`). 브랜치로 받으면 설치와 갱신 때마다 git clone 으로 받을지 한 번씩 묻는다.

2026-11-22 에 낸 `claude-v0.1.0` 같은 에이전트별 태그는 이 방식으로 바꾸기 전의 것이다. 지우지 않고 둔다.

### 형식의 근거와 확인 상태

| 에이전트 | 근거 | 확인 (2026-11-22) |
| --- | --- | --- |
| Claude Code | [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference), [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces) | `claude plugin validate --strict` 통과 (2.1.311). 표의 명령으로 비공개 저장소에서 설치했다. 플러그인의 MCP 서버가 로그인 대기 상태로 잡힌다 |
| Gemini CLI | [Extension reference](https://geminicli.com/docs/extensions/reference), [MCP servers](https://geminicli.com/docs/tools/mcp-server/) | `gemini extensions validate` 통과 (0.26.0). 표의 명령으로 최신 Gemini 릴리스를 받았다(`GITHUB_TOKEN` 을 줬다). SSH 와 릴리스 브랜치로도 설치했다 |
| Codex | [Build plugins](https://developers.openai.com/codex/plugins/build) | 문서만 따랐다. Codex 로 설치해 보지 못했다 |
| Grok Build | [Skills, Plugins, Marketplaces](https://docs.x.ai/build/features/skills-plugins-marketplaces). Claude Code 의 플러그인을 그대로 읽는다고 적혀 있다 | Claude 검증기는 통과. Grok 으로 설치해 보지 못했다 |

## 구조

```text
plugin.config.json        이름, 설명, MCP 주소, 버전, 에이전트 목록. 원본은 이 파일 하나다
skills/<이름>/SKILL.md    모든 에이전트가 함께 쓰는 스킬
scripts/build.mjs         dist/<agent> 에 산출물을 짓는다
scripts/release.mjs       산출물을 release/<agent> 에 올리고 버전 태그 하나를 단다
scripts/sync-root.mjs     기본 브랜치의 Claude 마켓 선언을 다시 만든다
scripts/lib/              설정 검증, 에이전트별 형식, 짓기, 릴리스, 묶음 만들기
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
- **에이전트를 더한다**: `scripts/lib/config.mjs` 의 `AGENTS` 와 `scripts/lib/targets.mjs` 에 그 에이전트의 형식을 더하고, `plugin.config.json` 의 `agents` 에 넣는다.

스킬과 MCP 응답에 싣는 문장은 영어로 쓴다.

## 릴리스

모든 에이전트가 같은 버전으로 함께 나간다.

1. `plugin.config.json` 의 `version` 을 올려 main 에 넣는다.
2. GitHub Actions 의 `release` 워크플로를 main 에서 실행한다. `dry_run` 을 켜면 올리지 않고 산출물만 남긴다.

로컬에서도 같은 일을 할 수 있다. GitHub Release 와 묶음 올리기는 워크플로만 한다.

```bash
npm run release             # 무엇이 나갈지만 본다. dist/ 에 묶음과 릴리스 노트가 생긴다
npm run release -- --push   # 브랜치와 태그를 실제로 올린다
```

릴리스 하나가 남기는 것은 셋이다.

- 에이전트마다 `release/<agent>` 브랜치의 커밋 하나. 브랜치에는 그 에이전트의 산출물만 있다. 커밋 메시지의 `Source:` 줄이 어느 원본 커밋에서 지었는지 알려 준다.
- `v<version>` 태그 하나. main 의 원본 커밋을 가리킨다.
- GitHub Release 하나와 에이전트별 묶음. 릴리스 노트에 에이전트마다 받아 가는 법이 적힌다.

지켜지는 것은 다음과 같다.

- 브랜치와 태그는 한 번에 올라간다. 하나라도 거절되면 아무것도 올라가지 않는다.
- 이미 나간 버전은 다른 커밋에서 다시 낼 수 없다. 버전을 올려야 한다.
- 태그를 손으로 먼저 달면 릴리스가 거절된다. 태그는 릴리스 스크립트만 단다.
- 원격 main 의 끝에서만 올린다. 올리지 않은 작업 브랜치나 뒤처진 main 에서는 올리지 않는다.
- 커밋하지 않은 변경이 있으면 올리지 않는다. `skills/` 에 git 이 무시하는 파일이 있어도 올리지 않는다.
- 미리보기(`--push` 없이)는 어느 커밋에서든 된다. 원격에는 아무것도 올리지 않는다.
- 릴리스는 작업 중인 브랜치와 작업 트리를 건드리지 않는다.
- 워크플로는 main 에서만 릴리스한다. 쓰기 권한은 `release` 환경을 쓰는 잡에만 있고, 그 환경은 main 에서만 쓸 수 있다.
- 저장소 규칙(Settings 의 Rulesets)이 서버에서도 막는다. 버전 태그는 옮기거나 지울 수 없고, `release/<agent>` 브랜치는 강제 푸시와 삭제가 안 된다. 잘못 나간 릴리스를 지우려면 관리자가 규칙을 잠시 꺼야 한다.

### 러너

워크플로는 리포 변수 `HOSTED_RUNNERS` 가 `off` 이면 조직의 셀프 호스트 러너에서 돈다. 검증과 테스트는 검사 풀(`vms-arm64-check`), 릴리스는 배포 풀(`vms-arm64-deploy`)을 쓴다. 변수를 지우면 GitHub 호스티드 러너로 돌아간다. tting, tting-cloud 와 같은 스위치다.

### 도중에 실패했을 때

- 브랜치와 태그를 올리다 실패하면 원격에는 아무것도 남지 않는다. 원인을 고치고 다시 실행한다.
- 태그는 올라갔는데 GitHub Release 가 없으면 같은 실행을 다시 돌린다(Re-run). 같은 커밋이면 올리기는 건너뛰고 GitHub Release 만 만든다.

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
- Anthropic 디렉터리에 올리려면 LICENSE 와 아이콘, 개인정보처리방침 주소가 더 필요하다. `claude plugin validate` 가 알려 준다.
