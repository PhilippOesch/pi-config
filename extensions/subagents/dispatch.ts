/**
 * SubagentDispatch - orchestrate a single subagent tool invocation.
 */

import type {
  AgentToolResult,
  AgentToolUpdateCallback,
} from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AgentConfig, type AgentScope, discoverAgents } from "./agents.ts";
import { isReadModeActive } from "../shared/utils.ts";
import { strategies } from "./agentStrategy.ts";
import { truncate } from "./format.ts";
import {
  type SingleResult,
  type SubAgentToolContext,
  type SugagentConfig,
  type SugagentToolParams,
} from "./types.ts";
import { classifyParams, type ValidationError } from "./validation.ts";

export type ConfirmationAdapter = {
  available: boolean;
  confirm(title: string, message: string): Promise<boolean>;
};

export type DispatchOutcome =
  | { outcome: "success"; result: AgentToolResult<unknown> }
  | {
      outcome: "blocked";
      context: SubAgentToolContext;
      text: string;
      terminate: boolean;
    }
  | { outcome: "invalid"; context: SubAgentToolContext; text: string }
  | { outcome: "strategyError"; context: SubAgentToolContext; text: string };

export class SubagentDispatch {
  constructor(
    private ctx: ExtensionContext,
    private params: SugagentToolParams,
    private signal: AbortSignal | undefined,
    private onUpdate: AgentToolUpdateCallback<unknown> | undefined,
    private confirmation: ConfirmationAdapter,
  ) {}

  async execute(): Promise<DispatchOutcome> {
    const config = this.processConfig();
    const subAgentContext = this.buildSubAgentContext(config);

    const classification = classifyParams(this.params);
    if (classification.kind === "invalid") {
      return {
        outcome: "invalid",
        context: subAgentContext,
        text: this.formatInvalidError(subAgentContext, classification.error),
      };
    }

    const privilegedBlock = await this.checkPrivilegedGate(subAgentContext);
    if (privilegedBlock) return privilegedBlock;

    const projectBlock = await this.checkProjectGate(subAgentContext);
    if (projectBlock) return projectBlock;

    const strategy = strategies[config.mode];
    if (!strategy) {
      return {
        outcome: "strategyError",
        context: subAgentContext,
        text: `Invalid parameters. Available agents: ${subAgentContext.config.agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none"}`,
      };
    }

    const result = await strategy(
      this.ctx,
      subAgentContext,
      classification,
      this.signal,
      this.onUpdate,
    );
    return { outcome: "success", result };
  }

  private processConfig(): SugagentConfig {
    const agentScope: AgentScope = this.params.agentScope ?? "user";
    const discovery = discoverAgents(this.ctx.cwd, agentScope);
    const dispatchDefaults = {
      model: this.ctx.model
        ? `${this.ctx.model.provider}/${this.ctx.model.id}`
        : undefined,
      thinkingLevel: this.ctx.thinkingLevel,
    };

    return {
      cwd: this.ctx.cwd,
      agentScope,
      dispatchDefaults,
      agents: discovery.agents,
      projectAgentsDir: discovery.projectAgentsDir,
      availableModels: this.ctx.modelRegistry.getAvailable(),
      confirmProjectAgents: this.params.confirmProjectAgents ?? true,
      mode: this.inferMode(this.params),
      requestedAgentNames: this.extractAgentNames(),
    };
  }

  private inferMode(params: SugagentToolParams) {
    const hasChain = (params.chain?.length ?? 0) > 0;
    const hasTasks = (params.tasks?.length ?? 0) > 0;
    return hasChain ? "chain" : hasTasks ? "parallel" : "single";
  }

  private buildSubAgentContext(config: SugagentConfig): SubAgentToolContext {
    return {
      config,
      details: {
        make: (results: SingleResult[]) => ({
          mode: config.mode,
          agentScope: config.agentScope,
          projectAgentsDir: config.projectAgentsDir,
          results,
        }),
      },
    };
  }

  private extractAgentNames(): string[] {
    const requestedAgentNames: string[] = [];
    if (this.params.chain)
      for (const step of this.params.chain)
        requestedAgentNames.push(step.agent);
    if (this.params.tasks)
      for (const t of this.params.tasks) requestedAgentNames.push(t.agent);
    if (this.params.agent) requestedAgentNames.push(this.params.agent);
    return requestedAgentNames;
  }

  private formatInvalidError(
    subAgentContext: SubAgentToolContext,
    error: ValidationError,
  ): string {
    switch (error.type) {
      case "invalidModeCount": {
        const available =
          subAgentContext.config.agents
            .map((a) => `${a.name} (${a.source})`)
            .join(", ") || "none";
        return `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`;
      }
    }
  }

  private async checkPrivilegedGate(
    subAgentContext: SubAgentToolContext,
  ): Promise<DispatchOutcome | null> {
    if (!isReadModeActive(this.ctx)) return null;

    const privilegedAgents = subAgentContext.config.requestedAgentNames
      .map((name) => subAgentContext.config.agents.find((a) => a.name === name))
      .filter((a): a is AgentConfig => a?.requiresConfirmation === true);

    if (privilegedAgents.length === 0) return null;

    if (!this.confirmation.available) {
      return {
        outcome: "blocked",
        context: subAgentContext,
        text: "Cannot request permission without a UI. The subagent was blocked because the session is in save mode.",
        terminate: true,
      };
    }

    const names = privilegedAgents.map((a) => a.name).join(", ");
    const preview =
      this.params.task ??
      this.params.tasks?.[0]?.task ??
      this.params.chain?.[0]?.task ??
      "";
    const shortPreview = truncate(preview, 120);
    const ok = await this.confirmation.confirm(
      "Run privileged subagent in save mode?",
      `Agents: ${names}\nTask preview: ${shortPreview || "(none)"}\n\nThis subagent can modify files. Approve?`,
    );
    if (!ok) {
      return {
        outcome: "blocked",
        context: subAgentContext,
        text: "Subagent blocked: the session is in save mode and the privileged subagent was not approved.",
        terminate: true,
      };
    }

    return null;
  }

  private async checkProjectGate(
    subAgentContext: SubAgentToolContext,
  ): Promise<DispatchOutcome | null> {
    if (!["project", "both"].includes(subAgentContext.config.agentScope))
      return null;
    if (!subAgentContext.config.confirmProjectAgents) return null;
    if (!this.confirmation.available) return null;

    const projectAgentsRequested = subAgentContext.config.requestedAgentNames
      .map((name) => subAgentContext.config.agents.find((a) => a.name === name))
      .filter((a): a is AgentConfig => a?.source === "project");

    if (projectAgentsRequested.length === 0) return null;

    const names = projectAgentsRequested.map((a) => a.name).join(", ");
    const dir = subAgentContext.config.projectAgentsDir ?? "(unknown)";
    const ok = await this.confirmation.confirm(
      "Run project-local agents?",
      `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
    );
    if (!ok) {
      return {
        outcome: "blocked",
        context: subAgentContext,
        text: "Canceled: project-local agents not approved.",
        terminate: false,
      };
    }

    return null;
  }
}
