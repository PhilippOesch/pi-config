# pi-mp-my-agent

A Pi package with personal extensions, prompts, themes, and agents.

## Install

From git:

```bash
pi install git:github.com/PhilippOesch/pi-mp-my-agent
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
    "git:github.com/PhilippOesch/pi-mp-my-agent"
  ]
}
```

Create your own `settings.json`, `keybindings.json`, `blacklist.json`, and
`mcp.json` in `~/.pi/agent/` as needed.

`mcp.json`, `auth.json`, `trust.json`, `models-store.json`, `memory/`, and
`sessions/` are generated at runtime and are not tracked.

## Development

Load the package locally for one Pi session without installing it:

```bash
pi -e ./path/to/pi-mp-my-agent
```

Inside Pi, run `/reload` after making changes to extensions, prompts, themes, or agents so the runtime picks them up.

To install the package persistently (personal scope):

```bash
pi install ./path/to/pi-mp-my-agent
```

Or add it to `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "./path/to/pi-mp-my-agent"
  ]
}
```

Validate the package manifest before committing:

```bash
npm run validate
```

## License

MIT — see [LICENSE](./LICENSE).
