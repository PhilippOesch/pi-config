import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { mapLimit } from "../shared/utils.ts";
import {
  EXIT_CODE,
  MAX_CONCURRENCY,
  MAX_PARALLEL_TASKS,
  type AgentMode,
  type OnUpdateCallback,
  type SingleResult,
  type SubAgentToolContext,
} from "./types.ts";
import { type ClassifiedParams } from "./validation.ts";
import { runAgent } from "./agentRunner.ts";
import {
  createTextResult,
  getFinalOutput,
  getResultOutput,
  isFailedResult,
  truncateParallelOutput,
} from "./result.ts";

const MAX_PREVIOUS_OUTPUT_CHARS = 4000;

function capPreviousOutput(output: string): string {
  if (output.length <= MAX_PREVIOUS_OUTPUT_CHARS) return output;
  return `${output.slice(0, MAX_PREVIOUS_OUTPUT_CHARS)}\n\n[Previous output truncated; full output is preserved in the prior step's tool details.]`;
}

type StrategyFn = (
  ctx: ExtensionContext,
  subAgentContext: SubAgentToolContext,
  classified: ClassifiedParams,
  signal?: AbortSignal,
  onUpdate?: AgentToolUpdateCallback<unknown>,
) => Promise<AgentToolResult<unknown>>;

const runSingle: StrategyFn = async (
  _ctx,
  subAgentContext,
  classified,
  signal,
  onUpdate,
) => {
  if (classified.kind !== "single") {
    throw new Error("Expected single mode parameters");
  }
  const result = await runAgent(
    subAgentContext,
    classified.agent,
    classified.task,
    classified.cwd,
    undefined,
    signal,
    onUpdate,
  );
  if (isFailedResult(result)) {
    const errorMsg = getResultOutput(result);
    return createTextResult(
      subAgentContext,
      `Agent ${result.stopReason || "failed"}: ${errorMsg}`,
      [result],
      true,
    );
  }
  return createTextResult(
    subAgentContext,
    getFinalOutput(result.messages) || "(no output)",
    [result],
  );
};

const runParallel: StrategyFn = async (
  _ctx,
  subAgentContext,
  classified,
  signal,
  onUpdate,
) => {
  if (classified.kind !== "parallel") {
    throw new Error("Expected parallel mode parameters");
  }
  if (classified.tasks.length > MAX_PARALLEL_TASKS) {
    return createTextResult(
      subAgentContext,
      `Too many parallel tasks (${classified.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
      [],
    );
  }

  const allResults: SingleResult[] = new Array(classified.tasks.length);

  for (let i = 0; i < classified.tasks.length; i++) {
    allResults[i] = {
      agent: classified.tasks[i].agent,
      agentSource: "unknown",
      task: classified.tasks[i].task,
      exitCode: EXIT_CODE.RUNNING,
      messages: [],
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
    };
  }

  const emitParallelUpdate = () => {
    if (onUpdate) {
      const running = allResults.filter(
        (r) => r.exitCode === EXIT_CODE.RUNNING,
      ).length;
      const done = allResults.filter(
        (r) => r.exitCode !== EXIT_CODE.RUNNING,
      ).length;
      onUpdate(
        createTextResult(
          subAgentContext,
          `Parallel: ${done}/${allResults.length} done, ${running} running...`,
          [...allResults],
        ),
      );
    }
  };

  const results = await mapLimit(
    classified.tasks,
    MAX_CONCURRENCY,
    async (t, index) => {
      const result = await runAgent(
        subAgentContext,
        t.agent,
        t.task,
        t.cwd,
        undefined,
        signal,
        (partial) => {
          if (partial.details?.results[0]) {
            allResults[index] = partial.details.results[0];
            emitParallelUpdate();
          }
        },
      );
      allResults[index] = result;
      emitParallelUpdate();
      return result;
    },
  );

  const successCount = results.filter((r) => !isFailedResult(r)).length;
  const summaries = results.map((r) => {
    const output = truncateParallelOutput(getResultOutput(r));
    const status = isFailedResult(r)
      ? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
      : "completed";
    return `### [${r.agent}] ${status}\n\n${output}`;
  });
  return createTextResult(
    subAgentContext,
    `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
    results,
  );
};

const runChain: StrategyFn = async (
  _ctx,
  subAgentContext,
  classified,
  signal,
  onUpdate,
) => {
  if (classified.kind !== "chain") {
    throw new Error("Expected chain mode parameters");
  }
  const chain = classified.chain;
  const results: SingleResult[] = [];
  let previousOutput = "";

  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    const taskWithContext = step.task.replace(
      /\{previous\}/g,
      capPreviousOutput(previousOutput),
    );

    const chainUpdate: OnUpdateCallback | undefined = onUpdate
      ? (partial) => {
          const currentResult = partial.details?.results[0];
          if (currentResult) {
            const allResults = [...results, currentResult];
            onUpdate({
              content: partial.content,
              details: subAgentContext.details.make(allResults),
            });
          }
        }
      : undefined;

    const result = await runAgent(
      subAgentContext,
      step.agent,
      taskWithContext,
      step.cwd,
      i + 1,
      signal,
      chainUpdate,
    );
    results.push(result);

    if (isFailedResult(result)) {
      const errorMsg = getResultOutput(result);
      return createTextResult(
        subAgentContext,
        `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}`,
        results,
        true,
      );
    }
    previousOutput = capPreviousOutput(getFinalOutput(result.messages));
  }
  return createTextResult(
    subAgentContext,
    getFinalOutput(results[results.length - 1].messages) || "(no output)",
    results,
  );
};

export const strategies: Record<AgentMode, StrategyFn> = {
  single: runSingle,
  parallel: runParallel,
  chain: runChain,
};
