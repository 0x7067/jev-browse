#!/usr/bin/env node
/**
 * Record a jev-browse run as a real-time video.
 *
 * Launches its own Chrome on a fixed debug port, attaches the jev-browse CLI
 * to it with --cdp, captures the agent's tab via Page.startScreencast on a
 * second CDP connection, then assembles docs/demo.mp4 and docs/demo.gif with
 * ffmpeg. Frame timing comes from CDP metadata timestamps, so playback is 1×.
 *
 *   node scripts/record_demo.mjs --url URL --goal "..." [--out docs] [--name demo]
 *
 * Env: repo .env first, then ~/.jev-browse/install/.env as fallback — the CLI
 * child gets the merged result without touching the user's shell env.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const args = { goals: [], out: join(ROOT, "docs"), name: "demo", maxSteps: 60 };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const val = () => argv[++i];

    switch (arg) {
      case "--url": args.url = val(); break;
      case "--goal": args.goals.push(val()); break;
      case "--out": args.out = val(); break;
      case "--name": args.name = val(); break;
      case "--max-steps": args.maxSteps = Number(val()); break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.url || !args.goals.length) {
    throw new Error("Usage: record_demo.mjs --url URL --goal GOAL [--goal ...] [--out dir] [--name demo]");
  }

  return args;
}

function loadEnvFile(path, env) {
  if (!existsSync(path)) return env;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

    if (!m || line.trim().startsWith("#")) continue;

    if (env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }

  return env;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);

  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("Chrome not found — set CHROME_PATH");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      const res = await fetch(url);

      if (res.ok) return await res.json();
    } catch {}

    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}`);
    await sleep(100);
  }
}

/** Attach to a page target and yield each screencast frame until stop() is called. */
async function screencast(wsUrl, onFrame) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  let id = 0;
  const pending = new Map();

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

  let stopped = false;
  ws.addEventListener("close", () => {
    // The agent closes its tab on exit — a dead socket must not hang stop().
    for (const p of pending.values()) p.reject(new Error("CDP connection closed"));
    pending.clear();
  });
  ws.addEventListener("message", async (event) => {
    const msg = JSON.parse(String(event.data));

    if (msg.id !== undefined) {
      const p = pending.get(msg.id);

      if (p) {
        pending.delete(msg.id);

        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result ?? {});
      }

      return;
    }

    if (msg.method === "Page.screencastFrame") {
      const { data, metadata, sessionId } = msg.params;
      await onFrame(data, metadata);
      // Ack last — falling behind is better than dropping frames.
      send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    }
  });

  await send("Page.enable");
  await send("Page.startScreencast", {
    format: "jpeg",
    quality: 85,
    maxWidth: 1120,
    maxHeight: 780,
    everyNthFrame: 1,
  });

  return {
    async stop() {
      if (stopped) return;
      stopped = true;
      await Promise.race([
        send("Page.stopScreencast").catch(() => {}),
        sleep(2000),
      ]);
      ws.close();
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = { ...process.env };
  loadEnvFile(join(homedir(), ".jev-browse", "install", ".env"), env);
  loadEnvFile(join(ROOT, ".env"), env);

  const work = mkdtempSync(join(tmpdir(), "jev-demo-"));
  const framesDir = join(work, "frames");
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(args.out, { recursive: true });

  const port = await freePort();

  const chrome = spawn(
    findChrome(),
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${join(work, "profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--headless=new",
      "--window-size=1120,900",
      "--hide-crash-restore-bubble",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  chrome.on("error", () => {});

  const cleanup = async () => {
    try { chrome.kill("SIGKILL"); } catch {}

    rmSync(work, { recursive: true, force: true });
  };

  try {
    await waitHttp(`http://127.0.0.1:${port}/json/version`);

    const initial = new Set(
      (await waitHttp(`http://127.0.0.1:${port}/json/list`))
        .filter((t) => t.type === "page")
        .map((t) => t.id),
    );

    // Run the agent attached to our Chrome.
    const cli = spawn(
      process.execPath,
      [
        join(ROOT, "dist", "cli.js"),
        "--url", args.url,
        ...args.goals.flatMap((g) => ["--goal", g]),
        "--engine", "cdp",
        "--cdp", `http://127.0.0.1:${port}`,
        "--max-steps", String(args.maxSteps),
      ],
      { cwd: ROOT, env },
    );

    const eventsStream = (await import("node:fs")).createWriteStream(join(work, "events.jsonl"));
    let stdout = "";
    cli.stdout.on("data", (d) => (stdout += d));
    cli.stderr.pipe(eventsStream);
    cli.stderr.pipe(process.stderr);

    const cliDone = new Promise((res) => cli.on("exit", res));

    // Wait for the tab the agent creates (it is not in the initial set).
    let cast = null;
    let t0 = null;
    let frameIndex = 0;
    const stamps = [];
    const deadline = Date.now() + 30000;

    while (!cast && Date.now() < deadline) {
      const list = await waitHttp(`http://127.0.0.1:${port}/json/list`).catch(() => []);
      const target = (list ?? []).find((t) => t.type === "page" && !initial.has(t.id));

      if (target) {
        cast = await screencast(target.webSocketDebuggerUrl, async (data, metadata) => {
          const ts = metadata?.timestamp ?? Date.now() / 1000;

          if (t0 === null) t0 = ts;
          stamps.push(ts);
          // Persist incrementally — a crash must not lose frame timing.
          writeFileSync(join(framesDir, "stamps.json"), JSON.stringify(stamps));
          writeFileSync(
            join(framesDir, `f_${String(++frameIndex).padStart(6, "0")}.jpg`),
            Buffer.from(data, "base64"),
          );
        });
        break;
      }

      await sleep(50);
    }

    if (!cast) throw new Error("Never saw the agent's tab appear on CDP");

    const exitCode = await cliDone;
    await sleep(700); // let the final state emit a last frame
    await cast.stop();
    chrome.kill("SIGKILL");

    let result = null;

    try { result = JSON.parse(stdout.trim()); } catch {}

    if (!frameIndex) throw new Error("Screencast captured zero frames");

    // Assemble at 1× from CDP frame timestamps; ~0.8 s hold on the last frame.
    const rel = stamps.map((t) => Math.max(0, t - t0));

    const concat = rel
      .map((t, i) => {
        const next = i + 1 < rel.length ? rel[i + 1] : t + 0.8;
        const dur = Math.max(0.016, next - t);

        return `file frames/f_${String(i + 1).padStart(6, "0")}.jpg\nduration ${dur.toFixed(3)}`;
      })
      .join("\n");

    const concatPath = join(work, "frames.txt");
    writeFileSync(concatPath, concat + `\nfile frames/f_${String(frameIndex).padStart(6, "0")}.jpg\n`);

    const mp4 = join(args.out, `${args.name}.mp4`);
    const gif = join(args.out, `${args.name}.gif`);

    const ffmpeg = (argv) =>
      new Promise((res, rej) => {
        const p = spawn("ffmpeg", argv, { stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        p.stderr.on("data", (d) => (err += d));
        p.on("exit", (c) => (c === 0 ? res() : rej(new Error(err.slice(-2000)))));
      });

    await ffmpeg([
      "-y", "-f", "concat", "-safe", "0", "-i", concatPath,
      "-vf", "scale=1120:-2", "-pix_fmt", "yuv420p",
      "-movflags", "+faststart", mp4,
    ]);
    await ffmpeg([
      "-y", "-i", mp4,
      "-vf", "fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
      gif,
    ]);

    const durationS = rel.length ? rel[rel.length - 1] + 0.8 : 0;
    console.log(JSON.stringify({
      ok: true,
      exitCode,
      frames: frameIndex,
      video_seconds: Number(durationS.toFixed(2)),
      mp4,
      gif,
      result: result
        ? {
            status: result.status,
            steps: result.steps,
            decisions: result.decisions,
            elapsed_ms: result.elapsed_ms,
            final_url: result.final_url,
          }
        : { raw_stdout_tail: stdout.slice(-500) },
    }, null, 2));

    await cleanup();
  } catch (error) {
    await cleanup();
    throw error;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
