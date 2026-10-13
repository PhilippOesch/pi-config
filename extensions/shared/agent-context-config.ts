import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface KnowledgeConfig {
  /** Root of the Obsidian vault that owns the agent context. */
  obsidianVaultPath: string;
  /** Folder where the agent may read and write generated notes. */
  agentContextPath: string;
  /** Map from note type to subfolder name inside agentContextPath. */
  folders: Record<string, string>;
  /** Naming convention for new note files. */
  naming: string;
  /** Required frontmatter keys for agent-generated notes. */
  frontmatter: string[];
}

export interface PiMpMyAgentConfig {
  knowledge: KnowledgeConfig;
}

export const defaultFolders = {
  inbox: "00-inbox",
  plan: "10-plans",
  research: "20-research",
  reference: "30-reference",
  handoff: "40-handoff",
  archive: "99-archive",
};

export const defaultFrontmatter = [
  "id",
  "type",
  "audience",
  "status",
  "created",
  "tags",
  "source",
];

export const defaultConfig: PiMpMyAgentConfig = {
  knowledge: {
    obsidianVaultPath: "",
    agentContextPath: "",
    folders: { ...defaultFolders },
    naming: "timestamp-slug",
    frontmatter: [...defaultFrontmatter],
  },
};

export const configDir = join(homedir(), ".config", "pi-mp-my-agent");
export const configPath = join(configDir, "config.json");

export async function readConfig(): Promise<PiMpMyAgentConfig | null> {
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as PiMpMyAgentConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(config: PiMpMyAgentConfig): Promise<void> {
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
