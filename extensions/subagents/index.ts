/**
 * Subagent Tool - Delegate tasks to specialized agents
 *
 * Spawns a separate `pi` process for each subagent invocation,
 * giving it an isolated context window.
 *
 * Supports three modes:
 *   - Single: { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *   - Chain: { chain: [{ agent: "name", task: "... {previous} ..." }, ...] }
 *
 * Uses JSON mode to capture structured output from subagents.
 */

import * as path from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { SubagentDispatch } from "./dispatch.ts";
import { createTextResult } from "./result.ts";
import { renderCall, renderResult } from "./render.ts";
import { SubagentParams } from "./types.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: [
      "Delegate tasks to specialized subagents with isolated context.",
      "Modes: single (agent + task), parallel (tasks array), chain (sequential with {previous} placeholder).",
      `Default agent scope is "user" (from ${path.join(getAgentDir(), "agents")}).`,
      `To enable project-local agents in ${CONFIG_DIR_NAME}/agents, set agentScope: "both" (or "project").`,
    ].join(" "),
    parameters: SubagentParams,

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const dispatch = new SubagentDispatch(
        ctx,
        params,
        signal,
        onUpdate,
        ctx.hasUI
          ? {
              available: true,
              confirm: (title, message) => ctx.ui.confirm(title, message),
            }
          : { available: false, confirm: async () => false },
      );

      const outcome = await dispatch.execute();
      if (outcome.outcome === "success") {
        return outcome.result;
      }

      const terminate =
        outcome.outcome === "blocked" ? outcome.terminate : false;
      return createTextResult(outcome.context, outcome.text, [], terminate);
    },

    renderCall,
    renderResult,
  });
}
