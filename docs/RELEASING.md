# Releasing

Every agent is released together under one version. This page is for maintainers.

## Versions and tags

A version is the release date plus a counter for that day, written `yy.mm.dd.n`. The first release on 23 November 2026 is `26.11.23.0` and its tag is `v26.11.23.0`. A second release on the same day raises the last number.

Each tag has one GitHub Release, which carries a bundle per agent.

| Bundle | Used by |
| --- | --- |
| `tting-plugin-claude-<version>.tar.gz` | Claude Code |
| Three `tting-plugin-gemini-<version>.tar.gz` files prefixed `darwin.`, `linux.`, and `win32.` | Gemini CLI. The content is the same |
| `tting-plugin-codex-<version>.tar.gz` | Codex |
| `tting-plugin-grok-<version>.tar.gz` | Grok Build |

Gemini has three bundles because of how Gemini CLI picks one. When a release has several bundles, it takes only the one whose name starts with its own platform. If none matches, it downloads the whole source at the tag. So on platforms other than macOS, Linux, and Windows, users install from the `release/gemini` branch.

Claude Code reads `.claude-plugin/marketplace.json` on the default branch. That file points the plugin at `release/claude`.

The per-agent tags from 22 November 2026, such as `claude-v0.1.0`, come from before this scheme. They stay as they are.

## How to release

1. Raise `version` in `plugin.config.json` and merge it into `main`.
2. Run the `release` workflow in GitHub Actions on `main`. Turn on `dry_run` to build the outputs without publishing.

You can do the same locally. Only the workflow creates the GitHub Release and uploads bundles.

```bash
npm run release             # Preview only. Writes bundles and release notes to dist/
npm run release -- --push   # Pushes the branches and the tag
```

One release leaves three things:

- One commit on each `release/<agent>` branch. The branch holds only that agent's output. The `Source:` line of the commit message names the source commit it was built from.
- One `v<version>` tag, pointing at the source commit on `main`.
- One GitHub Release with a bundle per agent. The release notes carry each agent's install instructions.

## Guarantees

- Branches and the tag are pushed in one step. If any of them is rejected, nothing is pushed.
- A version that is already out cannot be released again from another commit. Raise the version.
- A tag created by hand makes the release fail. Only the release script creates tags.
- A release is pushed only from the tip of the remote `main`, not from an unpushed branch or a `main` that is behind.
- A release is not pushed with uncommitted changes, or with files in `skills/` that git ignores.
- A preview (without `--push`) works from any commit and pushes nothing.
- A release does not touch your current branch or working tree.
- The workflow releases only from `main`. Write permission belongs only to the job that uses the `release` environment, and that environment is limited to `main`.
- Repository rulesets enforce this on the server as well. Version tags cannot be moved or deleted, and `release/<agent>` branches cannot be force-pushed or deleted. To remove a bad release, an admin has to turn the rules off for a moment.

## Runners

When the repository variable `HOSTED_RUNNERS` is `off`, the workflows run on the organization's self-hosted runners: `vms-arm64-check` for verification and `vms-arm64-deploy` for releases. Remove the variable to go back to GitHub-hosted runners.

## If a release fails midway

- If pushing the branches and the tag fails, nothing is left on the remote. Fix the cause and run it again.
- If the tag is there but the GitHub Release is missing, re-run the same workflow run. For the same commit it skips the push and only creates the GitHub Release.

## After a release

Install the new version in each agent with the commands in the [README](../README.md) and check that the version shown matches. Update the screenshots in `docs/images/` if the output changed.

## Not yet verified

- Completing the tting OAuth sign-in from each of the four agents.
- Listing in the Anthropic plugin directory needs a LICENSE, an icon, and a privacy policy URL. `claude plugin validate` reports what is missing.
