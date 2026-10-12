import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { SingleResult, SubAgentToolContext } from "./types.ts";
import { getFinalOutput } from "./result.ts";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REPORT_BYTES = 1024 * 1024;
export const MAX_STDERR_CHARS = 16 * 1024;

export function defaultRunsDirectory(): string {
  return path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
    "pi",
    "subagents",
  );
}

/** Metadata and final reports only: no prompts, thinking, raw events or tool payloads. */
export class RunJournal {
  readonly manifestPath: string;
  readonly reportPath: string;

  constructor(
    root: string,
    private readonly context: SubAgentToolContext,
    private readonly cwd: string,
  ) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.chmodSync(root, 0o700);
    this.prune(root);
    const dir = fs.mkdtempSync(path.join(root, "run-"));
    fs.chmodSync(dir, 0o700);
    this.manifestPath = path.join(dir, "manifest.json");
    this.reportPath = path.join(dir, "report.md");
  }

  checkpoint(result: SingleResult): void {
    this.write(
      this.manifestPath,
      JSON.stringify(
        {
          version: 1,
          invocationId: this.context.config.invocationId,
          agent: result.agent,
          model: result.model,
          cwd: this.cwd,
          step: result.step,
          totalSteps: this.context.config.totalSteps,
          pid: result.pid,
          phase: result.phase,
          startedAt: result.startedAt,
          lastActivityAt: result.lastActivityAt,
          endedAt: result.endedAt,
          activeTools: Object.values(result.activeTools ?? {}),
          exitCode: result.exitCode,
          exitSignal: result.exitSignal,
          stopReason: result.stopReason,
          errorMessage: result.errorMessage,
          stderrTail: result.stderr.slice(-MAX_STDERR_CHARS),
          malformedLines: result.malformedLines ?? 0,
          usage: result.usage,
          reportPath: this.reportPath,
        },
        null,
        2,
      ),
    );
  }

  finish(result: SingleResult): void {
    const output = getFinalOutput(result.messages);
    const report = `# ${result.agent} — ${result.phase}\n\n${output || "No completed assistant output."}\n\n${result.errorMessage ? `Error: ${result.errorMessage}\n\n` : ""}Manifest: ${this.manifestPath}\n`;
    const bytes = Buffer.from(report);
    // Persist enough for real handoffs, while bounding retained repository data.
    this.write(
      this.reportPath,
      bytes.length <= MAX_REPORT_BYTES
        ? report
        : new StringDecoder("utf8").write(bytes.subarray(0, MAX_REPORT_BYTES)) +
            "\n[Report truncated at 1 MiB.]\n",
    );
    this.checkpoint(result);
  }

  private write(file: string, text: string): void {
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  private prune(root: string): void {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("run-")) continue;
      const dir = path.join(root, entry.name);
      try {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
        );
        if (
          typeof manifest.endedAt === "number" &&
          manifest.endedAt < Date.now() - RETENTION_MS
        ) {
          fs.rmSync(dir, { recursive: true });
        }
      } catch {
        // Never remove an active, interrupted, or unreadable run automatically.
      }
    }
  }
}
