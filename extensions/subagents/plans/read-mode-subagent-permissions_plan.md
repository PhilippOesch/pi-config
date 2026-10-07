# Plan: Save-Mode Permission Gate + Subagent Worker Approval

## Goal

Make save mode in pi enforceable rather than bypassable:

1. In save mode, the LLM must ask the user for one-time permission before calling `edit`, `write`, or `bash`, instead of those tools being hidden from the tool set.
2. In save mode, the LLM must also ask for permission before invoking the `worker` subagent (and any other agent marked as requiring confirmation), closing the current bypass where a subagent with full rights performs edits on the LLM's behalf.

## Background / Environment

- `~/.pi/agent/extensions/read-mode-toggle/index.ts` currently implements save mode by **removing** `edit`, `write`, and `bash` from `pi.getActiveTools()`. It also skips all save-mode logic when `!ctx.hasUI`, which is necessary for headless `pi --mode json -p` worker processes but leaves the subagent bypass open in the parent session.
- `~/.pi/agent/extensions/subagents/index.ts` spawns independent `pi` processes with `--mode json -p --no-session`. Those worker processes do not inherit the parent's active tool set or save-mode state.
- `~/.pi/agent/extensions/subagents/index.ts` already has a user-confirmation pattern for project-local agents (`confirmProjectAgents`).
- `~/.pi/agent/agents/worker.md` is a general-purpose agent with no tool whitelist, making it the obvious vehicle for bypassing save mode.
- pi exposes a `tool_call` event that can block or allow individual tool executions, plus `ctx.ui.confirm` for user prompts.

## Approach

Move save mode from "hide the tools" to "gate each use of the tools." Keep the existing mode state, footer indicator, and system-prompt note; replace the `setActiveTools` stripping with a `tool_call` permission handler. Add a matching gate inside the subagent tool so that save-mode sessions cannot delegate edits to a `worker` without explicit approval.

### Alternatives considered

| Alternative                                                                                             | Why not chosen                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pass save-mode state into the worker subagent (e.g. `--save-mode` flag) and let the worker gate itself. | Even if the worker enforced save mode, the user would be prompted inside a headless JSON process where there is no UI. Blocking there would break the subagent; allowing there would keep the bypass open. |
| Keep hiding tools and only add a subagent gate.                                                         | The user explicitly wants to "lighten" save mode — tools should remain visible and the agent should ask, not silently disable.                                                                             |
| Gate _all_ subagents in save mode.                                                                      | The user clarified that only the `worker` agent (and any future agent explicitly marked) should require confirmation; read-only agents like `scout` should remain frictionless.                            |

## Scope

### In-scope

- Refactor `read-mode-toggle` to a permission-gate model for `edit`, `write`, and `bash`.
- Add a per-agent `requiresConfirmation` frontmatter flag to the subagent discovery/config system.
- Mark `worker` as requiring confirmation.
- Add a save-mode-aware confirmation gate in the `subagent` tool for agents flagged `requiresConfirmation`.
- Preserve the existing headless behavior: non-UI `pi` processes (e.g. spawned workers) default to yolo mode and do not prompt.

### Out-of-scope

- Changing the behavior of project-local agent confirmation (`confirmProjectAgents`).
- Gating custom extension tools that mutate state (unless they happen to be named `edit`, `write`, or `bash`).
- Adding a persistent "remember my choice" option for confirmations.
- Implementing nested-subagent recursion limits.

### Assumptions

- Both `read-mode-toggle` and `subagents` extensions are loaded in the parent pi session.
- The user is OK with being prompted once per blocked tool call in a turn (e.g. one prompt for `write`, another for `bash`).
- The `worker` agent's frontmatter can be edited to add `requiresConfirmation: true`.

## Steps

### 1. Refactor read-mode-toggle to ask instead of hide

**File:** `~/.pi/agent/extensions/read-mode-toggle/index.ts`

1.1. Remove `DISABLED_IN_READ_MODE`, `getReadModeTools`, `enableReadMode`, `disableReadMode`, and all `pi.setActiveTools` calls.
1.2. Keep `mode`, `updateStatus`, `persistMode`, the `/mode` command, `session_start` restoration, and the `before_agent_start` mode note — **but update the note text** so it tells the LLM that `edit`/`write`/`bash` require explicit user approval rather than being disabled.
1.3. In `session_start`, keep the `!ctx.hasUI` early return that forces `mode = "yolo"` for headless processes.
1.4. Add a `pi.on("tool_call", ...)` handler that runs when `mode === "save"` and `event.toolName` is `edit`, `write`, or `bash`:

- If `!ctx.hasUI`, block with reason "Cannot request permission without a UI".
- Build a short prompt that names the tool and previews the target path / command.
- Call `ctx.ui.confirm`.
- If the user declines, return `{ block: true, reason: "Declined by user (save mode)" }`.
- If the user approves, return `undefined` so the tool executes normally.

**Completion criterion:** In an interactive save-mode session, invoking `edit`/`write`/`bash` shows a confirmation dialog; declining blocks the call and the LLM receives a clear reason.

### 2. Add `requiresConfirmation` to agent configs

**File:** `~/.pi/agent/extensions/subagents/agents.ts`

2.1. Extend `AgentFrontmatter` and `AgentConfig` with an optional `requiresConfirmation?: boolean`.
2.2. Parse it with a small helper: treat truthy YAML values (`true`, `yes`) as `true`; default to `false`.

**Completion criterion:** Loading `worker.md` with `requiresConfirmation: true` yields an `AgentConfig` where `requiresConfirmation === true`.

### 3. Gate `worker` subagent calls in save mode

**File:** `~/.pi/agent/extensions/subagents/index.ts`

3.1. Add a helper `isReadModeActive(ctx)` that scans `ctx.sessionManager.getBranch()` for the latest `read-mode` custom entry (same logic used by `read-mode-toggle`).
3.2. Before executing a subagent request (single, parallel, or chain), collect the unique agent names involved.
3.3. Filter to agents where `requiresConfirmation === true`.
3.4. Implement the gate **inside the `subagent` tool's `execute` function**, at the top before any agent is spawned. If save mode is active, any such agent is requested, and `ctx.hasUI`:

- Show `ctx.ui.confirm("Run privileged subagent in save mode?", ...)` listing the agent names and a short task preview.
- If declined, return `{ content: [{ type: "text", text: "..." }], isError: true }` explaining that the subagent was blocked because the session is in save mode.
  3.5. If save mode is active but `!ctx.hasUI`, return the same error result with reason "Cannot request permission without a UI".

**Completion criterion:** In an interactive save-mode session, calling the `subagent` tool with `agent: "worker"` shows a confirmation dialog; declining returns a blocked/error result.

### 4. Mark the worker agent as privileged

**File:** `~/.pi/agent/agents/worker.md`

4.1. Add `requiresConfirmation: true` to the frontmatter.

**Completion criterion:** The worker agent config carries the confirmation flag.

### 5. Update extension comments / docs

**Files:** `~/.pi/agent/extensions/read-mode-toggle/index.ts`, `~/.pi/agent/extensions/read-mode-toggle/README.md` (if present)

5.1. Update the file-level comment and any README description to reflect that save mode now gates rather than hides `edit`/`write`/`bash`.

**Completion criterion:** A developer reading the extension's header comment understands the new permission-gate behavior without reading the code.

### 6. Type-check and smoke-test

6.1. Run TypeScript checks on all modified extensions.
6.2. Manually test in pi:

- Enable save mode (`/mode`).
- Ask the LLM to write a file; confirm the prompt appears and both "allow" and "deny" paths work.
- Ask the LLM to run the `worker` subagent; confirm the prompt appears and both paths work.
- Verify that headless `pi --mode json -p` invocations still have full tool access.

**Completion criterion:** All type checks pass and the two interactive confirmation flows behave as expected.

## Risks / Open Questions

| Risk / Open Question                                                                                                                                                            | Mitigation / Notes                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Multiple prompts per turn.** If the LLM issues several `write`/`bash` calls at once, the user may be prompted repeatedly.                                                     | Acceptable for the first version; can later add a per-turn "allow all for this turn" option.        |
| **Bypass via other tools.** The LLM could still mutate files through a tool not in the gated list (e.g. a custom tool, or `bash` disguised as a safe command).                  | This is a best-effort gate on the agreed tool list; custom tools are out of scope.                  |
| **Subagent extension reads save-mode state by scanning the session branch.** This duplicates logic from `read-mode-toggle`.                                                     | The duplication is small and robust; a shared module would couple the two extensions more tightly.  |
| **Denial returns `isError: true` vs. a normal blocked result.** We need to pick the return shape so the parent LLM understands the call was rejected.                           | Use `isError: true` with a clear message, matching how the subagent tool already surfaces failures. |
| **Nested subagents.** A approved `worker` could itself call another subagent. Inside the worker process save mode defaults to yolo (`!ctx.hasUI`), so no further prompts occur. | This matches the current behavior and is acceptable because the user already approved the worker.   |
