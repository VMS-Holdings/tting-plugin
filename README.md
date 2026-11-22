# tting for Gemini CLI

Create, run, and inspect tting workflows, agents, and skills from your coding agent.

Version 0.1.2. This branch (`release/gemini`) is generated from
[VMS-Holdings/tting-plugin](https://github.com/VMS-Holdings/tting-plugin). Do not edit it by hand.

## Install

```bash
gemini extensions install https://github.com/VMS-Holdings/tting-plugin --auto-update
```

This installs the latest Gemini release of this repository and keeps it updated.

While the repository is private, Gemini CLI needs a token to read its releases. Set `GITHUB_TOKEN` to a
token that can read the repository. Or install from the release branch over SSH, and answer yes when
Gemini CLI offers to use git clone:

```bash
gemini extensions install git@github.com:VMS-Holdings/tting-plugin.git --ref release/gemini --auto-update
```

Sign in to tting when your agent asks to authorize the tting MCP server.
