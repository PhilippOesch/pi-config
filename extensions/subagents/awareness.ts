/**
 * Subagent awareness — inject the discovered agent list into the system prompt
 * so the main agent knows which subagents it can delegate to.
 *
 * Skipped inside spawned subagent processes: AgentRunner marks children with
 * the PI_SUBAGENT env var (inherited by nested spawns), and the hook checks it
 * so subagents neither pay the token cost nor try to re-delegate.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./agents.ts";

export const SUBAGENT_ENV_MARKER = "PI_SUBAGENT";

export function buildSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, [SUBAGENT_ENV_MARKER]: "1" };
}

export function isSubagentProcess(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env[SUBAGENT_ENV_MARKER]);
}

export function buildAwarenessSection(cwd: string): string | undefined {
  const { agents } = discoverAgents(cwd, "both");
  if (agents.length === 0) return undefined;

  const lines = agents
    .map((a) => `- ${a.name} (${a.source}): ${a.description}`)
    .join("\n");

  return [
    "Delegate to these with the subagent tool:",
    lines,
  ].join("\n");
}

export function registerAwareness(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (event, ctx) => {
    if (isSubagentProcess()) return undefined;
    const section = buildAwarenessSection(ctx.cwd);
    if (!section) return undefined;
    // Mutate prompt sections instead of returning `systemPrompt`: Pi records
    // section deltas in the transcript, so the injection survives export/share.
    event.systemPromptOptions.sections["subagents"] = section;
    return undefined;
  });
}
