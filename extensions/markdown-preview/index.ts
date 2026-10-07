/**
 * Markdown Preview Extension for pi
 *
 * Registers the `preview_markdown` tool. The agent can call it with a file path,
 * and the tool renders the Markdown to a self-contained HTML page and opens it in
 * the user's default browser.
 *
 * Usage:
 *   Ask the agent: "Preview README.md in the browser."
 *   The agent will call preview_markdown({ path: "README.md" }).
 *
 * Requirements:
 *   - Run `npm install` in this extension directory so `marked` is available.
 *   - The extension must be loaded by pi (global extensions are auto-discovered from
 *     `~/.pi/agent/extensions/`). Use `/reload` in pi if it was added while running.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { marked } from "marked";
import { Type } from "typebox";

function wrapHtml(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #24292f;
  --muted: #57606a;
  --border: #d0d7de;
  --code-bg: #f6f8fa;
  --link: #0969da;
  --accent: #8250df;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --fg: #c9d1d9;
    --muted: #8b949e;
    --border: #30363d;
    --code-bg: #161b22;
    --link: #58a6ff;
    --accent: #a371f7;
  }
}
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  line-height: 1.6;
  color: var(--fg);
  background: var(--bg);
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
}
h1, h2, h3, h4, h5, h6 { margin-top: 1.5rem; margin-bottom: 1rem; font-weight: 600; line-height: 1.25; }
h1 { border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
h2 { border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  background: var(--code-bg);
  border-radius: 6px;
}
code { padding: 0.2em 0.4em; font-size: 85%; }
pre { padding: 1rem; overflow-x: auto; }
pre code { padding: 0; background: transparent; }
blockquote {
  margin: 0;
  padding: 0 1rem;
  color: var(--muted);
  border-left: 0.25rem solid var(--border);
}
ul, ol { padding-left: 2rem; }
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1rem 0;
}
th, td {
  border: 1px solid var(--border);
  padding: 0.4rem 0.8rem;
}
th { background: var(--code-bg); font-weight: 600; }
img { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid var(--border); margin: 1.5rem 0; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getPlatformOpenCommand(process: NodeJS.Process): string {
  if (process.platform == "win32") {
    return "start";
  }
  if (process.platform == "darwin") {
    return "open";
  }
  return "xdg-open";
}

async function openBrowser(filePath: string): Promise<void> {
  const command = getPlatformOpenCommand(process);
  return new Promise((resolve, reject) => {
    const child = spawn(command, [filePath], {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "preview_markdown",
    label: "Preview Markdown",
    description:
      "Render a Markdown file to HTML and open it in the default web browser.",
    parameters: Type.Object({
      path: Type.String({
        description:
          "Path to the Markdown file to preview. Relative paths are resolved against the current working directory.",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const inputPath = resolve(ctx.cwd, params.path);
      let markdown: string;
      try {
        markdown = await readFile(inputPath, "utf-8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Could not read Markdown file "${inputPath}": ${message}`,
        );
      }

      const bodyHtml = await marked.parse(markdown, { gfm: true });
      const html = wrapHtml(basename(inputPath), bodyHtml);

      const tempDir = await mkdtemp(join(tmpdir(), "pi-markdown-preview-"));
      const outputPath = join(tempDir, `${basename(inputPath, ".md")}.html`);
      await writeFile(outputPath, html, "utf-8");

      try {
        await openBrowser(outputPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Rendered HTML to "${outputPath}", but could not open the browser: ${message}`,
        );
      }

      return {
        content: [{ type: "text", text: `Preview opened: ${outputPath}` }],
        details: { htmlPath: outputPath },
      };
    },
  });
}
