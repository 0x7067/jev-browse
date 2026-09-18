#!/usr/bin/env node
/**
 * Headless entry point. Every harness adapter ultimately runs this:
 *
 *   node dist/cli.js --url URL --goal "a narrow goal" [--engine cdp|agent-browser]
 *
 * Progress events stream to stderr as JSONL; the final RunResult is the only
 * stdout payload, so callers can pipe stdout without scraping progress.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { Agent, type RunResult } from "./agent.ts";
import { loadDotEnv } from "./env.ts";
import { CdpBrowser } from "./cdp.ts";
import { AgentBrowser } from "./abrowser.ts";
import type { BrowserDriver } from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Two runs sharing a profile dir collide on Chrome's SingletonLock — one wins,
// the other hangs on a debug port that never binds. A pid lock dir fails fast.
const LOCK_DIR = join(homedir(), ".jev-drive", "run.lock");

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireLock(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      mkdirSync(LOCK_DIR, { recursive: true });
      writeFileSync(join(LOCK_DIR, "pid"), String(process.pid), { flag: "wx" });
      return;
    } catch {
      const holder = Number(readFileSync(join(LOCK_DIR, "pid"), "utf8"));
      if (holder && !pidAlive(holder)) {
        rmSync(join(LOCK_DIR, "pid"), { force: true });
        continue; // stale lock from a dead process
      }
      if (Date.now() > deadline) {
        throw new Error(`Another jev-drive run (pid ${holder}) holds the browser profile`);
      }
      await sleep(1000);
    }
  }
}

function releaseLock(): void {
  try {
    const holder = Number(readFileSync(join(LOCK_DIR, "pid"), "utf8"));
    if (holder === process.pid) rmSync(LOCK_DIR, { recursive: true, force: true });
  } catch {
    // never ours
  }
}

interface CliArgs {
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
      "Usage: jev-drive --url URL --goal GOAL [--goal ...] [--engine cdp|agent-browser] [--headed] [--cdp http://host:9222] [--max-steps N] [--allow-file-urls]",
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

export async function runOnce(
  args: CliArgs,
  onEvent?: (event: { type: string; [k: string]: unknown }) => void,
): Promise<RunResult> {
  // Scheme allowlist: page text flows to external model APIs, so file:// and
  // chrome:// are exfiltration paths, not just navigation. file:// needs an
  // explicit opt-in (tests/fixtures); everything else is refused.
  const protocol = new URL(args.url!).protocol;
  const allowFile = args.allowFileUrls || process.env.JEV_ALLOW_FILE_URLS === "1";
  if (
    protocol !== "http:" &&
    protocol !== "https:" &&
    !(protocol === "file:" && allowFile)
  ) {
    throw new Error(`jev-drive only drives http(s) pages; got ${args.url}`);
  }
  await acquireLock();
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
  // An external kill must still close the browser — Node's default SIGTERM
  // disposition skips finally blocks entirely. Bound the cleanup so a hung
  // close can't wedge the exit itself.
  const onSignal = (signal: "SIGTERM" | "SIGINT") => {
    const timeout = setTimeout(() => process.exit(128 + (signal === "SIGTERM" ? 15 : 2)), 3000);
    timeout.unref();
    void agent
      .close()
      .catch(() => {})
      .finally(() => {
        releaseLock();
        process.exit(128 + (signal === "SIGTERM" ? 15 : 2));
      });
  };
  const onSigterm = () => onSignal("SIGTERM");
  const onSigint = () => onSignal("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);
  try {
    return await agent.run(onEvent);
  } finally {
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    await agent.close();
    releaseLock();
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

const invokedAsScript = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedAsScript) await main();
