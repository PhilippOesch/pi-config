import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SUBAGENT_ENV_MARKER,
  buildAwarenessSection,
  buildSpawnEnv,
  isSubagentProcess,
} from "./awareness.ts";

const makeAgentFile = (dir: string, name: string, content: string): void => {
  fs.writeFileSync(path.join(dir, `${name}.md`), content, "utf-8");
};

const agentFile = (name: string, description: string) => `---
name: ${name}
description: ${description}
---
System prompt here.`;

describe("buildAwarenessSection", () => {
  let tmpUserDir: string;
  let originalAgentDir: string | undefined;

  beforeEach(() => {
    tmpUserDir = fs.mkdtempSync(path.join(os.tmpdir(), "awareness-test-"));
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

  it("lists discovered agents with source and description", () => {
    const agentsDir = path.join(tmpUserDir, "agents");
    fs.mkdirSync(agentsDir);
    makeAgentFile(agentsDir, "writer", agentFile("writer", "Writes prose"));

    const section = buildAwarenessSection("/tmp");

    expect(section).toContain("Delegate to these with the subagent tool:");
    expect(section).toContain("- writer (user): Writes prose");
  });

  it("returns undefined when no agents exist", () => {
    expect(buildAwarenessSection("/tmp")).toBeUndefined();
  });
});

describe("isSubagentProcess", () => {
  it("is false without the marker and true with it", () => {
    expect(isSubagentProcess({})).toBe(false);
    expect(isSubagentProcess({ [SUBAGENT_ENV_MARKER]: "1" })).toBe(true);
  });
});

describe("buildSpawnEnv", () => {
  it("adds the marker without dropping existing variables", () => {
    const env = buildSpawnEnv({ PATH: "/bin" });

    expect(env[SUBAGENT_ENV_MARKER]).toBe("1");
    expect(env.PATH).toBe("/bin");
  });
});
