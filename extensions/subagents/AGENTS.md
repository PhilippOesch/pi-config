# Subagents Extension

Subagent tool for `pi`. Spawns a separate `pi --mode json` process per invocation so delegated work runs in an isolated context window.

## When you touch this code

Most changes fall into one branch. Start with the branch that matches your task, then read the named file(s).

- **Agent discovery / agent file format** → `agents.ts`
- **Spawning, streaming, model resolution** → `agentRunner.ts`
- **Single / parallel / chain semantics** → `agentStrategy.ts`
- **Parameter schema or limits** → `types.ts`
- **TUI output** → `render.ts`, `format.ts`, `ui.ts`

## Invariants to preserve

- A single malformed agent file must never break discovery for the rest of the directory (`agents.ts` swallows per-file errors).
- `MAX_PARALLEL_TASKS = 8`, `MAX_CONCURRENCY = 4`.
- Parallel output per task is capped at `PER_TASK_OUTPUT_CAP` (50 KB); full output lives in tool details.
- Chain `{previous}` placeholder is capped at 4000 chars (`MAX_PREVIOUS_OUTPUT_CHARS`).
- In save mode, agents with `requiresConfirmation: true` require UI approval before running (`index.ts`).
- Project-local agents (`.pi/agents/*.md`) require interactive confirmation when `agentScope` is `"project"` or `"both"`.
- Model preference resolution order: first available entry in `models`, then `model`, then the dispatching session's model/thinking level.

## Agent file format

Agent definitions are Markdown with YAML frontmatter in `~/.pi/agent/agents/` or `.pi/agents/`:

```yaml
---
name: my-agent
description: What this agent does
tools: read, grep, bash # string or YAML list
model: provider/id # fallback single model
models: # ordered preference list
  - provider/id-a
  - provider/id-b
requiresConfirmation: true # save-mode gate
---
System prompt goes here.
```

`tools` accepts a comma-separated string or YAML list. `models` accepts a YAML list or a bare scalar (treated as one-element list). Comma-strings for `models` are intentionally **not** split.

## Verify changes

Run from `home/pi/agent/extensions/subagents/`:

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
```

For a manual end-to-end check, invoke the tool from `pi`:

```text
Use scout to list the files in this directory
```

## Entry points

- `index.ts` registers the `subagent` tool, gates privileged/project-local agents, and dispatches to the strategy.
- `agentRunner.ts` writes the agent's system prompt to a temp file, spawns `pi`, streams JSON events, and cleans up in a `finally` block.
- `agentStrategy.ts` implements `single`, `parallel`, and `chain`; parallel uses `mapLimit` from `../shared/utils.ts`.
