---
description: Implement an existing plan from plans/, then review and apply feedback
argument-hint: "[<plan-name>]"
---

Use the **subagent** tool with the chain parameter to execute this workflow.

A plan is the minimum requirement. If no plan exists, stop and tell the user.

## Plan discovery

1. Look for `plans/` in cwd. If absent, stop — report a plan is required.
2. If exactly one plan file exists, use it.
3. If multiple exist, infer from current context. If still ambiguous, ask the user.
4. If $@ names a plan, prefer that one.

## Workflow

Execute as a chain. Pass output between steps via {previous}.

1. Implement — dispatch `worker` with the plan content
2. Review — dispatch `code-reviewer` with the implementation output ({previous})
3. Apply — dispatch `worker` with the review output ({previous})

## Completion criterion

- A plan was found and selected
- All three chain steps completed
- Final worker output reports files changed and applied review feedback
