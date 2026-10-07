import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { SubagentDispatch, type ConfirmationAdapter } from "./dispatch.ts";
import * as agentsModule from "./agents.ts";
import * as sharedUtils from "../shared/utils.ts";
import * as agentStrategy from "./agentStrategy.ts";
import { type SugagentToolParams } from "./types.ts";
import type { AgentConfig } from "./agents.ts";

vi.mock("./agents.ts", async (importOriginal) => {
  const original = await importOriginal<typeof agentsModule>();
  return {
    ...original,
    discoverAgents: vi.fn(original.discoverAgents),
  };
});

vi.mock("../shared/utils.ts", async (importOriginal) => {
  const original = await importOriginal<typeof sharedUtils>();
  return {
    ...original,
    isReadModeActive: vi.fn(original.isReadModeActive),
  };
});

vi.mock("./agentStrategy.ts", async (importOriginal) => {
  const original = await importOriginal<typeof agentStrategy>();
  return {
    ...original,
    strategies: { ...original.strategies },
  };
});

const makeAgent = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  name: "worker",
  description: "worker agent",
  systemPrompt: "",
  source: "user",
  filePath: "/tmp/worker.md",
  ...overrides,
});

const makeCtx = (overrides: Partial<ExtensionContext> = {}): ExtensionContext =>
  ({
    cwd: "/tmp",
    model: { provider: "default", id: "provider" },
    thinkingLevel: "medium",
    modelRegistry: { getAvailable: () => [] },
    hasUI: true,
    ui: { confirm: vi.fn() },
    sessionManager: { getBranch: () => [] },
    ...overrides,
  }) as unknown as ExtensionContext;

const successResult: AgentToolResult<unknown> = {
  content: [{ type: "text", text: "done" }],
  details: undefined,
  terminate: false,
};

const stubStrategy = vi.fn(async () => successResult);

beforeEach(() => {
  vi.mocked(agentsModule.discoverAgents).mockReturnValue({
    agents: [makeAgent()],
    projectAgentsDir: null,
  });
  vi.mocked(sharedUtils.isReadModeActive).mockReturnValue(false);
  Object.assign(agentStrategy.strategies, { single: stubStrategy });
  stubStrategy.mockResolvedValue(successResult);
});

const runDispatch = (
  ctx: ExtensionContext,
  params: SugagentToolParams,
  confirm: ConfirmationAdapter = {
    available: true,
    confirm: vi.fn(async () => true),
  },
) => new SubagentDispatch(ctx, params, undefined, undefined, confirm).execute();

describe("SubagentDispatch", () => {
  it("returns invalid outcome when no mode is provided", async () => {
    const outcome = await runDispatch(makeCtx(), {});
    expect(outcome.outcome).toBe("invalid");
    if (outcome.outcome === "invalid") {
      expect(outcome.text).toContain("Invalid parameters");
      expect(outcome.context.config.mode).toBe("single");
    }
  });

  it("returns invalid outcome when multiple modes are provided", async () => {
    const outcome = await runDispatch(makeCtx(), {
      agent: "worker",
      task: "do it",
      tasks: [{ agent: "worker", task: "also" }],
    });
    expect(outcome.outcome).toBe("invalid");
  });

  it("runs the strategy for a single task", async () => {
    const outcome = await runDispatch(makeCtx(), {
      agent: "worker",
      task: "do it",
    });
    expect(outcome.outcome).toBe("success");
    expect(stubStrategy).toHaveBeenCalledTimes(1);
  });

  it("blocks privileged agents in save mode without UI", async () => {
    vi.mocked(sharedUtils.isReadModeActive).mockReturnValue(true);
    vi.mocked(agentsModule.discoverAgents).mockReturnValue({
      agents: [makeAgent({ requiresConfirmation: true })],
      projectAgentsDir: null,
    });

    const outcome = await runDispatch(
      makeCtx({ hasUI: false }),
      { agent: "worker", task: "do it" },
      { available: false, confirm: vi.fn(async () => false) },
    );

    expect(outcome.outcome).toBe("blocked");
    expect(stubStrategy).not.toHaveBeenCalled();
  });

  it("blocks privileged agents in save mode when user denies", async () => {
    vi.mocked(sharedUtils.isReadModeActive).mockReturnValue(true);
    vi.mocked(agentsModule.discoverAgents).mockReturnValue({
      agents: [makeAgent({ requiresConfirmation: true })],
      projectAgentsDir: null,
    });

    const outcome = await runDispatch(
      makeCtx(),
      { agent: "worker", task: "do it" },
      { available: true, confirm: vi.fn(async () => false) },
    );

    expect(outcome.outcome).toBe("blocked");
    expect(stubStrategy).not.toHaveBeenCalled();
  });

  it("runs privileged agents in save mode when user approves", async () => {
    vi.mocked(sharedUtils.isReadModeActive).mockReturnValue(true);
    vi.mocked(agentsModule.discoverAgents).mockReturnValue({
      agents: [makeAgent({ requiresConfirmation: true })],
      projectAgentsDir: null,
    });

    const outcome = await runDispatch(makeCtx(), {
      agent: "worker",
      task: "do it",
    });

    expect(outcome.outcome).toBe("success");
  });

  it("skips privileged gate when not in save mode", async () => {
    vi.mocked(agentsModule.discoverAgents).mockReturnValue({
      agents: [makeAgent({ requiresConfirmation: true })],
      projectAgentsDir: null,
    });

    const outcome = await runDispatch(
      makeCtx(),
      { agent: "worker", task: "do it" },
      { available: false, confirm: vi.fn(async () => false) },
    );

    expect(outcome.outcome).toBe("success");
  });

  it("skips project-local gate when no UI is available", async () => {
    vi.mocked(agentsModule.discoverAgents).mockReturnValue({
      agents: [makeAgent({ source: "project" })],
      projectAgentsDir: "/project/.pi/agents",
    });

    const outcome = await runDispatch(
      makeCtx({ hasUI: false }),
      { agent: "worker", task: "do it", agentScope: "project" },
      { available: false, confirm: vi.fn(async () => false) },
    );

    expect(outcome.outcome).toBe("success");
  });

  it("blocks project-local agents when user denies", async () => {
    vi.mocked(agentsModule.discoverAgents).mockReturnValue({
      agents: [makeAgent({ source: "project" })],
      projectAgentsDir: "/project/.pi/agents",
    });

    const outcome = await runDispatch(
      makeCtx(),
      { agent: "worker", task: "do it", agentScope: "project" },
      { available: true, confirm: vi.fn(async () => false) },
    );

    expect(outcome.outcome).toBe("blocked");
    expect(stubStrategy).not.toHaveBeenCalled();
  });

  it("runs project-local agents when user approves", async () => {
    vi.mocked(agentsModule.discoverAgents).mockReturnValue({
      agents: [makeAgent({ source: "project" })],
      projectAgentsDir: "/project/.pi/agents",
    });

    const outcome = await runDispatch(makeCtx(), {
      agent: "worker",
      task: "do it",
      agentScope: "project",
    });

    expect(outcome.outcome).toBe("success");
  });

  it("returns strategyError when no strategy matches the mode", async () => {
    Object.assign(agentStrategy.strategies, { single: undefined });

    const outcome = await runDispatch(makeCtx(), {
      agent: "worker",
      task: "do it",
    });

    expect(outcome.outcome).toBe("strategyError");
    expect(stubStrategy).not.toHaveBeenCalled();
  });

  it("passes signal and onUpdate to the strategy", async () => {
    const signal = new AbortController().signal;
    const onUpdate = vi.fn();
    const confirm: ConfirmationAdapter = {
      available: true,
      confirm: vi.fn(async () => true),
    };

    const dispatch = new SubagentDispatch(
      makeCtx(),
      { agent: "worker", task: "do it" },
      signal,
      onUpdate,
      confirm,
    );
    await dispatch.execute();

    expect(stubStrategy).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ kind: "single" }),
      signal,
      onUpdate,
    );
  });
});
