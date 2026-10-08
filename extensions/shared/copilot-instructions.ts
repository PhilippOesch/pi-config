import * as fs from "node:fs";
import * as path from "node:path";

type InstructionFile = { path: string; content: string };

function canonicalPath(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function ancestorDirectories(directory: string): string[] {
  const directories: string[] = [];
  let current = path.resolve(directory);

  while (true) {
    directories.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) return directories;
    current = parent;
  }
}

function getFrontmatterValue(content: string, key: string): string | undefined {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return undefined;

  const line = frontmatter[1]
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${key}:`));
  if (!line) return undefined;

  const value = line.slice(key.length + 1).trim();
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    return value.slice(1, -1).trim();
  }
  return value || undefined;
}

function formatInstruction(file: InstructionFile): string {
  const applyTo = getFrontmatterValue(file.content, "applyTo");
  if (!applyTo) return `### ${file.path}\n\n${file.content}`;

  const description = getFrontmatterValue(file.content, "description");
  return [
    `### Scoped Copilot instructions: ${file.path}`,
    description,
    `Applies to: ${applyTo}`,
    `Read ${file.path} before editing files matching its applyTo paths.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function loadFromDirectory(
  directory: string,
  instructionPaths: readonly string[],
): InstructionFile[] {
  const files: InstructionFile[] = [];

  for (const instructionPath of instructionPaths) {
    const filePath = path.resolve(directory, instructionPath);
    try {
      if (!fs.statSync(filePath).isFile()) continue;
      const content = fs.readFileSync(filePath, "utf-8").trim();
      if (content) files.push({ path: filePath, content });
    } catch {
      // Missing or unreadable optional instruction files do not block startup.
    }
  }

  return files;
}

/** Load configured Copilot instruction paths from the agent dir and cwd ancestors. */
export function loadCopilotInstructions(
  cwd: string,
  agentDir: string,
  instructionPaths: readonly string[],
): string | undefined {
  const directories = [agentDir, ...ancestorDirectories(cwd)];
  const seenDirectories = new Set<string>();
  const seenFiles = new Set<string>();
  const files: InstructionFile[] = [];

  for (const directory of directories) {
    const canonicalDirectory = canonicalPath(directory);
    if (seenDirectories.has(canonicalDirectory)) continue;
    seenDirectories.add(canonicalDirectory);

    for (const file of loadFromDirectory(directory, instructionPaths)) {
      const canonicalFile = canonicalPath(file.path);
      if (seenFiles.has(canonicalFile)) continue;
      seenFiles.add(canonicalFile);
      files.push(file);
    }
  }

  if (files.length === 0) return undefined;

  return files.map(formatInstruction).join("\n\n");
}
