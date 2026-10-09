/**
 * Save / Yolo Mode Toggle Extension
 *
 * A minimal pi extension that toggles between two modes:
 *
 * - **save mode** (default for new sessions): the built-in `edit`, `write`,
 *   and `bash` tools remain visible, but each call must be approved by the
 *   user via a confirmation dialog. The footer shows `🔒 save` in the warning
 *   color.
 *
 * - **yolo mode**: tools execute without extra prompts. The footer shows
 *   `🚀 yolo` in the success color.
 *
 * Usage:
 *   - `/mode` toggles between save and yolo mode.
 *   - The active mode is always shown in the TUI footer.
 *   - A one-sentence mode note is appended to the system prompt on every
 *     agent turn via `before_agent_start`.
 *
 * Persistence:
 *   - The current mode is written to the session via `pi.appendEntry()` on
 *     every toggle. Resuming a session (`/resume`) restores the mode the
 *     session was last in.
 *   - Save mode is enforced through a `tool_call` event listener that gates
 *     individual calls to `edit`, `write`, and `bash`, rather than by hiding
 *     the tools from the active tool set.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { READ_MODE_ENTRY_TYPE } from "../shared/constants.ts";

type Mode = "save" | "yolo";

// Built-in tools that require user approval in save mode.
const GATED_IN_SAVE_MODE = new Set<string>(["edit", "write", "bash"]);

function migrateMode(value: string): Mode | undefined {
  if (value === "read" || value === "save") return "save";
  if (value === "edit" || value === "yolo") return "yolo";
  return undefined;
}

export default function readModeToggleExtension(pi: ExtensionAPI): void {
  let mode: Mode = "save";

  function updateStatus(ctx: ExtensionContext): void {
    const label =
      mode === "save"
        ? ctx.ui.theme.fg("warning", "🔒 save")
        : ctx.ui.theme.fg("success", "🚀 yolo");
    ctx.ui.setStatus("read-mode", label);
  }

  function persistMode(): void {
    pi.appendEntry(READ_MODE_ENTRY_TYPE, { mode });
  }

  function toggle(ctx: ExtensionContext): void {
    if (mode === "save") {
      mode = "yolo";
      ctx.ui.notify("Yolo mode: all tools are available.", "info");
    } else {
      mode = "save";
      ctx.ui.notify(
        "Save mode: edit, write, and bash require approval.",
        "info",
      );
    }
    updateStatus(ctx);
    persistMode();
  }

  pi.registerCommand("mode", {
    description: "Toggle between save mode and yolo mode",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      toggle(ctx);
    },
  });

  pi.registerShortcut("ctrl+shift+m", {
    description: "Toggle between save mode and yolo mode",
    handler: (ctx) => {
      if (!ctx.hasUI) return;
      toggle(ctx);
    },
  });

  // Restore the persisted mode on every session start (startup, reload, new,
  // resume, fork). We scan the current branch so tree navigation reflects the
  // mode at the active leaf.
  pi.on("session_start", async (_event, ctx) => {
    // Save mode is a TUI/RPC feature. In headless JSON/print mode — most
    // importantly when the subagents extension spawns a worker process with
    // --mode json -p — there is no UI to request permission, so we default
    // to yolo mode and do not gate tools.
    if (!ctx.hasUI) {
      mode = "yolo";
      return;
    }

    const branch = ctx.sessionManager.getBranch();
    let restored: Mode | undefined;
    for (const entry of branch) {
      if (
        entry.type === "custom" &&
        entry.customType === READ_MODE_ENTRY_TYPE
      ) {
        const data = entry.data as { mode?: string } | undefined;
        if (data?.mode) {
          restored = migrateMode(data.mode);
        }
      }
    }

    mode = restored ?? "save";

    // Persist the default so other extensions (e.g. subagents) can read
    // the current mode from the session branch.
    if (restored === undefined) {
      persistMode();
    }

    updateStatus(ctx);
  });

  // Inject a short mode note into the system prompt on every agent turn.
  pi.on("before_agent_start", async (event, ctx) => {
    if (!ctx.hasUI) return;

    const note =
      mode === "save"
        ? "\n\nYou are in save mode. Before using edit, write, or bash, you must ask the user for explicit approval. Do not modify anything without permission."
        : "\n\nYou are in yolo mode. You may use edit, write, and bash without asking for explicit approval.";
    return { systemPrompt: event.systemPrompt + note };
  });

  // Gate individual calls to edit, write, and bash when in save mode.
  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    if (mode !== "save" || !GATED_IN_SAVE_MODE.has(event.toolName)) {
      return;
    }

    if (!ctx.hasUI) {
      return { block: true, reason: "Cannot request permission without a UI" };
    }

    const preview = buildToolPreview(event);
    const ok = await ctx.ui.confirm(
      `Allow ${event.toolName} in save mode?`,
      preview,
    );

    if (!ok) {
      return { block: true, reason: "Declined by user (save mode)" };
    }

    return undefined;
  });
}

function buildToolPreview(event: ToolCallEvent): string {
  switch (event.toolName) {
    case "bash": {
      const input = event.input as { command: string };
      const preview =
        input.command.length > 120
          ? `${input.command.slice(0, 120)}...`
          : input.command;
      return `Command:\n$ ${preview}`;
    }
    case "edit": {
      const input = event.input as { path: string; edits: unknown[] };
      const edits = input.edits.length;
      return `File: ${input.path}\nEdits: ${edits} replacement${edits === 1 ? "" : "s"}`;
    }
    case "write": {
      const input = event.input as { path: string; content: string };
      const lines = input.content.split("\n").length;
      return `File: ${input.path}\nLines: ${lines}`;
    }
    default:
      return `Tool: ${event.toolName}`;
  }
}
