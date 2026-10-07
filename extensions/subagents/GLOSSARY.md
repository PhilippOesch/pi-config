# Subagents Glossary

## SubagentDispatch

The module that orchestrates a single subagent tool invocation. It owns parameter validation, confirmation gating, strategy selection, and result assembly. `index.ts` is a thin adapter that registers the tool and delegates execution to `SubagentDispatch`.

## AgentRunner

The module that runs one subagent by building the `pi` CLI invocation, writing the temporary system prompt file, and assembling the `SingleResult`. It depends on a `SubagentProcessAdapter` for the actual process execution.

## SubagentProcessAdapter

The seam around spawning a subagent `pi` process. The production adapter uses `child_process.spawn`; tests substitute an in-memory adapter that emits stdout lines, stderr, exit codes, and errors.
