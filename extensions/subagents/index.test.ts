import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import register from "./index.ts";
import { shutdownAgents } from "./agentRunner.ts";

vi.mock("./agentRunner.ts", () => ({
  shutdownAgents: vi.fn(),
  runAgent: vi.fn(),
}));

describe("subagent registration", () => {
  it("is model-only and cleans up owned children on shutdown", async () => {
    const registerTool = vi.fn();
    const on = vi.fn();
    register({ registerTool, on } as unknown as ExtensionAPI);
    expect(registerTool).toHaveBeenCalledWith(
      expect.objectContaining({ name: "subagent", exposure: "model-only" }),
    );
    const handler = on.mock.calls.find(
      ([event]) => event === "session_shutdown",
    )?.[1];
    expect(handler).toBeDefined();
    await handler();
    expect(shutdownAgents).toHaveBeenCalled();
  });
});
