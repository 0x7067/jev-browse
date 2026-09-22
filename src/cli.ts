#!/usr/bin/env node

import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { Agent, type RunResult } from "./agent.ts";
import { CdpBrowser } from "./cdp/browser.ts";
import { AgentBrowser } from "./abrowser.ts";
import { loadDotEnv } from "./env.ts";
import { sleep } from "./sleep.ts";
import type { BrowserDriver, JsonValue } from "./types.ts";

const lockDir = (profileDir: string) => {
  const key = createHash("sha1").update(profileDir).digest("hex").slice(0, 12);

  return join(homedir(), ".jev-browse", `run-${key}.lock`);
};

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

let heldLock: string | null = null;

async function acquireLock(profileDir: string, timeoutMs = 30_000): Promise<void> {
  const dir = lockDir(profileDir);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "pid"), String(process.pid), { flag: "wx" });
      heldLock = dir;

      return;
    } catch {
      const holder = Number(readFileSync(join(dir, "pid"), "utf8"));

      if (holder && !pidAlive(holder)) {
        rmSync(join(dir, "pid"), { force: true });
        continue;
      }

      if (Date.now() > deadline) {
        throw new Error(`Another jev-browse run (pid ${holder}) holds the browser profile`);
      }

      await sleep(1000);
    }
  }
}

function releaseLock(): void {
  if (!heldLock) return;

  try {
    const holder = Number(readFileSync(join(heldLock, "pid"), "utf8"));

    if (holder === process.pid) rmSync(heldLock, { recursive: true, force: true });
  } catch {
  }

  heldLock = null;
}

export interface CliArgs {
  url?: string;
  goals: string[];
  engine: "cdp" | "agent-browser";
  headed: boolean;
  cdpUrl?: string;
  maxSteps?: number;
  allowFileUrls?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { goals: [], engine: "cdp", headed: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];

    switch (arg) {
      case "--url":
        args.url = next();
        break;
      case "--goal":
        args.goals.push(next()!);
        break;
      case "--engine":
        args.engine = next() as CliArgs["engine"];
        break;
      case "--headed":
        args.headed = true;
        break;
      case "--cdp":
        args.cdpUrl = next();
        break;
      case "--max-steps":
        args.maxSteps = Number(next());
        break;
      case "--allow-file-urls":
        args.allowFileUrls = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.url || !args.goals.length || !["cdp", "agent-browser"].includes(args.engine)) {
    throw new Error(
      "Usage: jev-browse --url URL --goal GOAL [--goal ...] [--engine cdp|agent-browser] [--headed] [--cdp http://host:9222] [--max-steps N] [--allow-file-urls]",
    );
  }

  return args;
}

export function makeDriver(args: CliArgs): (url: string) => Promise<BrowserDriver> {
  if (args.engine === "agent-browser") {
    return (url) =>
      AgentBrowser.open(url, { launchArgs: args.headed ? ["--headed"] : [] });
  }

  return (url) => CdpBrowser.open(url, { cdpUrl: args.cdpUrl, headed: args.headed });
}

export async function runAgent(
  args: CliArgs,
  opts: {
    onEvent?: (event: { type: string; [k: string]: JsonValue }) => void;
    signal?: AbortSignal;
  } = {},
): Promise<RunResult> {
  const protocol = new URL(args.url!).protocol;
  const allowFile = args.allowFileUrls || process.env.JEV_ALLOW_FILE_URLS === "1";

  if (
    protocol !== "http:" &&
    protocol !== "https:" &&
    !(protocol === "file:" && allowFile)
  ) {
    throw new Error(`jev-browse only drives http(s) pages; got ${args.url}`);
  }

  const profileDir =
    args.engine === "agent-browser"
      ? (process.env.JEV_AB_PROFILE ?? join(homedir(), ".jev-browse", "agent-browser-profile"))
      : (process.env.JEV_PROFILE ?? join(homedir(), ".jev-browse", "profile"));

  await acquireLock(profileDir);
  let agent: Agent;

  try {
    agent = await Agent.start({
      url: args.url!,
      goal: args.goals,
      open: makeDriver(args),
      maxSteps: args.maxSteps,
    });
  } catch (error) {
    releaseLock();
    throw error;
  }

  const onAbort = () => void agent.close().catch(() => {});
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    return await agent.run(opts.onEvent);
  } catch (error) {
    const snap = agent.snapshot();

    opts.onEvent?.({
      type: "fatal",
      error: error instanceof Error ? error.message : String(error),
      url: snap.page?.url,
      title: snap.page?.title,
      elements: snap.elements.length,
      recent_actions: snap.history.slice(-5).map((h) => ({
        operation: h.operation,
        action: h.action,
        page_changed: h.page_changed,
      })),
    });

    throw error;
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    await agent.close();
    releaseLock();
  }
}

export async function runOnce(
  args: CliArgs,
  onEvent?: (event: { type: string; [k: string]: JsonValue }) => void,
): Promise<RunResult> {
  const controller = new AbortController();

  const onSignal = (signal: "SIGTERM" | "SIGINT") => {
    const timeout = setTimeout(
      () => process.exit(128 + (signal === "SIGTERM" ? 15 : 2)),
      3000,
    );

    timeout.unref();
    controller.abort();
    void result
      .catch(() => {})
      .finally(() => process.exit(128 + (signal === "SIGTERM" ? 15 : 2)));
  };

  const onSigterm = () => onSignal("SIGTERM");
  const onSigint = () => onSignal("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);
  const result = runAgent(args, { onEvent, signal: controller.signal });

  try {
    return await result;
  } finally {
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  try {
    const result = await runOnce(args, (event) =>
      process.stderr.write(JSON.stringify(event) + "\n"),
    );

    process.stdout.write(JSON.stringify(result) + "\n");

    if (result.status !== "done") process.exitCode = 2;
  } catch (error) {
    const result: RunResult = {
      status: "error",
      goal: args.goals.join("\n"),
      url: args.url ?? "",
      final_url: "",
      steps: 0,
      decisions: 0,
      elapsed_ms: 0,
      history: [],
      error: error instanceof Error ? error.message : String(error),
    };

    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? realpathSync(process.argv[1]) : "";

const invokedAsScript =
  /cli\.(ts|js|mjs)$/.test(entryPath) && fileURLToPath(import.meta.url) === entryPath;

if (invokedAsScript) await main();
