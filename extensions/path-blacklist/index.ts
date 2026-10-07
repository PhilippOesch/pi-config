import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { expandHome } from "../shared/utils.ts";

type Content = { type: string; text?: string };

interface BlacklistConfig {
  paths: string[];
}

const DEFAULT_BLACKLIST = [".git", "node_modules", "bin", "obj"];

function loadConfig(cwd: string): string[] {
  const candidates = [
    join(cwd, CONFIG_DIR_NAME, "blacklist.json"), // project-local
    join(homedir(), ".pi", "agent", "blacklist.json"), // global
  ];
  for (const candidate of candidates) {
    const path = expandHome(candidate);
    if (existsSync(path)) {
      try {
        const cfg: BlacklistConfig = JSON.parse(readFileSync(path, "utf-8"));
        if (Array.isArray(cfg.paths)) {
          return cfg.paths.map((entry) => entry.replace(/\\/g, "/"));
        }
      } catch {
        // ignore broken config
      }
    }
  }
  return DEFAULT_BLACKLIST;
}

function isBlacklisted(
  blacklist: string[],
  cwd: string,
  rawPath: string,
): boolean {
  if (!rawPath) return false;
  const normalized = resolve(cwd, rawPath).replace(/\\/g, "/");
  const segments = normalized.split("/");
  return blacklist.some((entry) => segments.includes(entry));
}

function extractGrepPath(line: string): string | undefined {
  const match = line.match(/^([^:]+?)(?::\d+:| -\d+- )/);
  return match?.[1];
}

export default function (pi: ExtensionAPI) {
  let cwd = process.cwd();
  let blacklist: string[] = DEFAULT_BLACKLIST;

  function refresh() {
    blacklist = loadConfig(cwd);
  }
  refresh();

  pi.on("session_start", (_event, ctx) => {
    if (ctx.cwd) {
      cwd = ctx.cwd;
      refresh();
    }
  });

  // Block direct reads/edits/writes/listings into blacklisted paths.
  pi.on("tool_call", async (event) => {
    const input = event.input as Record<string, unknown> | undefined;

    if (!input) return;

    if (
      !["reads", "edit", "write", "ls", "find", "grep"].includes(event.toolName)
    ) {
      return;
    }

    const rawPath = (input?.path ?? input.file_path) as string | undefined;

    if (rawPath && isBlacklisted(blacklist, cwd, rawPath)) {
      return {
        block: true,
        reason: `Blocked: ${rawPath} matches the path blacklist (${blacklist.join(", ")})`,
      };
    }
  });

  // Filter blacklisted entries out of find/grep/ls results.
  pi.on("tool_result", async (event) => {
    const toolName = event.toolName;
    const parts = (event.content ?? []) as Content[];
    const text = parts
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    if (!text) return;

    let changed = false;

    const filtered = text
      .split("\n")
      .filter((line) => {
        let path: string | undefined;
        switch (toolName) {
          case "find":
            path = line;
            break;
          case "grep":
            path = extractGrepPath(line);
            break;
          case "ls":
            path = line.replace(/\/$/, "");
            break;
        }

        if (path && isBlacklisted(blacklist, cwd, path)) {
          changed = true;
          return false;
        }
        return true;
      })
      .join("\n");

    if (!changed) return;

    return {
      content: [
        {
          type: "text",
          text: filtered || "No results found (filtered by path blacklist).",
        },
      ],
    };
  });
}
