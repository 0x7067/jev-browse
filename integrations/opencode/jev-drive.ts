/**
 * OpenCode plugin: exposes the jev_browse tool by spawning the jev-drive CLI.
 *
 * Install: `node <drive>/scripts/install.mjs opencode` writes a stub into
 * ~/.config/opencode/plugin/ that re-exports this file, so repo updates flow.
 * Requires `npm install` in drive/ once and Node >=22.18 (type stripping).
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";

const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));

const JevDrivePlugin: Plugin = async () => ({
  tool: {
    jev_browse: tool({
      description:
        "Drive a real browser autonomously toward one goal. TypeSafe Jev picks each " +
        "operation and target from the live page; a small helper model writes field " +
        "text. Returns final status, URL, and action history. Prefer this for bounded " +
        "web goals over step-by-step browsing.",
      args: {
        goal: tool.schema
          .string()
          .describe("One natural-language goal with an explicit stop condition."),
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
          // Cancel the browser run with the tool call.
          context?.abort?.addEventListener("abort", () => child.kill("SIGTERM"), {
            once: true,
          });
          child.stdout.on("data", (d) => (stdout += d.toString()));
          child.stderr.on("data", (d) => (stderr += d.toString()));
          child.on("close", (code) => {
            const last = stdout.trim().split("\n").pop() ?? "";
            resolve(last || `jev-drive exited ${code}: ${stderr.slice(-800)}`);
          });
        });
      },
    }),
  },
});

export default JevDrivePlugin;
