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
- `example/agent/` — Example personal config files (`settings.json`, `keybindings.json`, `blacklist.json`, `mcp.example.json`)

## Personal config

This repo is a package, not a runnable `~/.pi/agent` directory. Copy the files
from `example/agent/` into your personal Pi config (e.g. `~/.pi/agent/`) and
adjust them for the machine:

```bash
mkdir -p ~/.pi/agent
cp example/agent/* ~/.pi/agent/
# Then edit ~/.pi/agent/settings.json and copy mcp.example.json to mcp.json
```

Add the package to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "git:github.com/PhilippOesch/pi-config"
  ]
}
```

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
