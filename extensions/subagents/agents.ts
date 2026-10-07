/**
 * Agent discovery and configuration
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  parseFrontmatter,
} from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "both";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  models?: string[];
  requiresConfirmation?: boolean;
  systemPrompt: string;
  source: "user" | "project";
  filePath: string;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  projectAgentsDir: string | null;
}

/**
 * Raw agent frontmatter. Values are `unknown` because `parseFrontmatter` runs a
 * real YAML parser, so any scalar or collection can appear here.
 *
 * A type alias rather than an interface: `parseFrontmatter` constrains its
 * parameter to `Record<string, unknown>`, and only an alias picks up the
 * implicit index signature that satisfies it.
 */
type AgentFrontmatter = {
  name?: unknown;
  description?: unknown;
  tools?: unknown;
  model?: unknown;
  models?: unknown;
  requiresConfirmation?: unknown;
};

/**
 * Normalize a frontmatter `tools` value to a list of tool names.
 *
 * Both spellings are valid YAML and both are in use:
 *
 *     tools: read, bash        # string
 *     tools: [read, bash]      # array
 *
 * so accept either. Anything else (a number, a map, a nested list) yields no
 * tools rather than throwing: this runs inside agent discovery, where a single
 * bad file must not take down every other agent in the same directory.
 */
function parseToolList(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const tools = raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : undefined;
}

/**
 * Normalize a frontmatter `models` value to a list of `provider/id` strings.
 *
 * Accepted forms:
 *
 *     models: [anthropic/claude-opus-4-5, openai/gpt-5]   # array
 *     models: anthropic/claude-sonnet-4-5                # bare scalar
 *
 * A bare scalar is wrapped as a single-entry list so users can declare a
 * preferred model with a single line. Comma-strings (`models: a, b`) are
 * deliberately not auto-split here — they parse as a single string and become
 * a one-element list, which surfaces the typo to the user instead of silently
 * coercing.
 *
 * Anything else (a number, a map, a nested list) yields no models rather than
 * throwing: this runs inside agent discovery, where a single bad file must
 * not take down every other agent in the same directory.
 */
/**
 * Normalize a frontmatter `requiresConfirmation` value to a boolean.
 *
 * Treats YAML truthy scalars (`true`, `yes`) as true; anything else defaults
 * to false.
 */
function parseRequiresConfirmation(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "yes") return true;
  }
  return false;
}

function parseModelList(value: unknown): string[] | undefined {
  let raw: unknown[];
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return [trimmed];
  } else {
    return undefined;
  }
  const models = raw
    .filter((m): m is string => typeof m === "string")
    .map((m) => m.trim())
    .filter(Boolean);
  return models.length > 0 ? models : undefined;
}

function loadAgentsFromDir(
  dir: string,
  source: "user" | "project",
): AgentConfig[] {
  const agents: AgentConfig[] = [];

  if (!fs.existsSync(dir)) {
    return agents;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return agents;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    let parsed: { frontmatter: AgentFrontmatter; body: string };
    try {
      parsed = parseFrontmatter<AgentFrontmatter>(content);
    } catch {
      continue;
    }
    const { frontmatter, body } = parsed;

    if (
      typeof frontmatter.name !== "string" ||
      typeof frontmatter.description !== "string"
    ) {
      continue;
    }

    agents.push({
      name: frontmatter.name,
      description: frontmatter.description,
      tools: parseToolList(frontmatter.tools),
      model:
        typeof frontmatter.model === "string" ? frontmatter.model : undefined,
      models: parseModelList(frontmatter.models),
      requiresConfirmation: parseRequiresConfirmation(
        frontmatter.requiresConfirmation,
      ),
      systemPrompt: body,
      source,
      filePath,
    });
  }

  return agents;
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findNearestProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, CONFIG_DIR_NAME, "agents");
    if (isDirectory(candidate)) return candidate;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

export function discoverAgents(
  cwd: string,
  scope: AgentScope,
): AgentDiscoveryResult {
  const userDir = path.join(getAgentDir(), "agents");
  const projectAgentsDir = findNearestProjectAgentsDir(cwd);

  const userAgents =
    scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
  const projectAgents =
    scope === "user" || !projectAgentsDir
      ? []
      : loadAgentsFromDir(projectAgentsDir, "project");

  const agentMap = new Map<string, AgentConfig>();

  if (scope === "both") {
    for (const agent of userAgents) agentMap.set(agent.name, agent);
    for (const agent of projectAgents) agentMap.set(agent.name, agent);
  } else if (scope === "user") {
    for (const agent of userAgents) agentMap.set(agent.name, agent);
  } else {
    for (const agent of projectAgents) agentMap.set(agent.name, agent);
  }

  return { agents: Array.from(agentMap.values()), projectAgentsDir };
}
