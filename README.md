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

Install the config dependencies once per machine — Pi does not auto-install
dependencies of local extensions:

```bash
npm i
```

MCP configuration is machine-specific and not tracked. Copy the example and
set the environment variables it references:

```bash
cp mcp.example.json mcp.json
export OBSIDIAN_PATH="$HOME/path/to/your/vault"
```

## Contents

- `settings.json` — Pi settings
- `mcp.example.json` — Template for MCP server configuration (copy to `mcp.json`)
- `keybindings.json` — Custom keybindings
- `blacklist.json` — Path blacklist
- `agents/` — Custom subagents
- `extensions/` — Pi extensions; `instructions.ts` lists files to load from the agent directory and project ancestors. Files with `applyTo` frontmatter are added as read-on-match pointers.
- `prompts/` — Prompt templates
- `themes/` — Custom themes

## User data (not tracked)

The following files are generated at runtime or are machine-specific and are
not committed:

- `mcp.json`
- `auth.json`
- `trust.json`
- `models-store.json`
- `memory/`
- `sessions/`
- `node_modules/`
- `npm/`

## License

MIT — see [LICENSE](./LICENSE).
