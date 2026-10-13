---
name: setup-agent-context
description: Set up or reconfigure the agent context folder inside an Obsidian vault. Use when the user asks to configure agent context, set up the knowledge base, choose the vault path, initialize agent folders, or reconfigure where agent output is stored.
---

# setup-agent-context

Goal: ensure `~/.pi/agent/pi-mp-my-agent.json` exists and points to a valid agent-context folder tree.

Done when:
- Config file is written.
- Agent-context folder and its subfolders exist.
- User confirms the vault path and layout.

## Steps

1. **Load or create config**
   - Path: `~/.pi/agent/pi-mp-my-agent.json`.
   - If it exists, read it.
   - If it is missing or the `knowledge` section is missing, start with the default config below.

2. **Resolve vault path**
   - Ask the user for the Obsidian vault root if `knowledge.obsidianVaultPath` is empty.
   - Prefer an existing path. Validate it exists.
   - If the user wants a separate agent-context location, set `knowledge.agentContextPath` explicitly; otherwise default to `<obsidianVaultPath>/agent-context`.

3. **Create folder tree**
   - Create `agentContextPath` and these subfolders:
     - `00-inbox/`
     - `10-plans/`
     - `20-research/`
     - `30-reference/`
     - `40-handoff/`
     - `99-archive/`

4. **Write config**
   - Write the resolved paths and folder names back to `~/.pi/agent/pi-mp-my-agent.json`.
   - Show the user the final config and folder list.

## Default config

```json
{
  "knowledge": {
    "obsidianVaultPath": "<user-provided>",
    "agentContextPath": "<obsidianVaultPath>/agent-context",
    "folders": {
      "inbox": "00-inbox",
      "plan": "10-plans",
      "research": "20-research",
      "reference": "30-reference",
      "handoff": "40-handoff",
      "archive": "99-archive"
    },
    "naming": "timestamp-slug",
    "frontmatter": ["id", "type", "audience", "status", "created", "tags", "source"]
  }
}
```

## File naming

- Use `<timestamp>-<slug>.md`.
- Timestamp format: `yyMMddHHmm` (10 digits, sortable, human-readable date).
- Slug: lower-case, hyphenated title. Keep it short.

## Note types and audience

- `plan` — implementation or project plans.
- `research` — research outputs from prompts/skills.
- `reference` — generated reference sheets, glossaries.
- `handoff` — context to pass between sessions or agents.
- `inbox` — unprocessed output; move to a typed folder once reviewed.
- `archive` — outdated or superseded notes.

Frontmatter defaults:
- `type`: one of the folder keys above.
- `audience`: `both` (default), `agent`, or `human`.
- `status`: `draft` (default), `review`, `final`, `archived`.
- `created`: ISO date.
- `tags`: list of relevant tags.
- `source`: prompt/skill that produced the note.
