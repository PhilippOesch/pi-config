# Subagent Example

Delegate tasks to specialized subagents with isolated context windows.

## Features

- **Isolated context**: Each subagent runs in a separate `pi` process
- **Visible progress**: Direct, model-only tool with live phase, active tool names, elapsed/idle time, PID and selected model
- **Parallel streaming**: All parallel tasks stream updates simultaneously
- **Markdown rendering**: Final output rendered with proper formatting (expanded view)
- **Usage tracking**: Shows turns, tokens, cost, and context usage per agent
- **Abort support**: Cancellation and session shutdown stop owned child processes, retaining diagnostics and completed stage reports
- **Private run records**: Per-child manifests and final/partial reports survive cancellation; chain handoffs include readable report paths

## Structure

```
subagent/
├── README.md            # This file
├── src/                 # TypeScript source
│   ├── index.ts         # The extension (entry point)
│   ├── discovery/       # Agent discovery and parent-agent awareness
│   ├── schema/          # Shared types, schema, and parameter validation
│   ├── runner/          # Child-process lifecycle and run diagnostics
│   ├── strategy/        # Mode orchestration and dispatch gate
│   ├── result/          # Output shaping and formatting helpers
│   ├── ui/              # TUI presentation
│   └── tests/shared/    # Test for shared extension code
├── agents/              # Sample agent definitions
│   ├── scout.md         # Fast recon, returns compressed context
│   ├── planner.md       # Creates implementation plans
│   ├── reviewer.md      # Code review
│   └── worker.md        # General-purpose (full capabilities)
└── prompts/             # Workflow presets (prompt templates)
    ├── implement.md     # scout -> planner -> worker
    ├── scout-and-plan.md    # scout -> planner (no implementation)
    └── implement-and-review.md  # worker -> reviewer -> worker
```

## Installation

From the repository root, symlink the files:

```bash
# Symlink the extension (must be in a subdirectory with index.ts)
mkdir -p ~/.pi/agent/extensions/subagent
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/src/index.ts" ~/.pi/agent/extensions/subagent/index.ts
ln -sf "$(pwd)/packages/coding-agent/examples/extensions/subagent/src/discovery/agents.ts" ~/.pi/agent/extensions/subagent/agents.ts

# Symlink agents
mkdir -p ~/.pi/agent/agents
for f in packages/coding-agent/examples/extensions/subagent/agents/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/agents/$(basename "$f")
done

# Symlink workflow prompts
mkdir -p ~/.pi/agent/prompts
for f in packages/coding-agent/examples/extensions/subagent/prompts/*.md; do
  ln -sf "$(pwd)/$f" ~/.pi/agent/prompts/$(basename "$f")
done
```

## Security Model

This tool executes a separate `pi` subprocess with a delegated system prompt and tool/model configuration.

**Project-local agents** (`.pi/agents/*.md`) are repo-controlled prompts that can instruct the model to read files, run bash commands, etc.

**Default behavior:** Only loads **user-level agents** from `~/.pi/agent/agents`.

To enable project-local agents, pass `agentScope: "both"` (or `"project"`). Only do this for repositories you trust.

When running interactively, the tool prompts for confirmation before running project-local agents. Set `confirmProjectAgents: false` to disable.

## Usage

### Single agent

```
Use scout to find all authentication code
```

### Parallel execution

```
Run 2 scouts in parallel: one to find models, one to find providers
```

### Chained workflow

```
Use a chain: first have scout find the read tool, then have planner suggest improvements
```

### Workflow prompts

```
/implement add Redis caching to the session store
/scout-and-plan refactor auth to support OAuth
/implement-and-review add input validation to API endpoints
```

## Tool Modes

| Mode     | Parameter          | Description                                            |
| -------- | ------------------ | ------------------------------------------------------ |
| Single   | `{ agent, task }`  | One agent, one task                                    |
| Parallel | `{ tasks: [...] }` | Multiple agents run concurrently (max 8, 4 concurrent) |
| Chain    | `{ chain: [...] }` | Sequential with `{previous}` placeholder               |

## Progress and run diagnostics

`subagent` uses `exposure: "model-only"`: call it directly, not through a codemode script. Pi 1.1.0 codemode does not forward nested tool updates. Reload Pi (`/reload`) after installing changes to the extension.

Progress updates show startup, thinking/response activity, active tools, retries, compaction and shutdown. The display refreshes once per second even when no events arrive; **last activity** advances only on child process activity, not on the refresh timer. Thinking text is not shown. Chain progress uses the total requested step count.

Run files live in `$XDG_CACHE_HOME/pi/subagents/run-*/` (default `~/.cache/pi/subagents/run-*/`):

- `manifest.json`: invocation ID, agent/model, cwd, stage/count, PID, phase, start/activity/end times, active tool names, exit signal, error, usage and bounded stderr tail. Checkpointed during execution and finalized on completion or cancellation.
- `report.md`: last completed assistant text (all text blocks), including on cancellation. Reports are capped at 1 MiB. No completed text means the report says so; incomplete streaming text is not reconstructed.

Directories are mode `0700`, files `0600`. Prompts, private thinking, raw events, environment variables and tool payloads are not persisted. **Final reports and stderr can still contain sensitive repository data**; do not share the files without checking them. Stderr retention is capped at 16 Ki characters. Completed runs older than seven days are pruned when another run starts; active/interrupted or unreadable records are not automatically deleted. Remove those manually when no longer needed. A parent crash can leave the last checkpoint marked running; it is not proof the child is still alive.

If diagnostics storage fails, the tool reports that failure without discarding otherwise successful work. Each completed chain step is written before the next starts; `{previous}` remains capped at 4,000 characters, followed by a report path the next child can read. This is checkpointing, not automatic chain resumption.

### Deadlines and cleanup

Pass `timeoutSeconds` to set an optional **per-child** wall-clock deadline (also applies to each chain/parallel child). Default: no deadline. Inactivity is displayed, not used to kill legitimate slow tools automatically. On cancellation/deadline/shutdown, send SIGTERM, escalate after five seconds, and bound pipe draining for another five seconds. Pre-aborted requests do not spawn. Pi's SIGTERM handler owns cleanup of its tracked shell descendants; the extension does not indiscriminately kill unrelated process groups. Untracked descendants after forced termination are not guaranteed cleaned up.

Failures return `isError: true` without suppressing the parent's recovery turn. Permission-gate termination behavior is unchanged. No automatic model failover or live-model calls are required by the lifecycle tests.

Implementation is split across `src/runner/agentRunner.ts` (events/state), `src/runner/process.ts` (child lifecycle), `src/runner/runJournal.ts` (private persistence), `src/strategy/agentStrategy.ts` (orchestration), and `src/ui/render.ts` (display).

## Output Display

**Collapsed view** (default):

- Status icon (✓/✗/⏳) and agent name
- Last 5-10 items (tool calls and text)
- Usage stats: `3 turns ↑input ↓output RcacheRead WcacheWrite $cost ctx:contextTokens model`

**Expanded view** (Ctrl+O):

- Full task text
- All tool calls with formatted arguments
- Final output rendered as Markdown
- Per-task usage (for chain/parallel)

**Parallel mode streaming**:

- Shows all tasks with live status (⏳ running, ✓ done, ✗ failed)
- Updates as each task makes progress
- Shows "2/3 done, 1 running" status
- Returns each completed task's final output to the parent model, capped at 50 KB per task
- Returns failure diagnostics from stderr/error messages when a child exits before producing output

**Tool call formatting** (mimics built-in tools):

- `$ command` for bash
- `read ~/path:1-10` for read
- `grep /pattern/ in ~/path` for grep
- etc.

## Agent Definitions

Agents are markdown files with YAML frontmatter:

```markdown
---
name: my-agent
description: What this agent does
tools: read, grep, find, ls
models: [anthropic/claude-haiku-4-5, openai/gpt-5]
---

System prompt for the agent goes here.
```

Each child starts with `--no-skills` and an appended instruction identifying it as a subagent; primary-only skill directives do not apply. Its agent Markdown body is appended after that instruction.

**Frontmatter fields:**

- `name` (required) — agent identifier used by tool calls.
- `description` (required) — short summary; surfaced to the parent model.
- `tools` — comma-separated list (`tools: read, grep`) or YAML list (`tools: [read, grep]`). Omit to use all default tools.
- `model` — single `provider/id` string. Sets the spawned child's `--model`. Use `provider/id` strings, matching the `--model` CLI flag.
- `models` — ordered preference list of `provider/id` strings. The first entry that is available in the current model registry is forwarded to the child as `--model`; later entries act as fallbacks. Accepts a YAML list (`models: [anthropic/claude-opus-4-5, openai/gpt-5]`) or a bare scalar (`models: anthropic/claude-sonnet-4-5`), which is treated as a one-element list. Use `provider/id` strings, matching the `--model` CLI flag.

When neither `model` nor `models` is set, the subagent inherits the dispatching session's active model and thinking level. If both `models` and `model` are set, the first available entry from `models` wins; if none of the listed models are available, the agent falls back to `model`. The parent session cannot declare a preference list of its own — only individual agent frontmatter can.

**Locations:**

- `~/.pi/agent/agents/*.md` - User-level (always loaded)
- `.pi/agents/*.md` - Project-level (only with `agentScope: "project"` or `"both"`)

Project agents override user agents with the same name when `agentScope: "both"`.

## Sample Agents

| Agent      | Purpose              | Model  | Tools                      |
| ---------- | -------------------- | ------ | -------------------------- |
| `scout`    | Fast codebase recon  | Haiku  | read, grep, find, ls, bash |
| `planner`  | Implementation plans | Sonnet | read, grep, find, ls       |
| `reviewer` | Code review          | Sonnet | read, grep, find, ls, bash |
| `worker`   | General-purpose      | Sonnet | (all default)              |

## Workflow Prompts

| Prompt                          | Flow                       |
| ------------------------------- | -------------------------- |
| `/implement <query>`            | scout → planner → worker   |
| `/scout-and-plan <query>`       | scout → planner            |
| `/implement-and-review <query>` | worker → reviewer → worker |

## Error Handling

- **Exit code != 0**: Tool returns error with stderr/output
- **stopReason "error"**: LLM error propagated with error message
- **stopReason "aborted"**: Cancellation stops the child and persists its partial report/diagnostics instead of throwing them away
- **Chain mode**: Stops at first failing or cancelled step, retains completed reports, and does not launch subsequent steps

## Limitations

- Output truncated to last 10 items in collapsed view (expand to see all)
- Parallel model-visible output is capped at 50 KB per task; full results remain in tool details
- Agents discovered fresh on each invocation (allows editing mid-session)
- Parallel mode limited to 8 tasks, 4 concurrent
