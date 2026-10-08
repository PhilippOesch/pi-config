import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCopilotInstructions } from "../shared/copilot-instructions.ts";

const instructionPaths = [
  "copilot-instructions.md",
  ".copilot-instructions.md",
  ".github/copilot-instructions.md",
  ".github/instructions/path-scoped.instructions.md",
];

describe("loadCopilotInstructions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-instructions-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads global and inherited Copilot instruction files in order", () => {
    const agentDir = path.join(tempDir, "agent");
    const projectDir = path.join(tempDir, "project");
    const nestedDir = path.join(projectDir, "src");
    const githubDir = path.join(projectDir, ".github");
    const scopedInstructionsDir = path.join(githubDir, "instructions");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.mkdirSync(scopedInstructionsDir, { recursive: true });

    fs.writeFileSync(
      path.join(agentDir, "copilot-instructions.md"),
      "Global instructions",
    );
    fs.writeFileSync(
      path.join(projectDir, ".copilot-instructions.md"),
      "Project dotfile instructions",
    );
    fs.writeFileSync(
      path.join(githubDir, "copilot-instructions.md"),
      "Project GitHub instructions",
    );
    fs.writeFileSync(
      path.join(scopedInstructionsDir, "path-scoped.instructions.md"),
      "---\ndescription: Path-scoped playbook\napplyTo: 'src/app/**'\n---\nFull scoped playbook",
    );
    fs.writeFileSync(
      path.join(nestedDir, "copilot-instructions.md"),
      "Nested instructions",
    );

    const instructions = loadCopilotInstructions(
      nestedDir,
      agentDir,
      instructionPaths,
    );

    expect(instructions).toContain("Global instructions");
    expect(instructions).toContain("Project dotfile instructions");
    expect(instructions).toContain("Project GitHub instructions");
    expect(instructions).toContain("Path-scoped playbook");
    expect(instructions).toContain("Applies to: src/app/**");
    expect(instructions).not.toContain("Full scoped playbook");
    expect(instructions).toContain("Nested instructions");
    expect(instructions!.indexOf("Global instructions")).toBeLessThan(
      instructions!.indexOf("Project dotfile instructions"),
    );
    expect(instructions!.indexOf("Project GitHub instructions")).toBeLessThan(
      instructions!.indexOf("Path-scoped playbook"),
    );
    expect(instructions!.indexOf("Path-scoped playbook")).toBeLessThan(
      instructions!.indexOf("Nested instructions"),
    );
  });

  it("returns undefined when no Copilot instructions are present", () => {
    const emptyDir = path.join(tempDir, "empty");
    fs.mkdirSync(emptyDir);

    expect(
      loadCopilotInstructions(
        emptyDir,
        path.join(tempDir, "agent"),
        instructionPaths,
      ),
    ).toBe(undefined);
  });
});
