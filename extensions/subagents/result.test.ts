import { describe, expect, it } from "vitest";
import type { Message } from "@earendil-works/pi-ai";
import {
  createTextResult,
  getDisplayItems,
  getFinalOutput,
  getResultOutput,
  isFailedResult,
  truncateParallelOutput,
} from "./result.ts";
import {
  EXIT_CODE,
  PER_TASK_OUTPUT_CAP,
  type SingleResult,
  type SubAgentToolContext,
  type SubagentDetails,
} from "./types.ts";

const makeMessage = (
  role: Message["role"],
  text: string,
  extras: Partial<Message> = {},
): Message =>
  ({
    role,
    content: [{ type: "text", text }],
    ...extras,
  }) as unknown as Message;

const stubContext = (): SubAgentToolContext => ({
  config: {} as SubAgentToolContext["config"],
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

describe("getFinalOutput", () => {
  it("returns the last assistant text", () => {
    const messages: Message[] = [
      makeMessage("user", "hello"),
      makeMessage("assistant", "first"),
      makeMessage("assistant", "second"),
    ];
    expect(getFinalOutput(messages)).toBe("second");
  });

  it("skips non-text assistant content", () => {
    const messages: Message[] = [
      makeMessage("assistant", "text"),
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            name: "read",
            arguments: {},
            callId: "1",
          },
        ],
      } as unknown as Message,
    ];
    expect(getFinalOutput(messages)).toBe("text");
  });

  it("returns empty string when there are no messages", () => {
    expect(getFinalOutput([])).toBe("");
  });
});

describe("isFailedResult", () => {
  it("is true for non-zero exit code", () => {
    expect(isFailedResult({ exitCode: EXIT_CODE.FAILED } as SingleResult)).toBe(
      true,
    );
  });

  it("is true for stopReason error", () => {
    expect(
      isFailedResult({
        exitCode: EXIT_CODE.SUCCESS,
        stopReason: "error",
      } as SingleResult),
    ).toBe(true);
  });

  it("is true for stopReason aborted", () => {
    expect(
      isFailedResult({
        exitCode: EXIT_CODE.SUCCESS,
        stopReason: "aborted",
      } as SingleResult),
    ).toBe(true);
  });

  it("is false for success", () => {
    expect(
      isFailedResult({
        exitCode: EXIT_CODE.SUCCESS,
        stopReason: "end",
      } as SingleResult),
    ).toBe(false);
  });
});

describe("getResultOutput", () => {
  it("returns final output on success", () => {
    const result = {
      exitCode: EXIT_CODE.SUCCESS,
      messages: [makeMessage("assistant", "done")],
    } as SingleResult;
    expect(getResultOutput(result)).toBe("done");
  });

  it("returns errorMessage on failure", () => {
    const result = {
      exitCode: EXIT_CODE.FAILED,
      messages: [makeMessage("assistant", "output")],
      errorMessage: "oops",
      stderr: "stderr",
    } as SingleResult;
    expect(getResultOutput(result)).toBe("oops");
  });

  it("falls back to stderr then final output then placeholder", () => {
    const noErrorMessage = {
      exitCode: EXIT_CODE.FAILED,
      messages: [],
      stderr: "stderr text",
    } as unknown as SingleResult;
    expect(getResultOutput(noErrorMessage)).toBe("stderr text");

    const noStderr = {
      exitCode: EXIT_CODE.FAILED,
      messages: [makeMessage("assistant", "msg")],
      stderr: "",
    } as unknown as SingleResult;
    expect(getResultOutput(noStderr)).toBe("msg");

    const nothing = {
      exitCode: EXIT_CODE.FAILED,
      messages: [],
      stderr: "",
    } as unknown as SingleResult;
    expect(getResultOutput(nothing)).toBe("(no output)");
  });
});

describe("truncateParallelOutput", () => {
  it("leaves short output untouched", () => {
    const text = "short";
    expect(truncateParallelOutput(text)).toBe(text);
  });

  it("caps output and reports omitted bytes", () => {
    const long = "x".repeat(PER_TASK_OUTPUT_CAP + 100);
    const result = truncateParallelOutput(long);
    expect(result).toContain("Output truncated:");
    expect(result).toContain("bytes omitted");
    // The truncated body itself respects the cap; the marker is appended on top.
    const marker = "\n\n[Output truncated:";
    const body = result.split(marker)[0]!;
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(
      PER_TASK_OUTPUT_CAP,
    );
  });

  it("produces valid UTF-8 after truncation", () => {
    const long = "🙂".repeat(20_000);
    const result = truncateParallelOutput(long);
    expect(result.includes("\uFFFD")).toBe(false);
  });
});

describe("getDisplayItems", () => {
  it("keeps text and toolCall items", () => {
    const messages: Message[] = [
      makeMessage("assistant", "text"),
      {
        role: "assistant",
        content: [
          { type: "toolCall", name: "read", arguments: {}, callId: "1" },
        ],
      } as unknown as Message,
      makeMessage("user", "ignored"),
    ];
    expect(getDisplayItems(messages)).toEqual([
      { type: "text", text: "text" },
      { type: "toolCall", name: "read", args: {} },
    ]);
  });
});

describe("createTextResult", () => {
  it("creates a text result with details and terminate default", () => {
    const ctx = stubContext();
    const results: SingleResult[] = [];
    const res = createTextResult(ctx, "hello", results);
    expect(res).toEqual({
      content: [{ type: "text", text: "hello" }],
      details: {
        mode: "single",
        agentScope: "user",
        projectAgentsDir: null,
        results,
      },
      terminate: false,
    });
  });

  it("respects terminate=true", () => {
    const ctx = stubContext();
    const res = createTextResult(ctx, "stop", [], true);
    expect(res.terminate).toBe(true);
  });
});
