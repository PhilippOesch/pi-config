import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverAgents, type AgentConfig } from "./agents.ts";

const makeAgentFile = (dir: string, name: string, content: string): string => {
  const filePath = path.join(dir, `${name}.md`);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
};

const validAgent = (extra = "") => `---
name: test-agent
description: A test agent
tools: read, bash
model: fallback/model
models:
  - preferred/model
  - fallback/model
requiresConfirmation: true
${extra}---
System prompt here.`;

describe("discoverAgents", () => {
  let tmpUserDir: string;
  let originalAgentDir: string | undefined;

  beforeEach(() => {
    tmpUserDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-test-"));
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = tmpUserDir;
  });

  afterEach(() => {
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
    fs.rmSync(tmpUserDir, { recursive: true, force: true });
  });

  it("parses a valid agent with all fields", () => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    makeAgentFile(agentsDir, "valid", validAgent());

    const { agents } = discoverAgents("/tmp", "user");
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject<Partial<AgentConfig>>({
      name: "test-agent",
      description: "A test agent",
      tools: ["read", "bash"],
      model: "fallback/model",
      models: ["preferred/model", "fallback/model"],
      requiresConfirmation: true,
      systemPrompt: "System prompt here.",
      source: "user",
    });
  });

  it("accepts tools as YAML list", () => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    makeAgentFile(
      agentsDir,
      "list-tools",
      `---
name: list-tools
description: list tools
tools:
  - read
  - bash
---
`,
    );

    const { agents } = discoverAgents("/tmp", "user");
    expect(agents[0]?.tools).toEqual(["read", "bash"]);
  });

  it("accepts models as bare scalar", () => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    makeAgentFile(
      agentsDir,
      "scalar-model",
      `---
name: scalar-model
description: scalar model
models: only/model
---
`,
    );

    const { agents } = discoverAgents("/tmp", "user");
    expect(agents[0]?.models).toEqual(["only/model"]);
  });

  it("does not split comma-string models", () => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    makeAgentFile(
      agentsDir,
      "comma-models",
      `---
name: comma-models
description: comma models
models: a, b
---
`,
    );

    const { agents } = discoverAgents("/tmp", "user");
    expect(agents[0]?.models).toEqual(["a, b"]);
  });

  it.each([
    ["true", true],
    ["yes", true],
    ["false", false],
    ["no", false],
    [undefined, false],
  ])("parses requiresConfirmation=%s as %s", (value, expected) => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    const extra = value === undefined ? "" : `requiresConfirmation: ${value}\n`;
    makeAgentFile(
      agentsDir,
      "confirm",
      `---
name: confirm
description: confirm
${extra}---
`,
    );

    const { agents } = discoverAgents("/tmp", "user");
    expect(agents[0]?.requiresConfirmation).toBe(expected);
  });

  it("skips files missing name or description", () => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    makeAgentFile(
      agentsDir,
      "no-name",
      `---
description: missing name
---
`,
    );
    makeAgentFile(agentsDir, "valid2", validAgent());

    const { agents } = discoverAgents("/tmp", "user");
    expect(agents.map((a) => a.name)).toEqual(["test-agent"]);
  });

  it("skips files with malformed YAML and still loads siblings", () => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    makeAgentFile(
      agentsDir,
      "broken",
      `---
name: broken
description: broken
  bad_indent: [
---
`,
    );
    makeAgentFile(agentsDir, "valid3", validAgent());

    const { agents } = discoverAgents("/tmp", "user");
    expect(agents.map((a) => a.name)).toEqual(["test-agent"]);
  });

  it("ignores non-markdown files", () => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    fs.writeFileSync(
      path.join(agentsDir, "not-agent.txt"),
      "---\nname: txt\n---\n",
    );
    makeAgentFile(agentsDir, "valid4", validAgent());

    const { agents } = discoverAgents("/tmp", "user");
    expect(agents.map((a) => a.name)).toEqual(["test-agent"]);
  });

  it("follows symlinked markdown files", () => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    const realFile = path.join(tmpUserDir, "real.md");
    fs.writeFileSync(realFile, validAgent());
    fs.symlinkSync(realFile, path.join(agentsDir, "linked.md"));

    const { agents } = discoverAgents("/tmp", "user");
    expect(agents.map((a) => a.name)).toEqual(["test-agent"]);
  });

  it("scope=user excludes project agents", () => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    makeAgentFile(agentsDir, "user-agent", validAgent());

    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "subagent-proj-"),
    );
    const projectAgentsDir = path.join(projectRoot, ".pi", "agents");
    fs.mkdirSync(projectAgentsDir, { recursive: true });
    makeAgentFile(
      projectAgentsDir,
      "project-agent",
      `---
name: project-agent
description: project
---
`,
    );

    const { agents, projectAgentsDir: foundDir } = discoverAgents(
      projectRoot,
      "user",
    );
    expect(foundDir).toBe(projectAgentsDir);
    expect(agents.map((a) => a.name)).toEqual(["test-agent"]);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it("scope=project with no project dir returns empty", () => {
    const { agents, projectAgentsDir } = discoverAgents("/tmp", "project");
    expect(agents).toEqual([]);
    expect(projectAgentsDir).toBeNull();
  });

  it("scope=both lets project win on name collision", () => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    makeAgentFile(
      agentsDir,
      "shared",
      `---
name: shared
description: user version
---
`,
    );

    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "subagent-proj2-"),
    );
    const projectAgentsDir = path.join(projectRoot, ".pi", "agents");
    fs.mkdirSync(projectAgentsDir, { recursive: true });
    makeAgentFile(
      projectAgentsDir,
      "shared",
      `---
name: shared
description: project version
---
`,
    );

    const { agents } = discoverAgents(projectRoot, "both");
    expect(agents).toHaveLength(1);
    expect(agents[0]?.description).toBe("project version");
    expect(agents[0]?.source).toBe("project");

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it("walks up to find .pi/agents from a nested cwd", () => {
    const projectRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "subagent-proj3-"),
    );
    const projectAgentsDir = path.join(projectRoot, ".pi", "agents");
    fs.mkdirSync(projectAgentsDir, { recursive: true });
    makeAgentFile(
      projectAgentsDir,
      "nested",
      `---
name: nested
description: nested
---
`,
    );

    const nestedCwd = path.join(projectRoot, "src", "deep");
    fs.mkdirSync(nestedCwd, { recursive: true });

    const { agents, projectAgentsDir: foundDir } = discoverAgents(
      nestedCwd,
      "project",
    );
    expect(foundDir).toBe(projectAgentsDir);
    expect(agents.map((a) => a.name)).toEqual(["nested"]);

    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
});
