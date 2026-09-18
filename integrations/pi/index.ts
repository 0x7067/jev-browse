// Pi extension adapter for jev-drive. Registers a `jev_browse` tool that runs
// the Jev driver loop (src/cli.ts, via Node's native type stripping) as a
// subprocess and streams its step events back as tool-call updates.
//
// Requires `npm install` in the drive/ directory once (for @typesafe-ai/sdk)
// and Node >=22.18. Register this file by absolute path in
// ~/.pi/agent/settings.json extensions.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

const CLI = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL("../..", import.meta.url));

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "jev_browse",
    label: "Jev Browse",
    description:
      "Drive a real browser autonomously toward one goal. TypeSafe Jev picks each operation " +
      "and target from the live page (a helper LLM writes field text for TYPE_TEXT). Returns " +
      "final status, URL, and the action history. Prefer this over step-by-step agent_browser " +
      "use for bounded web goals — search, filter, navigate, fill a form.",
    promptSnippet: "Drive a browser toward a bounded goal with Jev as the decision model",
    promptGuidelines: [
      "Use jev_browse for self-contained web tasks with a clear done condition; keep step-by-step agent_browser for exploratory or interactive work.",
      "Give jev_browse a starting url on the target site — the driver navigates in-page and cannot reach the address bar.",
    ],
    parameters: Type.Object({
      goal: Type.String({ description: "One natural-language goal with an explicit stop condition." }),
      url: Type.String({ description: "Starting page URL on the target site." }),
      engine: Type.Optional(
        StringEnum(["cdp", "agent-browser"] as const, {
          description: "Browser backend. cdp launches/attaches Chrome directly (default).",
        }),
      ),
      max_steps: Type.Optional(Type.Number({ description: "Action budget, default 60." })),
    }),
    async execute(toolCallId, params, signal, onUpdate) {
      if (!existsSync(CLI)) {
        return {
          content: [
            {
              type: "text",
              text: `jev-drive deps are missing. Run: cd ${PACKAGE_DIR} && npm install`,
            },
          ],
          details: { built: false },
        };
      }
      const argv = [CLI, "--url", params.url, "--goal", params.goal];
      if (params.engine) argv.push("--engine", params.engine);
      if (params.max_steps) argv.push("--max-steps", String(params.max_steps));

      return await new Promise((resolve) => {
        const child = spawn(process.execPath, argv, { cwd: PACKAGE_DIR });
        let stdout = "";
        let stderrBuf = "";
        const onData = (chunk: Buffer) => {
          stderrBuf += chunk.toString();
          let nl: number;
          while ((nl = stderrBuf.indexOf("\n")) >= 0) {
            const line = stderrBuf.slice(0, nl).trim();
            stderrBuf = stderrBuf.slice(nl + 1);
            if (!line) continue;
            try {
              const event = JSON.parse(line);
              onUpdate?.({
                content: [
                  {
                    type: "text",
                    text: `${event.elapsed_ms ?? "?"}ms ${event.operation ?? event.type} ${event.action ?? ""} — ${event.url ?? ""}`.trim(),
                  },
                ],
                details: {},
              });
            } catch {
              onUpdate?.({ content: [{ type: "text", text: line.slice(0, 300) }], details: {} });
            }
          }
        };
        child.stdout!.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr!.on("data", onData);
        signal?.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
        child.on("close", (code) => {
          let result: { status?: string; error?: string } | null = null;
          try {
            result = JSON.parse(stdout.trim().split("\n").pop() ?? "");
          } catch {
            // fall through
          }
          if (result && result.status !== "error") {
            resolve({
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              details: result,
            });
            return;
          }
          // Throw so the call is marked as a tool error, not a prose result.
          resolve(
            Promise.reject(
              new Error(
                result?.error ?? `jev-drive exited ${code}: ${stderrBuf.slice(-800)}`,
              ),
            ),
          );
        });
      });
    },
  });
}
