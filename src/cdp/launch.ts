import { execSync, spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import { findChrome } from "./chrome.ts";
import { VIEWPORT_H, VIEWPORT_W } from "./input.ts";
import { browserWsUrl, freePort } from "./socket.ts";

export interface CdpOptions {
  cdpUrl?: string;
  headed?: boolean;
  profileDir?: string;
}

export interface Spawned {
  proc: ChildProcess;
  profileDir: string;
  port: number;
}

function splitShellWords(input: string): string[] {
  const out: string[] = [];

  let cur = "",
    quote: string | null = null,
    started = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote !== null) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === "\\" && i + 1 < input.length) {
      cur += input[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) {
        out.push(cur);
        cur = "";
        started = false;
      }
    } else {
      cur += ch;
      started = true;
    }
  }

  if (started || cur) out.push(cur);

  return out;
}

function reapProfileChrome(profileDir: string): boolean {
  try {
    const escaped = profileDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const out = execSync(`pgrep -f "user-data-dir=${escaped}([[:space:]]|$)"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    const pids = out.trim().split(/\s+/).filter(Boolean);

    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
      }
    }

    return pids.length > 0;
  } catch {
    return false;
  }
}

export async function spawnChrome(opts: CdpOptions): Promise<Spawned | null> {
  if (opts.cdpUrl) return null;

  const port = await freePort();

  const profileDir =
    opts.profileDir ?? process.env.JEV_PROFILE ?? join(homedir(), ".jev-browse", "profile");

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
  ];

  if (!opts.headed) args.push("--headless=new");
  else args.push(`--window-size=${VIEWPORT_W},${VIEWPORT_H + 120}`, "--window-position=40,40");

  if (process.getuid?.() === 0) {
    args.push("--no-sandbox");
    process.stderr.write(
      "jev-browse: running as root — Chrome launched with --no-sandbox, " +
        "renderer containment is off. Attach to a non-root Chrome via JEV_CDP_URL to keep it.\n",
    );
  }

  for (const extra of splitShellWords(process.env.JEV_CHROME_ARGS ?? "")) {
    args.push(extra);
  }

  const proc = spawn(findChrome(), [...args, "about:blank"], { stdio: "ignore" });
  proc.on("error", () => {});

  return { proc, profileDir, port };
}

export async function resolveWsUrl(opts: CdpOptions, spawned: Spawned | null): Promise<string> {
  if (opts.cdpUrl) {
    const base = opts.cdpUrl.replace(/\/+$/, "");

    const info = (await (await fetch(`${base}/json/version`)).json()) as {
      webSocketDebuggerUrl?: string;
    };

    if (!info.webSocketDebuggerUrl) {
      throw new Error(`${base} did not report a webSocketDebuggerUrl`);
    }

    return info.webSocketDebuggerUrl;
  }

  try {
    return await browserWsUrl(spawned!.port);
  } catch (error) {
    if (!spawned || !reapProfileChrome(spawned.profileDir)) throw error;

    const port = await freePort();

    const args2 = spawned.proc.spawnargs.map((a) =>
      a.startsWith("--remote-debugging-port=") ? `--remote-debugging-port=${port}` : a,
    );

    spawned.proc = spawn(args2[0], args2.slice(1), { stdio: "ignore" });
    spawned.proc.on("error", () => {});
    spawned.port = port;

    return browserWsUrl(port);
  }
}
