# Pi Config

Personal configuration for the [Pi coding agent](https://github.com/badlogic/pi-mono).

## Install

This repo is intended to be used as a git submodule inside dotfiles at
`home/pi/agent`.

```bash
cd ~/dotfiles
git submodule add https://github.com/PhilippOesch/pi-config.git home/pi/agent
git submodule update --init --recursive
```

Then symlink `home/pi` to `~/.pi`:

```bash
ln -s "$HOME/dotfiles/home/pi" "$HOME/.pi"
```

## Contents

- `settings.json` — Pi settings
- `mcp.json` — MCP server configuration
- `keybindings.json` — Custom keybindings
- `blacklist.json` — Path blacklist
- `agents/` — Custom subagents
- `extensions/` — Pi extensions
- `prompts/` — Prompt templates
- `themes/` — Custom themes

## User data (not tracked)

The following files are generated at runtime and are not committed:

- `auth.json`
- `trust.json`
- `models-store.json`
- `memory/`
- `sessions/`
- `node_modules/`
- `npm/`

## License

MIT — see [LICENSE](./LICENSE).
