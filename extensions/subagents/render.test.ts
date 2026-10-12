import { describe, expect, it } from "vitest";
import { Theme } from "@earendil-works/pi-coding-agent";
import { formatProgress, renderResult } from "./render.ts";
import { createUi } from "./ui.ts";
import type { SingleResult } from "./types.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;
const running = (): SingleResult => ({
  agent: "worker",
  agentSource: "user",
  task: "task",
  step: 1,
  exitCode: -1,
  phase: "tool",
  startedAt: 1000,
  lastActivityAt: 2000,
  pid: 42,
  activeTools: { bash1: "bash" },
  model: "provider/model",
  messages: [],
  stderr: "",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    turns: 0,
    contextTokens: 0,
  },
});

describe("progress rendering", () => {
  it("shows elapsed and idle time without treating a heartbeat as activity", () => {
    expect(formatProgress(running(), 7000)).toBe(
      "worker step 1: tool (bash) · 6s elapsed · last activity 5s ago · PID 42 · provider/model",
    );
  });
  it("uses waiting icon for running children", () => {
    expect(createUi(theme).icons.singleResultToIcon(running())).toBe("⏳");
  });
  it("keeps actual chain length while first step runs", () => {
    const component = renderResult(
      {
        content: [],
        details: {
          mode: "chain",
          totalSteps: 3,
          results: [running()],
        },
      },
      { expanded: false },
      theme,
      undefined,
    );
    expect(component.render(200).join("\n")).toContain("0/3 steps");
    expect(component.render(200).join("\n")).not.toContain("1/1 steps");
  });
});
