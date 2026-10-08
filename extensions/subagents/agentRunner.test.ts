import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import type { Model, Api } from "@earendil-works/pi-ai";
import { AgentRunner, type ProcessEvent } from "./agentRunner.ts";
import {
  EXIT_CODE,
  type SingleResult,
  type SubAgentToolContext,
  type SubagentDetails,
} from "./types.ts";
import type { AgentConfig } from "./agents.ts";

class FakeProcessAdapter {
  events: ProcessEvent[] = [];
  run = vi.fn(async (_request, onEvent) => {
    for (const event of this.events) {
      onEvent(event);
    }
  });
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

  beforeEach(() => {
    adapter = new FakeProcessAdapter();
    runner = new AgentRunner(adapter);
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
