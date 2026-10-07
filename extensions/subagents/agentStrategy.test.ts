import { describe, expect, it, vi } from "vitest";
import { strategies } from "./agentStrategy.ts";
import { runAgent } from "./agentRunner.ts";
import * as sharedUtils from "../shared/utils.ts";
import {
  EXIT_CODE,
  MAX_CONCURRENCY,
  MAX_PARALLEL_TASKS,
  type SingleResult,
  type SubAgentToolContext,
  type SubagentDetails,
} from "./types.ts";
import type { Message } from "@earendil-works/pi-ai";
import type { ClassifiedParams } from "./validation.ts";

vi.mock("./agentRunner.ts");
vi.mock("../shared/utils.ts", async (importOriginal) => {
  const original = await importOriginal<typeof sharedUtils>();
  return {
    ...original,
    mapLimit: vi.fn(original.mapLimit),
  };
});

const makeSuccess = (
  agent: string,
  text: string,
  overrides: Partial<SingleResult> = {},
): SingleResult =>
  ({
    agent,
    agentSource: "user",
    task: "task",
    exitCode: EXIT_CODE.SUCCESS,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text }],
      } as unknown as Message,
    ],
    stderr: "",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 0,
    },
    ...overrides,
  }) as SingleResult;

const makeFailure = (agent: string, reason: string): SingleResult => ({
  agent,
  agentSource: "user",
  task: "task",
  exitCode: EXIT_CODE.FAILED,
  messages: [],
  stderr: reason,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  },
});

const stubContext = (): SubAgentToolContext => ({
  config: {
    cwd: "/tmp",
    agentScope: "user",
    dispatchDefaults: {},
    agents: [],
    projectAgentsDir: null,
    availableModels: [],
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

describe("strategies.single", () => {
  it("returns final output on success", async () => {
    vi.mocked(runAgent).mockResolvedValueOnce(makeSuccess("a", "done"));
    const result = await strategies.single(
      {} as Parameters<typeof strategies.single>[0],
      stubContext(),
      { kind: "single", agent: "a", task: "t" } as ClassifiedParams,
    );
    expect((result.content[0] as { text: string }).text).toBe("done");
    expect(result.terminate).toBe(false);
  });

  it("returns failure message with terminate on failure", async () => {
    vi.mocked(runAgent).mockResolvedValueOnce(makeFailure("a", "boom"));
    const result = await strategies.single(
      {} as Parameters<typeof strategies.single>[0],
      stubContext(),
      { kind: "single", agent: "a", task: "t" } as ClassifiedParams,
    );
    expect((result.content[0] as { text: string }).text).toContain(
      "Agent failed: boom",
    );
    expect(result.terminate).toBe(true);
  });
});

describe("strategies.parallel", () => {
  it("rejects more than MAX_PARALLEL_TASKS tasks", async () => {
    // Use a literal count so the test fails if the source constant is raised.
    const tasks = Array.from({ length: 9 }, (_, i) => ({
      agent: `a${i}`,
      task: `t${i}`,
    }));
    const result = await strategies.parallel(
      {} as Parameters<typeof strategies.parallel>[0],
      stubContext(),
      { kind: "parallel", tasks } as ClassifiedParams,
    );
    expect(runAgent).not.toHaveBeenCalled();
    expect((result.content[0] as { text: string }).text).toContain(
      "Too many parallel tasks",
    );
    expect((result.content[0] as { text: string }).text).toContain(
      String(MAX_PARALLEL_TASKS),
    );
  });

  it("passes MAX_CONCURRENCY to mapLimit", async () => {
    vi.mocked(runAgent).mockResolvedValue(makeSuccess("a", "ok"));
    const tasks = [
      { agent: "a1", task: "t1" },
      { agent: "a2", task: "t2" },
    ];
    await strategies.parallel(
      {} as Parameters<typeof strategies.parallel>[0],
      stubContext(),
      { kind: "parallel", tasks } as ClassifiedParams,
    );
    expect(sharedUtils.mapLimit).toHaveBeenCalledWith(
      tasks,
      MAX_CONCURRENCY,
      expect.any(Function),
    );
  });

  it("summarizes parallel results", async () => {
    vi.mocked(runAgent)
      .mockResolvedValueOnce(makeSuccess("a", "ok"))
      .mockResolvedValueOnce(makeFailure("b", "nope"));
    const result = await strategies.parallel(
      {} as Parameters<typeof strategies.parallel>[0],
      stubContext(),
      {
        kind: "parallel",
        tasks: [
          { agent: "a", task: "t1" },
          { agent: "b", task: "t2" },
        ],
      } as ClassifiedParams,
    );
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Parallel: 1/2 succeeded");
    expect(text).toContain("### [a] completed");
    expect(text).toContain("### [b] failed");
  });
});

describe("strategies.chain", () => {
  it("replaces {previous} with prior output", async () => {
    vi.mocked(runAgent)
      .mockResolvedValueOnce(makeSuccess("a", "step-one"))
      .mockResolvedValueOnce(makeSuccess("b", "step-two"));
    await strategies.chain(
      {} as Parameters<typeof strategies.chain>[0],
      stubContext(),
      {
        kind: "chain",
        chain: [
          { agent: "a", task: "first" },
          { agent: "b", task: "second {previous}" },
        ],
      } as ClassifiedParams,
    );
    expect(runAgent).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "b",
      "second step-one",
      undefined,
      2,
      undefined,
      undefined,
    );
  });

  it("truncates {previous} to 4000 chars with literal marker", async () => {
    const longOutput = "x".repeat(5000);
    vi.mocked(runAgent)
      .mockResolvedValueOnce(makeSuccess("a", longOutput))
      .mockResolvedValueOnce(makeSuccess("b", "ok"));
    await strategies.chain(
      {} as Parameters<typeof strategies.chain>[0],
      stubContext(),
      {
        kind: "chain",
        chain: [
          { agent: "a", task: "first" },
          { agent: "b", task: "second {previous}" },
        ],
      } as ClassifiedParams,
    );
    const secondTask = vi.mocked(runAgent).mock.calls[1]?.[2] as string;
    expect(secondTask).toContain("x".repeat(4000));
    expect(secondTask).toContain(
      "[Previous output truncated; full output is preserved in the prior step's tool details.]",
    );
  });

  it("stops chain on first failure with terminate", async () => {
    vi.mocked(runAgent)
      .mockResolvedValueOnce(makeSuccess("a", "ok"))
      .mockResolvedValueOnce(makeFailure("b", "bad"));
    const result = await strategies.chain(
      {} as Parameters<typeof strategies.chain>[0],
      stubContext(),
      {
        kind: "chain",
        chain: [
          { agent: "a", task: "first" },
          { agent: "b", task: "second" },
        ],
      } as ClassifiedParams,
    );
    expect(runAgent).toHaveBeenCalledTimes(2);
    expect((result.content[0] as { text: string }).text).toContain(
      "Chain stopped at step 2 (b)",
    );
    expect(result.terminate).toBe(true);
  });
});
