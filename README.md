# tting for Grok Build

Create, run, and inspect tting workflows, agents, and skills from your coding agent.

Version 0.1.1. This branch (`release/grok`) is generated from
[VMS-Holdings/tting-plugin](https://github.com/VMS-Holdings/tting-plugin). Do not edit it by hand.

## Install

Grok Build reads Claude Code plugins. Download this branch and point Grok at it:

```bash
git clone --branch release/grok https://github.com/VMS-Holdings/tting-plugin.git tting-grok
grok --plugin-dir ./tting-grok
```

If you reach GitHub over SSH, use the SSH address instead:

```bash
git clone --branch release/grok git@github.com:VMS-Holdings/tting-plugin.git tting-grok
```

Sign in to tting when your agent asks to authorize the tting MCP server.
