import type { Message, Model, Api } from "@earendil-works/pi-ai";
import type {
  ThinkingLevel,
  AgentToolResult,
} from "@earendil-works/pi-agent-core";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";
import type { AgentConfig, AgentScope as AgentScopeType } from "./agents.ts";

export type AgentScope = AgentScopeType;

export const MAX_PARALLEL_TASKS = 8;
export const MAX_CONCURRENCY = 4;
export const COLLAPSED_ITEM_COUNT = 10;
export const PER_TASK_OUTPUT_CAP = 50 * 1024;

export const EXIT_CODE = {
  RUNNING: -1,
  SUCCESS: 0,
  FAILED: 1,
} as const;

export type ExitCodeValue = (typeof EXIT_CODE)[keyof typeof EXIT_CODE];

export type AgentSource = "user" | "project" | "unknown";

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export function createEmptyUsage(): UsageStats {
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

export interface SingleResult {
  agent: string;
  agentSource: AgentSource;
  task: string;
  exitCode: ExitCodeValue;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  step?: number;
  phase?:
    | "queued"
    | "starting"
    | "thinking"
    | "responding"
    | "tool"
    | "retrying"
    | "compacting"
    | "finishing"
    | "completed"
    | "failed"
    | "cancelled";
  startedAt?: number;
  lastActivityAt?: number;
  endedAt?: number;
  pid?: number;
  exitSignal?: string;
  activeTools?: Record<string, string>;
  manifestPath?: string;
  reportPath?: string;
  diagnosticsError?: string;
  malformedLines?: number;
}

export type AgentMode = "single" | "parallel" | "chain";

export interface SubagentDetails {
  mode: AgentMode;
  agentScope: AgentScope;
  projectAgentsDir: string | null;
  results: SingleResult[];
  totalSteps?: number;
}

const TaskItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({ description: "Task to delegate to the agent" }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the agent process" }),
  ),
});

const ChainItem = Type.Object({
  agent: Type.String({ description: "Name of the agent to invoke" }),
  task: Type.String({
    description: "Task with optional {previous} placeholder for prior output",
  }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for the agent process" }),
  ),
});

const AgentScopeSchema = StringEnum(["user", "project", "both"] as const, {
  description:
    'Which agent directories to use. Default: "user". Use "both" to include project-local agents.',
  default: "user",
});

export const SubagentParams = Type.Object({
  timeoutSeconds: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 86400,
      description:
        "Optional wall-clock limit per child, in seconds (1–86400). Default: no deadline; inactivity is displayed, not automatically killed.",
    }),
  ),
  agent: Type.Optional(
    Type.String({
      description: "Name of the agent to invoke (for single mode)",
    }),
  ),
  task: Type.Optional(
    Type.String({ description: "Task to delegate (for single mode)" }),
  ),
  tasks: Type.Optional(
    Type.Array(TaskItem, {
      description: "Array of {agent, task} for parallel execution",
    }),
  ),
  chain: Type.Optional(
    Type.Array(ChainItem, {
      description: "Array of {agent, task} for sequential execution",
    }),
  ),
  agentScope: Type.Optional(AgentScopeSchema),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({
      description: "Prompt before running project-local agents. Default: true.",
      default: true,
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory for the agent process (single mode)",
    }),
  ),
});

export type SubagentToolParams = Static<typeof SubagentParams>;

export type ChainParams = Omit<SubagentToolParams, "chain"> & {
  chain: NonNullable<SubagentToolParams["chain"]>;
};

export function isChain(params: SubagentToolParams): params is ChainParams {
  return Boolean(params.chain && params.chain.length > 0);
}

export type TasksParams = Omit<SubagentToolParams, "tasks"> & {
  tasks: NonNullable<SubagentToolParams["tasks"]>;
};

export function isTasks(params: SubagentToolParams): params is TasksParams {
  return Boolean(params.tasks && params.tasks.length > 0);
}

export type SingleTaskParams = Omit<SubagentToolParams, "task" | "agent"> & {
  task: NonNullable<SubagentToolParams["task"]>;
  agent: NonNullable<SubagentToolParams["agent"]>;
};

export function isSingleTask(
  params: SubagentToolParams,
): params is SingleTaskParams {
  return Boolean(params.agent && params.task);
}

export interface DispatchDefaults {
  model?: string;
  thinkingLevel?: ThinkingLevel;
}

export interface SubagentConfig {
  cwd: string;
  agentScope: AgentScope;
  dispatchDefaults: DispatchDefaults;
  agents: AgentConfig[];
  projectAgentsDir: string | null;
  availableModels: Model<Api>[];
  confirmProjectAgents: boolean;
  mode: AgentMode;
  requestedAgentNames: string[];
  totalSteps?: number;
  invocationId?: string;
  timeoutSeconds?: number;
}

export interface SubAgentToolContext {
  config: SubagentConfig;
  details: {
    make: (results: SingleResult[]) => SubagentDetails;
  };
}

export type OnUpdateCallback = (
  partial: AgentToolResult<SubagentDetails>,
) => void;
