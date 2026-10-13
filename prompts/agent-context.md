---
description: Save and retrieve agent-generated knowledge in the configured Obsidian agent-context folder.
argument-hint: "<instruction>"
---

When writing plans, research, reference material, or handoff notes for the user, store them in the configured agent-context folder instead of the current repo or a scratch directory.

Read the config at `~/.pi/agent/pi-mp-my-agent.json` to find `knowledge.agentContextPath` and the folder mapping.

Rules:
- Write agent-generated output to `<agentContextPath>/<folder>/`.
- Use filename pattern `<yyMMddHHmm>-<slug>.md`.
- Include frontmatter: id, type, audience, status, created, tags, source.
- `type` decides the folder: plan, research, reference, handoff.
- Default `audience: both`, `status: draft`.
- Put unsure or unprocessed output in `inbox`.
- Move outdated notes to `archive` rather than deleting.
- Do not write to the user's curated `zettelkasten/` unless explicitly asked.
- When the user asks to "look up" something, search `<agentContextPath>` first.
