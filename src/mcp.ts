#!/usr/bin/env node
/**
 * Minimal stdio MCP server exposing one tool: jev_browse.
 *
 * Newline-delimited JSON-RPC 2.0 — enough for Claude Code / OpenCode / Codex
 * mcp config to spawn `node dist/mcp.js` without another dependency.
 * Engine selection per call via the `engine` arg. `JEV_CDP_URL` (env only,
 * never a tool argument) attaches the cdp engine to an existing browser.
 *
 * Calls are serialized: two browser runs in one process would collide on the
 * shared profile and interleave progress on stderr.
 */

import { createInterface } from "node:readline";

import { runOnce } from "./cli.ts";
import { loadDotEnv } from "./env.ts";

const PROTOCOL_VERSION = "2024-11-05";
const ALLOWED_ARGS = new Set(["goal", "url", "engine", "max_steps"]);

const TOOL = {
  name: "jev_browse",
  description:
    "Drive a real browser autonomously toward a goal. TypeSafe Jev picks each operation and target " +
    "from the live page; a small helper model writes text for fields. Returns the final status, URL, " +
    "and action history. Prefer this over step-by-step browsing when a task is a bounded web goal " +
    "(search, filter, navigate, fill a form). The agent stops itself when done or blocked. There is " +
    "no purchase/credential guardrail — scope goals accordingly and verify the outcome independently; " +
    "the agent's DONE claim is not proof.",
  inputSchema: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description:
          "One natural-language goal, e.g. 'Find one-way flights Zurich to London on Sep 20 2026 and stop when results are visible.'",
      },
      url: {
        type: "string",
        description:
          "Starting page URL (http/https). Pick the site the goal is about — the agent navigates in-page, it cannot type in the address bar.",
      },
      engine: {
        type: "string",
        enum: ["cdp", "agent-browser"],
        description:
          "Browser backend. cdp launches/attaches Chrome directly; agent-browser uses the agent-browser CLI session.",
      },
      max_steps: {
        type: "number",
        description: "Action budget, default 60.",
      },
    },
    required: ["goal", "url"],
    additionalProperties: false,
  },
};

function respond(id: unknown, result: unknown): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function respondError(id: unknown, code: number, message: string): void {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

function toolResult(id: unknown, text: string, isError = false): void {
  respond(id, { content: [{ type: "text", text }], isError });
}

// Serialize tool calls: one browser run at a time per server process.
let queue: Promise<void> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function callJevBrowse(id: unknown, args: Record<string, unknown>): Promise<void> {
  const unknown = Object.keys(args).filter((k) => !ALLOWED_ARGS.has(k));
  if (unknown.length) {
    respondError(id, -32602, `jev_browse: unknown arguments: ${unknown.join(", ")}`);
    return;
  }
  if (typeof args.goal !== "string" || typeof args.url !== "string") {
    respondError(id, -32602, "jev_browse requires { goal: string, url: string }");
    return;
  }
  try {
    const result = await runOnce(
      {
        url: args.url,
        goals: [args.goal],
        engine: args.engine === "agent-browser" ? "agent-browser" : "cdp",
        headed: false,
        cdpUrl: process.env.JEV_CDP_URL,
        maxSteps: typeof args.max_steps === "number" ? args.max_steps : undefined,
      },
      (event) =>
        process.stderr.write(JSON.stringify({ call: id, ...event }) + "\n"),
    );
    toolResult(id, JSON.stringify(result), result.status === "error");
  } catch (error) {
    toolResult(
      id,
      `jev_browse failed before completing: ${error instanceof Error ? error.message : error}`,
      true,
    );
  }
}

async function handle(request: { id?: unknown; method?: string; params?: any }): Promise<void> {
  const { id, method, params } = request;
  switch (method) {
    case "initialize":
      respond(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "jev-browse", version: "0.1.0" },
      });
      return;
    case "notifications/initialized":
    case "initialized":
      return;
    case "ping":
      respond(id, {});
      return;
    case "tools/list":
      respond(id, { tools: [TOOL] });
      return;
    case "tools/call": {
      if (params?.name !== "jev_browse") {
        respondError(id, -32602, `Unknown tool: ${params?.name}`);
        return;
      }
      await enqueue(() => callJevBrowse(id, params?.arguments ?? {}));
      return;
    }
    default:
      if (id !== undefined) respondError(id, -32601, `Method not found: ${method}`);
  }
}

loadDotEnv();
const rl = createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let request: { id?: unknown; method?: string; params?: any };
  try {
    request = JSON.parse(line);
  } catch {
    respondError(null, -32700, "Parse error");
    return;
  }
  handle(request).catch((error) =>
    respondError(request.id ?? null, -32603, error instanceof Error ? error.message : String(error)),
  );
});
