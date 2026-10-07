import type { SugagentToolParams } from "./types.ts";

export interface InvalidModeCountError {
  type: "invalidModeCount";
}

export type ValidationError = InvalidModeCountError;

export type ClassifiedParams =
  | { kind: "single"; agent: string; task: string; cwd?: string }
  | {
      kind: "parallel";
      tasks: NonNullable<SugagentToolParams["tasks"]>;
    }
  | {
      kind: "chain";
      chain: NonNullable<SugagentToolParams["chain"]>;
    }
  | { kind: "invalid"; error: ValidationError };

export function classifyParams(params: SugagentToolParams): ClassifiedParams {
  const hasChain = (params.chain?.length ?? 0) > 0;
  const hasTasks = (params.tasks?.length ?? 0) > 0;
  const hasSingle = Boolean(params.agent && params.task);
  const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

  if (modeCount !== 1) {
    return { kind: "invalid", error: { type: "invalidModeCount" } };
  }

  if (hasSingle) {
    return {
      kind: "single",
      agent: params.agent!,
      task: params.task!,
      cwd: params.cwd,
    };
  }

  if (hasTasks) {
    return { kind: "parallel", tasks: params.tasks! };
  }

  return { kind: "chain", chain: params.chain! };
}
