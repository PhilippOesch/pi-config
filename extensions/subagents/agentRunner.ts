/**
 * AgentRunner - run a single subagent and assemble its result.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import {
  EXIT_CODE,
  type ExitCodeValue,
  type OnUpdateCallback,
  type SingleResult,
  type SubAgentToolContext,
  type UsageStats,
} from "./types.ts";
import { getFinalOutput } from "./result.ts";
import { errorMessage } from "../shared/utils.ts";
import type { AgentConfig } from "./agents.ts";
import { buildSpawnEnv } from "./awareness.ts";

type PiStreamEvent =
  | { type: "message_end"; message: Message }
  | { type: "tool_result_end"; message: Message }
  | { type: string };

function isMessageEndEvent(
  event: PiStreamEvent,
): event is { type: "message_end"; message: Message } {
  return event.type === "message_end" && "message" in event;
}

function isToolResultEndEvent(
  event: PiStreamEvent,
): event is { type: "tool_result_end"; message: Message } {
  return event.type === "tool_result_end" && "message" in event;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }

  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }

  return { command: "pi", args };
}

function resolveAgentModel(
  models: string[] | undefined,
  available: Model<Api>[],
): string | undefined {
  if (!models) {
    return undefined;
  }

  const availableModelSet = new Set<string>(
    available.map((entry) => `${entry.provider}/${entry.id}`),
  );

  return models.find((model) => availableModelSet.has(model));
}

async function writePromptToTempFile(
  agentName: string,
  prompt: string,
): Promise<{ dir: string; filePath: string }> {
  const tmpDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "pi-subagent-"),
  );
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  await withFileMutationQueue(filePath, async () => {
    await fs.promises.writeFile(filePath, prompt, {
      encoding: "utf-8",
      mode: 0o600,
    });
  });
  return { dir: tmpDir, filePath };
}

function createEmptyUsage(): UsageStats {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextTokens: 0,
    turns: 0,
  };
}

export type ProcessEvent =
  | { type: "stdout"; line: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number | null }
  | { type: "error"; error: Error };

export type SubagentProcessRequest = {
  command: string;
  args: string[];
  cwd: string;
  abortSignal?: AbortSignal;
};

export interface SubagentProcessAdapter {
  run(
    request: SubagentProcessRequest,
    onEvent: (event: ProcessEvent) => void,
  ): Promise<void>;
}

export class SpawnSubagentProcessAdapter implements SubagentProcessAdapter {
  async run(
    request: SubagentProcessRequest,
    onEvent: (event: ProcessEvent) => void,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const proc = spawn(request.command, request.args, {
        cwd: request.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: buildSpawnEnv(process.env),
      });
      let buffer = "";
      let exited = false;

      const killProc = () => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!exited) proc.kill("SIGKILL");
        }, 5000);
      };

      if (request.abortSignal) {
        if (request.abortSignal.aborted) killProc();
        else
          request.abortSignal.addEventListener("abort", killProc, {
            once: true,
          });
      }

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) onEvent({ type: "stdout", line });
      });

      proc.stderr.on("data", (data) => {
        onEvent({ type: "stderr", data: data.toString() });
      });

      proc.on("close", (code) => {
        exited = true;
        if (buffer.trim()) onEvent({ type: "stdout", line: buffer });
        onEvent({ type: "exit", code });
        resolve();
      });

      proc.on("error", (error) => {
        exited = true;
        onEvent({ type: "error", error });
        onEvent({ type: "exit", code: EXIT_CODE.FAILED });
        resolve();
      });
    });
  }
}

export class AgentRunner {
  constructor(private processAdapter: SubagentProcessAdapter) {}

  async runAgent(
    subAgentContext: SubAgentToolContext,
    agentName: string,
    task: string,
    cwd?: string,
    step?: number,
    abortSignal?: AbortSignal,
    onUpdateCb?: OnUpdateCallback,
  ): Promise<SingleResult> {
    const agent = subAgentContext.config.agents.find(
      (a) => a.name === agentName,
    );

    if (!agent) {
      const available =
        subAgentContext.config.agents.map((a) => `"${a.name}"`).join(", ") ||
        "none";
      return {
        agent: agentName,
        agentSource: "unknown",
        task,
        exitCode: EXIT_CODE.FAILED,
        messages: [],
        stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
        usage: createEmptyUsage(),
        step,
      };
    }

    const { args, model } = this.buildArgs(subAgentContext, agent, task);

    const currentResult: SingleResult = {
      agent: agentName,
      agentSource: agent.source,
      task,
      exitCode: EXIT_CODE.SUCCESS,
      messages: [],
      stderr: "",
      usage: createEmptyUsage(),
      model,
      step,
    };

    const emitUpdate = () => {
      if (onUpdateCb) {
        onUpdateCb({
          content: [
            {
              type: "text",
              text: getFinalOutput(currentResult.messages) || "(running...)",
            },
          ],
          details: subAgentContext.details.make([currentResult]),
        });
      }
    };

    let tmpPromptDir: string | null = null;
    let tmpPromptPath: string | null = null;

    try {
      if (agent.systemPrompt.trim()) {
        const tmp = await writePromptToTempFile(agent.name, agent.systemPrompt);
        tmpPromptDir = tmp.dir;
        tmpPromptPath = tmp.filePath;
        args.push("--append-system-prompt", tmpPromptPath);
      }

      const invocation = getPiInvocation(args);

      await this.processAdapter.run(
        {
          command: invocation.command,
          args: invocation.args,
          cwd: cwd ?? subAgentContext.config.cwd,
          abortSignal,
        },
        (event) => {
          switch (event.type) {
            case "stdout":
              this.processLine(event.line, currentResult, emitUpdate);
              break;
            case "stderr":
              currentResult.stderr += event.data;
              break;
            case "exit":
              currentResult.exitCode = event.code as ExitCodeValue;
              break;
            case "error":
              currentResult.stderr = errorMessage(event.error);
              currentResult.exitCode = EXIT_CODE.FAILED;
              break;
          }
        },
      );

      if (abortSignal?.aborted) throw new Error("Subagent was aborted");
      return currentResult;
    } finally {
      if (tmpPromptPath)
        try {
          fs.unlinkSync(tmpPromptPath);
        } catch {
          /* ignore */
        }
      if (tmpPromptDir)
        try {
          fs.rmdirSync(tmpPromptDir);
        } catch {
          /* ignore */
        }
    }
  }

  private buildArgs(
    subAgentContext: SubAgentToolContext,
    agent: AgentConfig,
    task: string,
  ): { args: string[]; model?: string } {
    const args: string[] = [
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--no-skills",
    ];
    const agentHasModel = Boolean(agent.model) || Boolean(agent.models?.length);
    const inheritsDispatchConfig = !agentHasModel;
    const model =
      resolveAgentModel(agent.models, subAgentContext.config.availableModels) ??
      agent.model ??
      subAgentContext.config.dispatchDefaults.model;
    if (model) args.push("--model", model);
    if (
      inheritsDispatchConfig &&
      subAgentContext.config.dispatchDefaults.thinkingLevel
    ) {
      args.push(
        "--thinking",
        subAgentContext.config.dispatchDefaults.thinkingLevel,
      );
    }
    if (agent.tools && agent.tools.length > 0)
      args.push("--tools", agent.tools.join(","));

    args.push(`Task: ${task}`);
    return { args, model };
  }

  private processLine(
    line: string,
    currentResult: SingleResult,
    emitUpdate: () => void,
  ): void {
    if (!line.trim()) return;
    let event: PiStreamEvent;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }

    if (isMessageEndEvent(event)) {
      const msg = event.message;
      currentResult.messages.push(msg);

      if (msg.role === "assistant") {
        currentResult.usage.turns++;
        const usage = msg.usage;
        if (usage) {
          currentResult.usage.input += usage.input || 0;
          currentResult.usage.output += usage.output || 0;
          currentResult.usage.cacheRead += usage.cacheRead || 0;
          currentResult.usage.cacheWrite += usage.cacheWrite || 0;
          currentResult.usage.cost += usage.cost?.total || 0;
          currentResult.usage.contextTokens = usage.totalTokens || 0;
        }
        if (!currentResult.model && msg.model) currentResult.model = msg.model;
        if (msg.stopReason) currentResult.stopReason = msg.stopReason;
        if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
      }
      emitUpdate();
    }

    if (isToolResultEndEvent(event)) {
      currentResult.messages.push(event.message);
      emitUpdate();
    }
  }
}

const defaultRunner = new AgentRunner(new SpawnSubagentProcessAdapter());

export function runAgent(
  ...args: Parameters<AgentRunner["runAgent"]>
): Promise<SingleResult> {
  return defaultRunner.runAgent(...args);
}
