# Investigation: apparently stalled subagent chain for #179395

## Conclusion

**A visibility failure is confirmed; a 22-minute execution deadlock is not.** The worker produced two implementation commits and a passing targeted test report before cancellation. Codemode did not forward the subagent's incremental results, and the plugin did not retain enough child-run evidence to identify the exact stage at cancellation.

No plugin implementation changes were made during this investigation. Work-item implementation/review remains paused. Do not restart implementation from scratch: inspect the two existing commits first.

## Incident evidence

Times below are UTC, from the parent transcript and Git timestamps, not reconstructed from wall-clock guesses.

| Time | Evidence |
|---|---|
| 2026-10-12 13:41:07.899 | Parent starts a codemode script with a three-stage worker → reviewer → worker chain and `timeout_ms: 1800000`. |
| 13:59:47 | Commit `adaf77b82`: `feat(modal): share record creation layout with catalog editors`. |
| 14:00:16 | `vitest-junit.xml` reports 59 tests, zero failures/errors across 10 suites. This is a recovered report, not a fresh execution of those tests during investigation. |
| 14:00:24 | Commit `d6417a2ef`: `test(modal): cover rendered record layout and catalog success flows`. |
| 14:02:55.130 | Parent records `Script aborted: This operation was aborted`, duration 1307.2 seconds. Nested subagent call is `unfinished`; codemode describes it as cancelled. |

The last commit preceded cancellation by about **2 minutes 31 seconds**. Therefore, the chain was doing useful work well into the run. The configured 30-minute deadline was not reached; the recorded outcome matches the user's cancellation.

Worktree: `/home/oeschger/dev/qgo/creation-modal-layout`.

`git status --short` only shows the original modified `package-lock.json`, but that says nothing about committed work. An initial inspection looking only at status was incomplete; `git log origin/master..HEAD` revealed the commits. The lockfile diff SHA-256 remains `1cacae5485d43643358167566c59886bf4a12ca7b1510ce35998e3a074f2bc2a`, matching the pre-run value.

Transcript inspected: `/home/oeschger/.pi/agent/sessions/--home-oeschger-dev--/2026-10-12T18-34-20-639Z_01a13164-ee5f-727c-8eb8-6f19fa735a7a.jsonl` (contains the earlier incident entries). Evidence was extracted by timestamp/message type; no credentials were inspected or copied.

## Confirmed causes of poor visibility and recovery

### 1. Codemode drops nested subagent progress

Installed Pi 1.1.0 implementation:

- `dist/extensions/codemode/execute.js:378`: publishes only its own call-status snapshot.
- `execute.js:399`: invokes `ctx.executeTool(tool.name, args, { signal: callSignal })` **without `onUpdate`**.
- The record is updated at start and completion, not with child progress.

The subagent plugin forwards updates through `onUpdate` (`agentRunner.ts:229-244`; `agentStrategy.ts:194-204`), but the enclosing codemode call does not consume them. The displayed nested call can remain “running” while the worker reads, edits, tests and commits. Improving only the subagent renderer would not fix this nesting path.

Pi's `docs/extensions.md:148` documents that nested results reach the caller through `onUpdate`/details; nested transcript records deliberately retain metadata, not results. `docs/extensions.md:157` explicitly recommends **`exposure: "model-only"` for orchestration tools**.

**Our orchestration contributed:** the entire long chain was wrapped inside codemode, and the report write occurred only after `await tools.subagent(...)`. Cancellation prevented that report write from ever executing.

### 2. The plugin ignores most live JSON event types

`agentRunner.ts:339-378` handles only completed `message_end` messages and `tool_result_end`. It ignores:

- `message_start` / `message_update` (including text/thinking activity);
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`;
- retry, compaction and settlement events.

`tool_result_end` is not part of the current documented JSON event protocol. Tool results can still arrive as `message_end`, so this is not evidence that all tool results are lost; it does mean current tool-lifecycle progress is unhandled.

There is no initial `emitUpdate()` before spawn and stderr appends do not emit updates (`agentRunner.ts:275`). Even a direct invocation can appear inactive during startup, long responses, tools or retries.

Source of truth: installed `docs/json.md`, particularly Message events, Tool execution events, Retry events, and `agent_settled` semantics.

### 3. Running state is incorrectly initialized as success

`agentRunner.ts:223` initializes an active child with `exitCode: EXIT_CODE.SUCCESS`.

- Chain rendering counts exit-code-zero results as completed (`render.ts:248-306`).
- Parallel rendering expects `EXIT_CODE.RUNNING`, but runner updates can replace its initialized running placeholder with success (`agentStrategy.ts:96-122,146-150`).
- Chain details contain only accumulated results, not total planned steps, so early progress can read like an already-completed shorter chain.

This is a separate confirmed status-model defect. It was not the main visible cause for this incident because codemode suppressed the plugin's progress path entirely.

### 4. Cancellation discards evidence needed for diagnosis

- Child runs use `--no-session` (`agentRunner.ts:310-315`).
- Child messages/stderr are held in memory, not a durable run log.
- After process termination, abort throws instead of returning/persisting the accumulated result (`agentRunner.ts:288`).
- Prompt files are deleted in `finally` (`agentRunner.ts:290-303`).
- Chain results are retained only in the active call; there is no per-stage checkpoint file.

Result: the transcript records that a nested call was cancelled, but not the child PID, selected model, active tool, last event time or completed-stage report. Cannot prove whether cancellation interrupted the worker's final response, startup/execution of review, or shutdown.

## Additional reliability risks (not established incident causes)

### Process lifecycle and timeouts

`SpawnSubagentProcessAdapter.run` (`agentRunner.ts:128-182`) waits for `close` with no startup, idle or total-run deadline. A pre-aborted request still spawns before being killed. Abort sends SIGTERM and a five-second SIGKILL to the immediate process only; listeners/timers are not explicitly cleaned up on normal exit. Signal termination loses the signal reason because the close callback records only `code`, which can be null.

Do not overstate orphan risk: installed Pi's `dist/modes/print-mode.js:31-40` handles SIGTERM and calls `killTrackedDetachedChildren()`. That mitigates normal cancellation of tracked shell processes. The extension still needs tests for startup before handler registration, failed cleanup, descendant-held pipes and forced termination. No orphan from this incident has been positively identified.

Observe `agent_settled`, not merely `agent_end`: retries/compaction can continue after `agent_end`. Settlement can mark generation complete while a bounded shutdown wait continues. Do not immediately kill successful runs before cleanup/output flushing.

### Failure is confused with termination

`result.ts:90-106` writes its fourth parameter to `terminate`, not `isError`. Single/chain error paths pass `true` (`agentStrategy.ts:60-69,218-225`); tests explicitly expect termination on failure. Pi documents `terminate` as suppressing automatic follow-up, not marking a result failed. This can misclassify errors for programmatic callers and impede recovery. Review permission-gate behavior separately; do not casually change its safety semantics.

### Chain handoff is lossy

`agentStrategy.ts:26-30,187-191,227` truncates `{previous}` to 4,000 characters and directs the next child to prior tool details. That child has an isolated context and no explicit way to read the parent's prior tool details. Findings/files near the end can disappear. Preserve the cap but provide a readable per-stage report path.

### Model behavior cannot be reconstructed

The worker definition lists `github-copilot/gpt-6-sol`, then `opencode-go/kimi-k2.7-code`. `buildArgs` selects based on registry availability, not successful runtime response, and does not inherit parent thinking level when the agent declares models. No selected-model evidence survived this cancelled call. Do not blame one provider or assume the fallback was actually used.

## Recommended changes, in order

### 1. Restore visible progress at the call boundary

**Smallest fix:** register `subagent` with `exposure: "model-only"` in `index.ts`. Invoke long subagent operations directly, not through codemode. This fits Pi's documented orchestration-tool contract and avoids maintaining a fork of codemode.

If codemode nesting must remain supported, an upstream change must forward nested updates and render them; an extension-only renderer change is insufficient.

For the next work-item run, use separate direct implementation/review/fix invocations and save each result immediately. Do not repeat the already-committed implementation.

**Acceptance:** a deterministic child emitting progress every second produces visible parent updates before it exits; subagent is excluded from codemode callable tools if model-only is selected. Existing permission confirmations still work.

### 2. Fix event handling and status display

Use the exported `JsonAgentSessionEvent` contract. Model explicit queued/running/completed/failed/cancelled states, total chain steps, PID, resolved model, active tool, start time and last activity time. Emit starting state before waiting on the child. Consume current message/tool/retry/compaction events; throttle rendering rather than losing events. Show elapsed time and time since last real child event.

A timer refresh is not proof of activity: show “no child event for 120s”, not “working” solely because a heartbeat timer fired. Do not display private thinking text; activity timestamps/counts suffice.

**Acceptance:** slow thinking, long tools, retries and compaction all show their actual phase; active children are never counted as successful; `1/3` remains the total chain progress.

### 3. Persist a small, private run record and stage reports

Write a run manifest at start, checkpoint completed steps, and retain bounded stderr/event diagnostics on cancellation/failure. Include run ID, stage, model, PID, cwd, timestamps, terminal status and report paths. Store run files outside source repos with restrictive permissions and retention limits; avoid credentials/environment dumps. Full prompt/tool-output capture should be opt-in or carefully bounded because repositories may contain sensitive data.

Keep structured cancelled results and completed-stage output even if outer cancellation prevents normal return. Use report paths for chain handoff beyond the existing 4,000-character summary limit. Durable structured output and usage accounting can be added alongside this, without introducing a large job-management framework.

**Acceptance:** cancel during step two; step one's report is still readable and the manifest identifies the cancelled step and last activity. The next agent receives a real readable artifact path, not a reference to inaccessible tool details.

### 4. Make shutdown and failure semantics deterministic

Reject pre-aborted requests before spawn. Centralize idempotent cleanup: remove listeners, clear escalation timers, normalize exit code/signal, preserve cancellation reason. Add configurable startup/idle/overall limits with separate graceful-shutdown allowance. Prefer warning on inactivity by default rather than terminating legitimate long tests solely for lack of output.

Validate Pi's normal descendant cleanup first; add process-tree cleanup only where needed for the supported platforms and scoped strictly to the launched child. Ensure `session_shutdown` also releases extension-owned children. Use `isError` for execution failures; reserve `terminate` for deliberate no-follow-up semantics.

**Acceptance:** no spawn on pre-abort; SIGTERM-ignoring child is escalated; no owned test descendant or timer is left behind; completed steps survive abort; failure returns a failed tool result without falsely reporting success.

### 5. Add lifecycle tests before expanding features

Existing runner tests use `FakeProcessAdapter`; they do not exercise real spawn/cancellation/pipe lifecycle. Add short **local Node fixture children, no live model dependency**, covering:

- JSON message/tool deltas, stderr-only startup, delayed first event, retry/compaction and settlement;
- cancel before spawn, during tool work, between chain steps, and while flushing output;
- signalled exit, spawn failure, malformed JSON and split UTF-8 chunks;
- child/descendant holding pipes open and SIGTERM-ignore escalation;
- correct running counts, preserved partial reports, no next chain stage after abort, and complete report handoff past the summary cap.

Use UTF-8 stream decoding (`setEncoding` or `StringDecoder`) rather than separately decoding arbitrary byte chunks; current `data.toString()` can corrupt a split multibyte character. Keep LF framing as the JSON docs require.

Do not start with automatic model failover, background job queues or resumable RPC workers. Those add complexity without fixing the confirmed visibility problem.

## Checks run during this investigation

From `home/pi/agent/extensions/subagents/`:

- `npm test`: **81 tests passed across 8 files**.
- `npm run typecheck`: **passed**.

These passing baseline tests do not establish cancellation/progress correctness; the missing cases are listed above. No live-model reproduction was launched, avoiding another expensive unattended chain. No work-item code or plugin source was changed.

## Implementation follow-up

Implemented after user approval in the same extension directory:

- Model-only tool exposure, current JSON event handling, throttled updates plus one-second elapsed/idle refresh, accurate running/queued state and total chain count.
- Private per-child manifests and reports with invocation IDs, seven-day completed-run retention, bounded stderr/report sizes, and readable chain handoff paths.
- Pre-abort handling, optional per-child deadline, SIGTERM/SIGKILL escalation, bounded output-pipe draining, listener/timer cleanup and session-shutdown cancellation. Cancelled runs preserve reports and active tool names.
- Execution failures use `isError` rather than suppressing parent recovery with `terminate`; permission-gate behavior unchanged.
- Local Node fixture and runner/render/journal regressions. **106 tests in 12 files pass**; typecheck, lint, formatting and `git diff --check` pass.

No live-model/TUI smoke test has been performed; load the changes with `/reload` before invoking a subagent. No plugin commits or remote changes were made. Existing unrelated root AGENTS.md, README.md and settings.json edits were left untouched.

Deliberately not implemented: separate startup/idle auto-kill policies (inactivity is displayed; deadline is explicit), forced process-tree cleanup of untracked descendants (Pi owns tracked children on normal SIGTERM), automatic chain resume, or automatic provider failover. Parent-crash records retain the last checkpoint rather than claiming the child is still alive. These limitations are also documented in the extension README.

## Primary-source index

Plugin files referenced above are under `/home/oeschger/dotfiles/home/pi/agent/extensions/subagents/`:

- `agentRunner.ts`, `agentRunner.test.ts`
- `agentStrategy.ts`, `agentStrategy.test.ts`
- `render.ts`, `result.ts`, `types.ts`, `index.ts`
- `README.md`, `AGENTS.md`, `awareness.ts`

Installed Pi sources/docs referenced above are under `/home/oeschger/dotfiles/home/pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/`:

- `dist/extensions/codemode/execute.js:363-445`
- `dist/modes/print-mode.js:15-45,80-139`
- `docs/extensions.md` — tools, exposure, lifecycle, nested results
- `docs/json.md` — current event protocol and settlement
- `docs/codemode.md` — cancellation, deadlines, script result persistence
- `docs/environment-variables.md` — ephemeral-session metadata

Repository state, commit timestamps, reflog and JUnit report are supporting local evidence; the exact state of the lost child stream remains unavailable.
