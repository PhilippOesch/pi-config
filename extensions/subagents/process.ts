import { spawn } from "node:child_process";
import { buildSpawnEnv } from "./awareness.ts";

export type ProcessEvent =
  | { type: "spawn"; pid: number }
  | { type: "stdout"; line: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number | null; signal?: string }
  | { type: "error"; error: Error };

export type SubagentProcessRequest = {
  command: string;
  args: string[];
  cwd: string;
  abortSignal?: AbortSignal;
};

export interface SubagentProcessAdapter {
  run(
    request: SubagentProcessRequest,
    onEvent: (event: ProcessEvent) => void,
  ): Promise<void>;
}

/** Owns only the launched process. Pi handles its tracked shell children on SIGTERM. */
export class SpawnSubagentProcessAdapter implements SubagentProcessAdapter {
  constructor(private readonly graceMs = 5000) {}

  async run(
    request: SubagentProcessRequest,
    onEvent: (event: ProcessEvent) => void,
  ): Promise<void> {
    if (request.abortSignal?.aborted) return;
    return new Promise<void>((resolve) => {
      const proc = spawn(request.command, request.args, {
        cwd: request.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: buildSpawnEnv(process.env),
      });
      let buffer = "";
      let settled = false;
      let terminating = false;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      let drainDeadline: ReturnType<typeof setTimeout> | undefined;

      const finish = (code: number | null, signal?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(escalation);
        clearTimeout(drainDeadline);
        request.abortSignal?.removeEventListener("abort", terminate);
        if (buffer.trim()) onEvent({ type: "stdout", line: buffer });
        onEvent({ type: "exit", code, signal });
        resolve();
      };
      const terminate = () => {
        if (settled || terminating) return;
        terminating = true;
        proc.kill("SIGTERM");
        escalation = setTimeout(() => {
          // A killed child can leave inherited pipes open in descendants.
          // Do not wait forever for close; bound draining after escalation.
          proc.kill("SIGKILL");
          drainDeadline = setTimeout(() => {
            onEvent({
              type: "stderr",
              data: "Subagent pipes did not close after termination; stopped waiting for output.\n",
            });
            proc.stdout.destroy();
            proc.stderr.destroy();
            finish(proc.exitCode, proc.signalCode ?? "SIGKILL");
          }, this.graceMs);
        }, this.graceMs);
      };

      // Decode across chunk boundaries, but keep LF-only JSONL framing.
      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");
      proc.stdout.on("data", (data: string) => {
        if (settled) return;
        buffer += data;
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) onEvent({ type: "stdout", line });
      });
      proc.stderr.on("data", (data: string) => {
        if (!settled) onEvent({ type: "stderr", data });
      });
      proc.on("spawn", () => {
        if (proc.pid) onEvent({ type: "spawn", pid: proc.pid });
      });
      proc.on("close", (code, signal) => finish(code, signal ?? undefined));
      proc.on("error", (error) => {
        onEvent({ type: "error", error });
        finish(1);
      });
      request.abortSignal?.addEventListener("abort", terminate, { once: true });
      if (request.abortSignal?.aborted) terminate();
    });
  }
}
