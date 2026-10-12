/**
 * AgentRunner - run a single subagent and assemble its result.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  withFileMutationQueue,
  type JsonAgentSessionEvent,
} from "@earendil-works/pi-coding-agent";
import {
  EXIT_CODE,
  type OnUpdateCallback,
  type SingleResult,
  type SubAgentToolContext,
  type UsageStats,
} from "./types.ts";
import { getFinalOutput } from "./result.ts";
import { errorMessage } from "../shared/utils.ts";
import type { AgentConfig } from "./agents.ts";
import {
  SpawnSubagentProcessAdapter,
  type SubagentProcessAdapter,
} from "./process.ts";
import {
  defaultRunsDirectory,
  MAX_STDERR_CHARS,
  RunJournal,
} from "./runJournal.ts";
export {
  SpawnSubagentProcessAdapter,
  type ProcessEvent,
  type SubagentProcessRequest,
  type SubagentProcessAdapter,
} from "./process.ts";

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

const SUBAGENT_SYSTEM_PROMPT = [
  "You are running as a Pi subagent, not the primary agent.",
  "The global AGENTS.md instructions to load i-have-adhd and caveman apply only to the primary agent; do not load either skill.",
].join(" ");

export class AgentRunner {
  private readonly active = new Map<AbortController, Promise<void>>();

  constructor(
    private processAdapter: SubagentProcessAdapter,
    private readonly options: {
      runsDirectory?: string;
      heartbeatMs?: number;
    } = {},
  ) {}

  async shutdown(): Promise<void> {
    const active = [...this.active.entries()];
    for (const [controller] of active)
      controller.abort(new Error("Pi session shut down"));
    await Promise.allSettled(active.map(([, done]) => done));
  }

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

    const { args, model } = this.buildArgs(subAgentContext, agent);

    const currentResult: SingleResult = {
      agent: agentName,
      agentSource: agent.source,
      task,
      exitCode: EXIT_CODE.RUNNING,
      phase: "starting",
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      activeTools: {},
      messages: [],
      stderr: "",
      usage: createEmptyUsage(),
      model,
      step,
    };

    const controller = new AbortController();
    const forwardAbort = () => controller.abort(abortSignal?.reason);
    abortSignal?.addEventListener("abort", forwardAbort, { once: true });
    if (abortSignal?.aborted) forwardAbort();
    let markDone!: () => void;
    this.active.set(
      controller,
      new Promise<void>((resolve) => {
        markDone = resolve;
      }),
    );
    let timedOut = false;
    const deadline =
      subAgentContext.config.timeoutSeconds == null
        ? undefined
        : setTimeout(() => {
            if (controller.signal.aborted) return;
            timedOut = true;
            controller.abort(
              new Error(
                `Subagent exceeded ${subAgentContext.config.timeoutSeconds}s deadline`,
              ),
            );
          }, subAgentContext.config.timeoutSeconds * 1000);
    let journal: RunJournal | undefined;
    const persist = (finished = false) => {
      try {
        if (finished) journal?.finish(currentResult);
        else journal?.checkpoint(currentResult);
      } catch (error) {
        currentResult.diagnosticsError = errorMessage(error);
      }
    };
    let lastUpdate = 0;
    const emitUpdate = (force = false) => {
      if (!force && Date.now() - lastUpdate < 200) return;
      lastUpdate = Date.now();
      onUpdateCb?.({
        content: [
          {
            type: "text",
            text:
              getFinalOutput(currentResult.messages) ||
              `(${currentResult.phase}...)`,
          },
        ],
        details: subAgentContext.details.make([
          {
            ...currentResult,
            messages: [...currentResult.messages],
            usage: { ...currentResult.usage },
            activeTools: { ...currentResult.activeTools },
          },
        ]),
      });
    };
    const heartbeat = setInterval(() => {
      persist();
      emitUpdate(true);
    }, this.options.heartbeatMs ?? 1000);
    let tmpPromptDir: string | null = null;
    let tmpPromptPath: string | null = null;

    try {
      try {
        journal = new RunJournal(
          this.options.runsDirectory ?? defaultRunsDirectory(),
          subAgentContext,
          cwd ?? subAgentContext.config.cwd,
        );
        currentResult.manifestPath = journal.manifestPath;
        currentResult.reportPath = journal.reportPath;
        persist();
      } catch (error) {
        currentResult.diagnosticsError = errorMessage(error);
      }
      emitUpdate(true);
      if (controller.signal.aborted) return currentResult;
      const agentPrompt = [SUBAGENT_SYSTEM_PROMPT, agent.systemPrompt.trim()]
        .filter(Boolean)
        .join("\n\n");
      if (agentPrompt) {
        const tmp = await writePromptToTempFile(agent.name, agentPrompt);
        tmpPromptDir = tmp.dir;
        tmpPromptPath = tmp.filePath;
        args.push("--append-system-prompt", tmpPromptPath);
      }
      args.push(`Task: ${task}`);

      const invocation = getPiInvocation(args);

      await this.processAdapter.run(
        {
          command: invocation.command,
          args: invocation.args,
          cwd: cwd ?? subAgentContext.config.cwd,
          abortSignal: controller.signal,
        },
        (event) => {
          if (
            event.type === "spawn" ||
            event.type === "stdout" ||
            event.type === "stderr"
          )
            currentResult.lastActivityAt = Date.now();
          switch (event.type) {
            case "spawn":
              currentResult.pid = event.pid;
              persist();
              emitUpdate(true);
              break;
            case "stdout": {
              const phase = currentResult.phase;
              try {
                this.processLine(event.line, currentResult);
              } catch {
                currentResult.malformedLines =
                  (currentResult.malformedLines ?? 0) + 1;
              }
              emitUpdate(phase !== currentResult.phase);
              break;
            }
            case "stderr":
              currentResult.stderr = (currentResult.stderr + event.data).slice(
                -MAX_STDERR_CHARS,
              );
              emitUpdate();
              break;
            case "exit":
              currentResult.exitCode =
                event.code === 0 ? EXIT_CODE.SUCCESS : EXIT_CODE.FAILED;
              currentResult.exitSignal = event.signal;
              break;
            case "error":
              currentResult.errorMessage = errorMessage(event.error);
              currentResult.stderr = errorMessage(event.error);
              currentResult.exitCode = EXIT_CODE.FAILED;
              break;
          }
        },
      );
      return currentResult;
    } catch (error) {
      currentResult.exitCode = EXIT_CODE.FAILED;
      currentResult.errorMessage = errorMessage(error);
      return currentResult;
    } finally {
      clearInterval(heartbeat);
      clearTimeout(deadline);
      abortSignal?.removeEventListener("abort", forwardAbort);
      if (controller.signal.aborted) {
        currentResult.exitCode = EXIT_CODE.FAILED;
        currentResult.stopReason = timedOut ? "error" : "aborted";
        currentResult.phase = timedOut ? "failed" : "cancelled";
        currentResult.errorMessage = timedOut
          ? `Subagent exceeded ${subAgentContext.config.timeoutSeconds}s deadline`
          : `Subagent was cancelled${controller.signal.reason instanceof Error ? `: ${controller.signal.reason.message}` : ""}`;
      } else {
        if (
          currentResult.exitCode === EXIT_CODE.RUNNING ||
          currentResult.stopReason === "error" ||
          currentResult.stopReason === "aborted"
        )
          currentResult.exitCode = EXIT_CODE.FAILED;
        currentResult.phase =
          currentResult.stopReason === "aborted"
            ? "cancelled"
            : currentResult.exitCode === EXIT_CODE.SUCCESS
              ? "completed"
              : "failed";
      }
      currentResult.endedAt = Date.now();
      // Keep active tool names on cancellation/failure for post-mortem diagnosis.
      persist(true);
      this.active.delete(controller);
      markDone();
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
      emitUpdate(true);
    }
  }

  private buildArgs(
    subAgentContext: SubAgentToolContext,
    agent: AgentConfig,
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

    return { args, model };
  }

  private processLine(line: string, result: SingleResult): void {
    if (!line.trim()) return;
    let event: JsonAgentSessionEvent;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || !("type" in parsed))
        throw new Error("Not an event");
      event = parsed as JsonAgentSessionEvent;
    } catch {
      result.malformedLines = (result.malformedLines ?? 0) + 1;
      return;
    }
    switch (event.type) {
      case "agent_start":
      case "turn_start":
      case "message_start":
        result.phase = "thinking";
        break;
      case "message_update":
        // Show activity, not private thinking text or partially generated arguments.
        result.phase = event.assistantMessageEvent.type.startsWith("text_")
          ? "responding"
          : "thinking";
        break;
      case "message_end": {
        const msg = event.message;
        if (
          msg?.role === "assistant" &&
          (!Array.isArray(msg.content) ||
            msg.content.some((part) => !part || typeof part.type !== "string"))
        ) {
          result.malformedLines = (result.malformedLines ?? 0) + 1;
          break;
        }
        if (
          msg.role !== "assistant" &&
          msg.role !== "user" &&
          msg.role !== "toolResult"
        )
          break;
        result.messages.push(msg);
        if (msg.role === "assistant") {
          result.usage.turns++;
          const usage = msg.usage;
          if (usage) {
            result.usage.input += usage.input || 0;
            result.usage.output += usage.output || 0;
            result.usage.cacheRead += usage.cacheRead || 0;
            result.usage.cacheWrite += usage.cacheWrite || 0;
            result.usage.cost += usage.cost?.total || 0;
            result.usage.contextTokens = usage.totalTokens || 0;
          }
          if (msg.model)
            result.model = msg.provider
              ? `${msg.provider}/${msg.model}`
              : msg.model;
          result.stopReason = msg.stopReason;
          result.errorMessage = msg.errorMessage;
        }
        break;
      }
      case "tool_execution_start":
      case "tool_execution_update":
        (result.activeTools ??= {})[event.toolCallId] = event.toolName;
        result.phase = "tool";
        break;
      case "tool_execution_end":
        delete result.activeTools?.[event.toolCallId];
        result.phase = Object.keys(result.activeTools ?? {}).length
          ? "tool"
          : "thinking";
        break;
      case "auto_retry_start":
      case "summarization_retry_scheduled":
        result.phase = "retrying";
        break;
      case "compaction_start":
      case "summarization_retry_attempt_start":
        result.phase = "compacting";
        break;
      case "auto_retry_end":
      case "compaction_end":
      case "summarization_retry_finished":
        result.phase = "thinking";
        break;
      case "agent_settled":
        result.phase = "finishing";
        if (event.aborted) result.stopReason = "aborted";
        break;
      // agent_end is not final: retries and compaction can still follow it.
    }
  }
}

const defaultRunner = new AgentRunner(new SpawnSubagentProcessAdapter());

export function shutdownAgents(): Promise<void> {
  return defaultRunner.shutdown();
}

export function runAgent(
  ...args: Parameters<AgentRunner["runAgent"]>
): Promise<SingleResult> {
  return defaultRunner.runAgent(...args);
}
