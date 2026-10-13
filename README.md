# pi-mp-my-agent

A Pi package with personal extensions, prompts, themes, and agents.

## Install

From git:

```bash
pi install git:github.com/PhilippOesch/pi-config
```

Or use a local copy during development:

```bash
pi install ./path/to/pi-config
```

## Contents

- `extensions/` — Pi extensions
- `prompts/` — Prompt templates
- `themes/` — Custom themes
- `agents/` — Subagent definitions loaded by the `subagents` extension

## Personal config

This repo is a package, not a runnable `~/.pi/agent` directory. In your
personal Pi config (e.g. `~/.pi/agent/`) add the package:

```json
{
  "packages": [
    "git:github.com/PhilippOesch/pi-config"
  ]
}
```

Create your own `settings.json`, `keybindings.json`, `blacklist.json`, and
`mcp.json` in `~/.pi/agent/` as needed.

`mcp.json`, `auth.json`, `trust.json`, `models-store.json`, `memory/`, and
`sessions/` are generated at runtime and are not tracked.

## Development

```bash
npm install
```

The `subagents` extension has its own tooling; run its checks from
`extensions/subagents/`.

## License

MIT — see [LICENSE](./LICENSE).
