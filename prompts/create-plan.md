---
description: Enter plan-first mode before writing code. Research the task, clarify missing requirements with the user, and write a concrete implementation plan (no implementation).
argument-hint: "<task>"
---

Stay in planning mode. Only deliverable is `plans/{task}_plan.md`. Do not implement.

## General

### Subagent workflow

Use the **subagent** tool with the chain parameter to execute this workflow.

This workflow uses the subagents: `scout` and `plan-reviewer`. Use these sugagents when mentione in following workflow steps.

Execute this as a chain, passing output between steps via {previous}.

## Workflow

### 1. Research

**1.1. Clarify the request** — restate the task, goal, and success criteria in your own words. Ask one focused question at a time until the spec is solid. _Done when_ every critical item is stated and none marked unclear.

**1.2 Scout for context** — dispatch the `scout` **subagent** with task = `$@`. It returns Files Retrieved, Key Code, Architecture, Start Here.

### 2. Formulating Plan

#### 2.1. Define scope

- List what is in-scope and what is out-of-scope.
- State assumptions and known dependencies.
- Flag risks and open questions that need tracking.

#### 2.2. Choose an approach

- Outline the high-level strategy.
- Briefly consider alternatives, then pick one and say why.
- Add phases or milestones if the work is large enough to need them.

#### 2.3 Break into steps

- Convert the approach into concrete, ordered actions.
- Every step must have a clear completion criterion.

#### 2.4 Write the plan — create `plans/` if missing, save to `plans/{task}_plan.md`. Required sections:

- **Goal**
- **Background / Environment** — from planner
- **Approach** — from planner (high-level strategy + alternatives considered)
- **Scope** — from planner (in-scope, out-of-scope, assumptions), reinforced from clarification in step 1
- **Steps** — from planner, each with a completion criterion
- **Risks / Open questions** — from planner plus anything unresolved

### 2.6 Review

- open `plans/{task}_plan.md` in the browser.
- **Confirm** — ask the user whether anything is missing or should change. Do not move to implementation until they confirm.

## Completion criterion — Planning Completion

1. `plans/{task}_plan.md` exists.
2. The plan was previewed in the browser.
3. The user confirmed the plan is ready.
