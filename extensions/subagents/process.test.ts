import { describe, expect, it, vi } from "vitest";
import { SpawnSubagentProcessAdapter, type ProcessEvent } from "./process.ts";

const request = (script: string, signal?: AbortSignal) => ({
  command: process.execPath,
  args: ["-e", script],
  cwd: process.cwd(),
  abortSignal: signal,
});

describe("SpawnSubagentProcessAdapter (local child processes)", () => {
  it("does not spawn with an already cancelled signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const onEvent = vi.fn();
    await new SpawnSubagentProcessAdapter().run(
      request("throw Error('must not run')", controller.signal),
      onEvent,
    );
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("decodes split UTF-8 and flushes final unterminated JSONL", async () => {
    const events: ProcessEvent[] = [];
    await new SpawnSubagentProcessAdapter().run(
      request(`
      const bytes = Buffer.from('ä');
      process.stdout.write(bytes.subarray(0, 1));
      setTimeout(() => { process.stdout.write(bytes.subarray(1)); process.stdout.write('\\n{"type":"done"}'); }, 10);
    `),
      (e) => events.push(e),
    );
    expect(events.filter((e) => e.type === "stdout")).toEqual([
      { type: "stdout", line: "ä" },
      { type: "stdout", line: '{"type":"done"}' },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "exit", code: 0 });
  });

  it("records spawn failures exactly once", async () => {
    const events: ProcessEvent[] = [];
    await new SpawnSubagentProcessAdapter().run(
      { command: "/nonexistent-subagent-binary", args: [], cwd: process.cwd() },
      (e) => events.push(e),
    );
    expect(events.filter((e) => e.type === "error")).toHaveLength(1);
    expect(events.filter((e) => e.type === "exit")).toHaveLength(1);
  });

  it.skipIf(process.platform === "win32")(
    "escalates SIGTERM-ignoring children and preserves the signal",
    async () => {
      const controller = new AbortController();
      const events: ProcessEvent[] = [];
      const remove = vi.spyOn(controller.signal, "removeEventListener");
      await new SpawnSubagentProcessAdapter(30).run(
        request(
          `
      process.on('SIGTERM', () => {});
      console.log('ready');
      setInterval(() => {}, 1000);
    `,
          controller.signal,
        ),
        (e) => {
          events.push(e);
          if (e.type === "stdout" && e.line === "ready") controller.abort();
        },
      );
      expect(events.at(-1)).toMatchObject({
        type: "exit",
        code: null,
        signal: "SIGKILL",
      });
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
      remove.mockRestore();
    },
  );

  it.skipIf(process.platform === "win32")(
    "bounds cancellation when a descendant holds the output pipe open",
    async () => {
      const controller = new AbortController();
      let descendant: number | undefined;
      const events: ProcessEvent[] = [];
      const safetyAbort = setTimeout(() => controller.abort(), 1000);
      try {
        await new SpawnSubagentProcessAdapter(30).run(
          request(
            `
        const { spawn } = require('node:child_process');
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
        console.log(child.pid);
        setInterval(() => {}, 1000);
      `,
            controller.signal,
          ),
          (e) => {
            events.push(e);
            if (e.type === "stdout" && /^\d+$/.test(e.line)) {
              descendant = Number(e.line);
              controller.abort();
            }
          },
        );
        expect(
          events.some(
            (e) =>
              e.type === "stderr" && e.data.includes("pipes did not close"),
          ),
        ).toBe(true);
        expect(events.at(-1)?.type).toBe("exit");
      } finally {
        clearTimeout(safetyAbort);
        controller.abort();
        // Only this fixture's child is killed; production Pi owns its tracked descendants.
        if (descendant) {
          try {
            process.kill(descendant, "SIGKILL");
          } catch {
            /* already exited */
          }
        }
      }
    },
  );

  it("removes abort listener after normal exit", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await new SpawnSubagentProcessAdapter().run(
      request("console.log('done')", controller.signal),
      () => {},
    );
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    controller.abort();
    remove.mockRestore();
  });
});
