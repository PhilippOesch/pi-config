import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const blockedCommands = ["az"];
const blockedCommandPattern = blockedCommands.length
  ? new RegExp(
      `(?<![\\w-])(?:${blockedCommands.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\w-])`,
    )
  : null;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (event.toolName !== "bash") return;

    const command = event.input.command;
    if (typeof command === "string" && blockedCommandPattern?.test(command)) {
      return {
        block: true,
        reason: `Blocked bash command: ${blockedCommands.join(", ")}`,
      };
    }
  });
}
