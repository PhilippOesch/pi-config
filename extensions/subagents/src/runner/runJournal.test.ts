import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunJournal } from "./runJournal.ts";
import type { SingleResult, SubAgentToolContext } from "../schema/types.ts";

const context = {
  config: { invocationId: "chain-123", totalSteps: 3 },
} as SubAgentToolContext;
const result = () =>
  ({
    agent: "worker",
    task: "sensitive task",
    step: 1,
    phase: "completed",
    exitCode: 0,
    startedAt: Date.now() - 1000,
    lastActivityAt: Date.now(),
    endedAt: Date.now(),
    stderr: "",
    usage: {},
    messages: [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private reasoning" },
          { type: "text", text: "Complete handoff" },
          { type: "text", text: "Final findings" },
        ],
      },
    ],
  }) as unknown as SingleResult;

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-journal-test-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("RunJournal", () => {
  it("persists private metadata and all final text blocks, not thinking or the task", () => {
    const journal = new RunJournal(root, context, "/worktree");
    journal.finish(result());
    const manifest = fs.readFileSync(journal.manifestPath, "utf8");
    const report = fs.readFileSync(journal.reportPath, "utf8");
    expect(JSON.parse(manifest)).toMatchObject({
      invocationId: "chain-123",
      step: 1,
      totalSteps: 3,
      cwd: "/worktree",
      phase: "completed",
    });
    expect(report).toContain("Complete handoff\nFinal findings");
    expect(manifest + report).not.toContain("private reasoning");
    expect(manifest + report).not.toContain("sensitive task");
    if (process.platform !== "win32") {
      expect(fs.statSync(path.dirname(journal.manifestPath)).mode & 0o777).toBe(
        0o700,
      );
      expect(fs.statSync(journal.manifestPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(journal.reportPath).mode & 0o777).toBe(0o600);
    }
  });

  it("only prunes completed runs older than seven days", () => {
    const old = new RunJournal(root, context, "/old");
    old.finish({ ...result(), endedAt: Date.now() - 8 * 86400000 });
    const activeDir = path.join(root, "run-active");
    const corruptDir = path.join(root, "run-corrupt");
    for (const directory of [activeDir, corruptDir]) fs.mkdirSync(directory);
    fs.writeFileSync(
      path.join(activeDir, "manifest.json"),
      JSON.stringify({ phase: "tool" }),
    );
    fs.writeFileSync(path.join(corruptDir, "manifest.json"), "not-json");
    const next = new RunJournal(root, context, "/new");
    next.finish(result());
    expect(fs.existsSync(old.manifestPath)).toBe(false);
    expect(fs.existsSync(activeDir)).toBe(true);
    expect(fs.existsSync(corruptDir)).toBe(true);
    expect(fs.existsSync(next.reportPath)).toBe(true);
  });

  it("bounds report size", () => {
    const record = result();
    record.messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "x".repeat(2 * 1024 * 1024) }],
      },
    ] as SingleResult["messages"];
    const journal = new RunJournal(root, context, "/worktree");
    journal.finish(record);
    expect(fs.statSync(journal.reportPath).size).toBeLessThan(
      1024 * 1024 + 100,
    );
    expect(fs.readFileSync(journal.reportPath, "utf8")).toContain(
      "Report truncated",
    );
  });
});
