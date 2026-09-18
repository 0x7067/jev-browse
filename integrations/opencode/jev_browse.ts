/**
 * OpenCode custom tool: jev_browse, by spawning the jev-drive CLI.
 *
 * Install: SYMLINK this file into ~/.config/opencode/tools/jev_browse.ts
 * (or <project>/.opencode/tools/) so the relative ../../src/cli.ts path keeps
 * resolving into the drive package. If you copy instead of symlink, you MUST
 * also set JEV_DRIVE_CLI to the absolute path of src/cli.ts.
 * Requires `npm install` in drive/ once and Node >=22.18 (type stripping).
 *
 * MCP config is an alternative (see drive/README.md) — this file is for setups
 * that prefer a native OpenCode tool over an MCP server.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { tool } from "@opencode-ai/plugin";

const CLI =
  process.env.JEV_DRIVE_CLI ?? fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

export default tool({
  description:
    "Drive a real browser autonomously toward one goal. TypeSafe Jev picks each operation " +
    "and target from the live page; a small helper model writes field text. Returns final " +
    "status, URL, and action history. Prefer this for bounded web goals over step-by-step browsing.",
  args: {
    goal: tool.schema.string().describe("One natural-language goal with an explicit stop condition."),
    url: tool.schema.string().describe("Starting http(s) URL on the target site."),
    engine: tool.schema.enum(["cdp", "agent-browser"]).optional(),
    max_steps: tool.schema.number().optional(),
  },
  async execute(args, context) {
    const argv = [CLI, "--url", args.url, "--goal", args.goal];
    if (args.engine) argv.push("--engine", args.engine);
    if (args.max_steps) argv.push("--max-steps", String(args.max_steps));
    return await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, argv);
      let stdout = "";
      let stderr = "";
      // Cancel the browser run with the tool call, same as the pi adapter.
      context?.abort?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("close", (code) => {
        const last = stdout.trim().split("\n").pop() ?? "";
        resolve(last || `jev-drive exited ${code}: ${stderr.slice(-800)}`);
      });
    });
  },
});
