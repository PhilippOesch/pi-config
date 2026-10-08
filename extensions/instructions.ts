import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadCopilotInstructions } from "./shared/copilot-instructions.ts";

export const COPILOT_INSTRUCTION_PATHS = [
  "copilot-instructions.md",
  ".copilot-instructions.md",
  ".github/copilot-instructions.md",
] as const;

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const agentDir =
      process.env.PI_CODING_AGENT_DIR ??
      path.join(os.homedir(), ".pi", "agent");
    const instructions = loadCopilotInstructions(
      ctx.cwd,
      agentDir,
      COPILOT_INSTRUCTION_PATHS,
    );
    if (instructions) {
      event.systemPromptOptions.sections["copilot_instructions"] = instructions;
    }
    return undefined;
  });
}
