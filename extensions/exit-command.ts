/**
 * Exit Command Extension
 *
 * Adds /exit as an alias for Pi's built-in /quit command.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("exit", {
    description: "Quit Pi (same as /quit)",
    handler: async (_args, ctx) => {
      ctx.shutdown();
    },
  });
}
