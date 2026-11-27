# Contributing

This repository is the single source for the tting plugin. A build turns it into one plugin per coding agent. You need Node.js 20 or later. There are no dependencies to install.

## Layout

```text
plugin.config.json        Name, description, MCP URL, version, and agent list. The one source of truth
skills/<name>/SKILL.md    Skills shared by every agent
scripts/build.mjs         Builds each agent's output into dist/<agent>
scripts/release.mjs       Publishes the outputs to release/<agent> and creates one version tag
scripts/sync-root.mjs     Regenerates the Claude marketplace file on the default branch
scripts/lib/              Config validation, per-agent formats, build, release, and bundling
test/                     Tests written with node:test
test-support/             Git helpers shared by the tests
.github/workflows/        verify (pull requests and main), release (run by hand)
.claude-plugin/marketplace.json   Generated. Do not edit by hand
docs/images/              Screenshots used in the README
```

## Common changes

- **Add a skill.** Create `skills/<name>/SKILL.md`. The `name` in the front matter must match the folder name, and `description` is required. The build fails otherwise.
- **Files allowed in a skill folder.** Regular files and folders only. The build fails on symlinks and hidden files such as `.env`, so they cannot slip into a release.
- **Front matter format.** The build does not parse full YAML. Write `name` and `description` as a single-line value, a quoted value, or a block (`>` or `|`). A trailing comment or a value on the next line fails the build.
- **Change the config.** Edit `plugin.config.json`, then run `npm run sync:root`. A test catches it if you forget.
- **Add an agent.** Add its format to `AGENTS` in `scripts/lib/config.mjs` and to `scripts/lib/targets.mjs`, then add it to `agents` in `plugin.config.json`.
- **Change install instructions.** The README on each release branch and the release notes are generated from `scripts/lib/targets.mjs`. Keep them in line with the root `README.md`.

Write skills and any text an agent or user reads in English.

## Verify your change

```bash
npm test
npm run build
claude plugin validate --strict dist/claude
claude plugin validate --strict .
gemini extensions validate dist/gemini
```

The last three need Claude Code and Gemini CLI installed. `gemini extensions validate` warns that the version is not standard semver. That is expected.

## Format references

| Agent | Reference |
| --- | --- |
| Claude Code | [Plugin manifest reference](https://code.claude.com/docs/en/plugins-reference), [Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces) |
| Gemini CLI | [Extension reference](https://geminicli.com/docs/extensions/reference), [MCP servers](https://geminicli.com/docs/tools/mcp-server/) |
| Codex | [Build plugins](https://developers.openai.com/codex/plugins/build) |
| Grok Build | [Skills, Plugins, Marketplaces](https://docs.x.ai/build/features/skills-plugins-marketplaces). Grok Build reads Claude Code plugins as they are |

## Pull requests

- Use conventional commit messages: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`.
- Add or update tests with a code change.
- Do not change `version` in `plugin.config.json`. Maintainers set it when they release.
