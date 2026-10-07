import { describe, expect, it } from "vitest";
import { classifyParams } from "./validation.ts";
import { isChain, isSingleTask, isTasks } from "./types.ts";

describe("classifyParams", () => {
  it("classifies a single task", () => {
    expect(
      classifyParams({ agent: "worker", task: "do work", cwd: "/tmp" }),
    ).toEqual({
      kind: "single",
      agent: "worker",
      task: "do work",
      cwd: "/tmp",
    });
  });

  it("classifies parallel tasks", () => {
    const tasks = [
      { agent: "a", task: "1" },
      { agent: "b", task: "2" },
    ];
    expect(classifyParams({ tasks })).toEqual({ kind: "parallel", tasks });
  });

  it("classifies a chain", () => {
    const chain = [{ agent: "a", task: "1" }];
    expect(classifyParams({ chain })).toEqual({ kind: "chain", chain });
  });

  it("returns invalid when no mode is provided", () => {
    expect(classifyParams({})).toEqual({
      kind: "invalid",
      error: { type: "invalidModeCount" },
    });
  });

  it("returns invalid when multiple modes are provided", () => {
    expect(
      classifyParams({
        agent: "a",
        task: "t",
        tasks: [{ agent: "b", task: "u" }],
      }),
    ).toEqual({
      kind: "invalid",
      error: { type: "invalidModeCount" },
    });
  });

  it("treats empty tasks as unset", () => {
    expect(classifyParams({ tasks: [] })).toEqual({
      kind: "invalid",
      error: { type: "invalidModeCount" },
    });
  });

  it("treats empty chain as unset", () => {
    expect(classifyParams({ chain: [] })).toEqual({
      kind: "invalid",
      error: { type: "invalidModeCount" },
    });
  });
});

describe("type guards", () => {
  it("isSingleTask is true only when agent and task are present", () => {
    expect(isSingleTask({ agent: "a", task: "t" })).toBe(true);
    expect(isSingleTask({ agent: "a" })).toBe(false);
    expect(isSingleTask({ task: "t" })).toBe(false);
    expect(isSingleTask({})).toBe(false);
  });

  it("isTasks is true only for non-empty tasks", () => {
    expect(isTasks({ tasks: [{ agent: "a", task: "t" }] })).toBe(true);
    expect(isTasks({ tasks: [] })).toBe(false);
    expect(isTasks({})).toBe(false);
  });

  it("isChain is true only for non-empty chain", () => {
    expect(isChain({ chain: [{ agent: "a", task: "t" }] })).toBe(true);
    expect(isChain({ chain: [] })).toBe(false);
    expect(isChain({})).toBe(false);
  });
});
