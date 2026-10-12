import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Model, Api } from "@earendil-works/pi-ai";
import {
  AgentRunner,
  type ProcessEvent,
  type SubagentProcessRequest,
} from "./agentRunner.ts";
import {
  EXIT_CODE,
  type SingleResult,
  type SubAgentToolContext,
  type SubagentDetails,
} from "../schema/types.ts";
import type { AgentConfig } from "../discovery/agents.ts";

class FakeProcessAdapter {
  events: ProcessEvent[] = [];
  promptContent: string | undefined;
  run = vi.fn(
    async (
      request: SubagentProcessRequest,
      onEvent: (event: ProcessEvent) => void,
    ) => {
      const promptIndex = request.args.indexOf("--append-system-prompt");
      if (promptIndex >= 0) {
        this.promptContent = fs.readFileSync(
          request.args[promptIndex + 1] as string,
          "utf-8",
        );
      }
      for (const event of this.events) {
        onEvent(event);
      }
    },
  );
}

const makeAgent = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  name: "worker",
  description: "worker agent",
  systemPrompt: "",
  source: "user",
  filePath: "/tmp/worker.md",
  ...overrides,
});

const makeCtx = (agents: AgentConfig[]): SubAgentToolContext => ({
  config: {
    cwd: "/tmp",
    agentScope: "user",
    dispatchDefaults: {
      model: "default/provider",
      thinkingLevel: "medium",
    },
    agents,
    projectAgentsDir: null,
    availableModels: [
      { provider: "preferred", id: "model-a" },
      { provider: "fallback", id: "model-b" },
      { provider: "default", id: "provider" },
    ] as Model<Api>[],
    confirmProjectAgents: false,
    mode: "single",
    requestedAgentNames: [],
  },
  details: {
    make: (results: SingleResult[]) =>
      ({
        mode: "single",
        agentScope: "user",
        projectAgentsDir: null,
        results,
      }) as SubagentDetails,
  },
});

const stdoutEvent = (line: string): ProcessEvent => ({ type: "stdout", line });
const exitEvent = (code: number): ProcessEvent => ({ type: "exit", code });

describe("AgentRunner", () => {
  let adapter: FakeProcessAdapter;
  let runner: AgentRunner;
  let runsDirectory: string;

  beforeEach(() => {
    runsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-test-"));
    adapter = new FakeProcessAdapter();
    runner = new AgentRunner(adapter, { runsDirectory, heartbeatMs: 20 });
  });
  afterEach(async () => {
    await runner.shutdown();
    fs.rmSync(runsDirectory, { recursive: true, force: true });
  });

  it("returns an error for an unknown agent without running", async () => {
    const result = await runner.runAgent(makeCtx([]), "missing", "task");
    expect(adapter.run).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(EXIT_CODE.FAILED);
    expect(result.stderr).toContain("Unknown agent");
    expect(result.stderr).toContain("missing");
  });

  it("includes base args in the process request", async () => {
    adapter.events = [exitEvent(EXIT_CODE.SUCCESS)];

    await runner.runAgent(makeCtx([makeAgent()]), "worker", "do it");

    const request = adapter.run.mock.calls[0]![0];
    expect(request.args).toEqual(
      expect.arrayContaining([
        "--mode",
        "json",
        "-p",
        "--no-session",
        "--no-skills",
      ]),
    );
    expect(adapter.promptContent).toContain("You are running as a Pi subagent");
    expect(adapter.promptContent).toContain("do not load either skill");
  });

  it("prefers the first available model from agent.models", async () => {
    adapter.events = [exitEvent(EXIT_CODE.SUCCESS)];

    await runner.runAgent(
      makeCtx([
        makeAgent({
          models: ["preferred/model-a", "fallback/model-b"],
          model: "fallback/model-b",
        }),
      ]),
      "worker",
      "task",
    );

    const request = adapter.run.mock.calls[0]![0];
    const modelIndex = request.args.indexOf("--model");
    expect(modelIndex).toBeGreaterThan(-1);
    expect(request.args[modelIndex + 1]).toBe("preferred/model-a");
  });

  it("falls back to agent.model when models has no available match", async () => {
    adapter.events = [exitEvent(EXIT_CODE.SUCCESS)];

    await runner.runAgent(
      makeCtx([
        makeAgent({
          models: ["unavailable/x"],
          model: "fallback/model-b",
        }),
      ]),
      "worker",
      "task",
    );

    const request = adapter.run.mock.calls[0]![0];
    const modelIndex = request.args.indexOf("--model");
    expect(request.args[modelIndex + 1]).toBe("fallback/model-b");
  });

  it("falls back to dispatchDefaults.model when agent has no model", async () => {
    adapter.events = [exitEvent(EXIT_CODE.SUCCESS)];

    await runner.runAgent(makeCtx([makeAgent()]), "worker", "task");

    const request = adapter.run.mock.calls[0]![0];
    const modelIndex = request.args.indexOf("--model");
    expect(request.args[modelIndex + 1]).toBe("default/provider");
  });

  it("pushes --thinking only when the agent does not declare a model", async () => {
    adapter.events = [exitEvent(EXIT_CODE.SUCCESS)];

    await runner.runAgent(
      makeCtx([makeAgent({ model: "fallback/model-b" })]),
      "worker",
      "task",
    );
    const argsWithModel = adapter.run.mock.calls[0]![0].args;
    expect(argsWithModel).not.toContain("--thinking");

    adapter.events = [exitEvent(EXIT_CODE.SUCCESS)];
    await runner.runAgent(makeCtx([makeAgent()]), "worker", "task");
    const argsWithoutModel = adapter.run.mock.calls[1]![0].args;
    const thinkingIndex = argsWithoutModel.indexOf("--thinking");
    expect(thinkingIndex).toBeGreaterThan(-1);
    expect(argsWithoutModel[thinkingIndex + 1]).toBe("medium");
  });

  it("pushes --tools when the agent declares tools", async () => {
    adapter.events = [exitEvent(EXIT_CODE.SUCCESS)];

    await runner.runAgent(
      makeCtx([makeAgent({ tools: ["read", "bash"] })]),
      "worker",
      "task",
    );

    const request = adapter.run.mock.calls[0]![0];
    const toolsIndex = request.args.indexOf("--tools");
    expect(toolsIndex).toBeGreaterThan(-1);
    expect(request.args[toolsIndex + 1]).toBe("read,bash");
  });

  it("appends the task as a positional argument", async () => {
    adapter.events = [exitEvent(EXIT_CODE.SUCCESS)];

    await runner.runAgent(makeCtx([makeAgent()]), "worker", "do it");

    const request = adapter.run.mock.calls[0]![0];
    expect(request.args[request.args.length - 1]).toBe("Task: do it");
  });

  it("writes a temp prompt file and passes --append-system-prompt", async () => {
    adapter.events = [exitEvent(EXIT_CODE.SUCCESS)];

    await runner.runAgent(
      makeCtx([makeAgent({ systemPrompt: "Be helpful." })]),
      "worker",
      "task",
    );

    const request = adapter.run.mock.calls[0]![0];
    const promptIndex = request.args.indexOf("--append-system-prompt");
    expect(promptIndex).toBeGreaterThan(-1);
    const promptPath = request.args[promptIndex + 1] as string;
    expect(promptPath).toMatch(/prompt-worker\.md$/);
    expect(adapter.promptContent).toContain("You are running as a Pi subagent");
    expect(adapter.promptContent).toContain("Be helpful.");
    expect(fs.existsSync(promptPath)).toBe(false);
  });

  it("collects messages from stdout events", async () => {
    adapter.events = [
      stdoutEvent(
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hello" }],
            usage: {
              input: 10,
              output: 5,
              totalTokens: 15,
              cost: { total: 0.001 },
            },
          },
        }),
      ),
      exitEvent(EXIT_CODE.SUCCESS),
    ];

    const result = await runner.runAgent(
      makeCtx([makeAgent()]),
      "worker",
      "task",
    );

    expect(result.messages).toHaveLength(1);
    expect(result.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(result.usage.input).toBe(10);
    expect(result.usage.output).toBe(5);
    expect(result.usage.turns).toBe(1);
    expect(result.usage.cost).toBe(0.001);
  });

  it("captures stderr from stderr events", async () => {
    adapter.events = [
      { type: "stderr", data: "something went wrong\n" },
      exitEvent(EXIT_CODE.FAILED),
    ];

    const result = await runner.runAgent(
      makeCtx([makeAgent()]),
      "worker",
      "task",
    );

    expect(result.stderr).toBe("something went wrong\n");
    expect(result.exitCode).toBe(EXIT_CODE.FAILED);
  });

  it("streams live phases and PID before exit without treating them as success", async () => {
    adapter.events = [
      { type: "spawn", pid: 123 },
      stdoutEvent(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: {
            type: "thinking_delta",
            delta: "private reasoning",
          },
        }),
      ),
      stdoutEvent(
        JSON.stringify({
          type: "tool_execution_start",
          toolCallId: "t1",
          toolName: "bash",
        }),
      ),
      stdoutEvent(JSON.stringify({ type: "auto_retry_start" })),
      stdoutEvent(JSON.stringify({ type: "compaction_start" })),
      stdoutEvent(JSON.stringify({ type: "agent_settled", aborted: false })),
      exitEvent(0),
    ];
    const updates: SingleResult[] = [];
    const result = await runner.runAgent(
      makeCtx([makeAgent()]),
      "worker",
      "task",
      undefined,
      1,
      undefined,
      (update) => updates.push(update.details.results[0]!),
    );
    expect(updates.map((r) => r.phase)).toEqual([
      "starting",
      "starting",
      "thinking",
      "tool",
      "retrying",
      "compacting",
      "finishing",
      "completed",
    ]);
    expect(
      updates.slice(0, -1).every((r) => r.exitCode === EXIT_CODE.RUNNING),
    ).toBe(true);
    expect(result.pid).toBe(123);
    expect(fs.readFileSync(result.manifestPath!, "utf8")).not.toContain(
      "private reasoning",
    );
  });

  it("preserves a readable report and cancellation diagnostics", async () => {
    const controller = new AbortController();
    adapter.run.mockImplementation(async (_request, onEvent) => {
      onEvent(
        stdoutEvent(
          JSON.stringify({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Work saved in commit abc" }],
            },
          }),
        ),
      );
      onEvent(
        stdoutEvent(
          JSON.stringify({
            type: "tool_execution_start",
            toolCallId: "t1",
            toolName: "bash",
          }),
        ),
      );
      controller.abort();
      onEvent({ type: "exit", code: null, signal: "SIGTERM" });
    });
    const result = await runner.runAgent(
      makeCtx([makeAgent()]),
      "worker",
      "secret task",
      undefined,
      2,
      controller.signal,
    );
    expect(result.phase).toBe("cancelled");
    expect(result.exitCode).toBe(EXIT_CODE.FAILED);
    expect(fs.readFileSync(result.reportPath!, "utf8")).toContain("commit abc");
    const manifest = JSON.parse(fs.readFileSync(result.manifestPath!, "utf8"));
    expect(manifest).toMatchObject({
      phase: "cancelled",
      exitSignal: "SIGTERM",
      step: 2,
    });
    expect(manifest.endedAt).toBeDefined();
    expect(manifest.activeTools).toEqual(["bash"]);
    expect(JSON.stringify(manifest)).not.toContain("secret task");
  });

  it("does not launch a pre-aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runner.runAgent(
      makeCtx([makeAgent()]),
      "worker",
      "task",
      undefined,
      undefined,
      controller.signal,
    );
    expect(adapter.run).not.toHaveBeenCalled();
    expect(result.phase).toBe("cancelled");
  });

  it("refreshes elapsed display without inventing child activity", async () => {
    adapter.run.mockImplementation(async (_request, onEvent) => {
      await new Promise((resolve) => setTimeout(resolve, 65));
      onEvent(exitEvent(0));
    });
    const updates: SingleResult[] = [];
    await runner.runAgent(
      makeCtx([makeAgent()]),
      "worker",
      "task",
      undefined,
      undefined,
      undefined,
      (update) => updates.push(update.details.results[0]!),
    );
    expect(updates.length).toBeGreaterThanOrEqual(4);
    expect(
      new Set(updates.slice(0, -1).map((r) => r.lastActivityAt)).size,
    ).toBe(1);
  });

  it("enforces an explicit per-child deadline and persists the reason", async () => {
    adapter.run.mockImplementation(async (request, onEvent) => {
      await new Promise<void>((resolve) =>
        request.abortSignal!.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      onEvent({ type: "exit", code: null, signal: "SIGTERM" });
    });
    const context = makeCtx([makeAgent()]);
    context.config.timeoutSeconds = 0.03;
    const result = await runner.runAgent(context, "worker", "task");
    expect(result.phase).toBe("failed");
    expect(result.errorMessage).toContain("deadline");
    expect(
      JSON.parse(fs.readFileSync(result.manifestPath!, "utf8")).errorMessage,
    ).toContain("deadline");
  });

  it("cancels active children on session shutdown", async () => {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    adapter.run.mockImplementation(async (request) => {
      started();
      await new Promise<void>((resolve) =>
        request.abortSignal!.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    });
    const run = runner.runAgent(makeCtx([makeAgent()]), "worker", "task");
    await ready;
    await runner.shutdown();
    expect((await run).phase).toBe("cancelled");
  });

  it("bounds stderr and counts malformed lines", async () => {
    adapter.events = [
      { type: "stderr", data: "x".repeat(100_000) },
      stdoutEvent("not json"),
      exitEvent(1),
    ];
    const result = await runner.runAgent(
      makeCtx([makeAgent()]),
      "worker",
      "task",
    );
    expect(result.stderr.length).toBe(16 * 1024);
    expect(result.malformedLines).toBe(1);
  });

  it("tracks concurrent tool completion and does not settle on agent_end", async () => {
    adapter.events = [
      stdoutEvent(
        JSON.stringify({
          type: "tool_execution_start",
          toolCallId: "a",
          toolName: "read",
        }),
      ),
      stdoutEvent(
        JSON.stringify({
          type: "tool_execution_start",
          toolCallId: "b",
          toolName: "bash",
        }),
      ),
      stdoutEvent(
        JSON.stringify({
          type: "tool_execution_update",
          toolCallId: "b",
          toolName: "bash",
        }),
      ),
      stdoutEvent(
        JSON.stringify({ type: "tool_execution_end", toolCallId: "a" }),
      ),
      stdoutEvent(JSON.stringify({ type: "agent_end", willRetry: true })),
    ];
    adapter.run.mockImplementation(async (_request, onEvent) => {
      for (const event of adapter.events) onEvent(event);
      await new Promise((resolve) => setTimeout(resolve, 30));
      onEvent(
        stdoutEvent(
          JSON.stringify({ type: "tool_execution_end", toolCallId: "b" }),
        ),
      );
      onEvent(
        stdoutEvent(JSON.stringify({ type: "agent_settled", aborted: false })),
      );
      onEvent(exitEvent(0));
    });
    const updates: SingleResult[] = [];
    await runner.runAgent(
      makeCtx([makeAgent()]),
      "worker",
      "task",
      undefined,
      undefined,
      undefined,
      (update) => updates.push(update.details.results[0]!),
    );
    expect(
      updates.some(
        (r) =>
          r.phase === "tool" &&
          JSON.stringify(r.activeTools) === '{"b":"bash"}' &&
          r.exitCode === EXIT_CODE.RUNNING,
      ),
    ).toBe(true);
    expect(updates.at(-1)?.activeTools).toEqual({});
  });

  it("clears a transient provider error after a successful retry", async () => {
    adapter.events = [
      stdoutEvent(
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: "rate limited",
          },
        }),
      ),
      stdoutEvent(JSON.stringify({ type: "auto_retry_start" })),
      stdoutEvent(JSON.stringify({ type: "auto_retry_end", success: true })),
      stdoutEvent(
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "done" }],
            stopReason: "stop",
          },
        }),
      ),
      exitEvent(0),
    ];
    const result = await runner.runAgent(
      makeCtx([makeAgent()]),
      "worker",
      "task",
    );
    expect(result.phase).toBe("completed");
    expect(result.errorMessage).toBeUndefined();
  });

  it("reports diagnostics write failures without losing successful work", async () => {
    const file = path.join(runsDirectory, "not-a-directory");
    fs.writeFileSync(file, "x");
    const brokenJournalRunner = new AgentRunner(adapter, {
      runsDirectory: file,
    });
    adapter.events = [exitEvent(0)];
    const result = await brokenJournalRunner.runAgent(
      makeCtx([makeAgent()]),
      "worker",
      "task",
    );
    expect(result.exitCode).toBe(EXIT_CODE.SUCCESS);
    expect(result.diagnosticsError).toBeTruthy();
  });

  it("captures spawn errors", async () => {
    adapter.events = [
      { type: "error", error: new Error("spawn failed") },
      exitEvent(EXIT_CODE.FAILED),
    ];

    const result = await runner.runAgent(
      makeCtx([makeAgent()]),
      "worker",
      "task",
    );

    expect(result.stderr).toBe("spawn failed");
    expect(result.exitCode).toBe(EXIT_CODE.FAILED);
  });
});
