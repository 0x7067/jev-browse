#!/usr/bin/env node

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
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DATE_TOKEN = /\{\{DATE\+(\d+)d\}\}/g;

function expandDates(text, now) {
  return text.replace(DATE_TOKEN, (_, days) => {
    const date = new Date(now);
    date.setDate(date.getDate() + Number(days));

    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  });
}

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

  const now = new Date();
  args.goals = args.goals.map((goal) => expandDates(goal, now));

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

    const cli = spawn(
      process.execPath,
      [
        join(ROOT, "src", "cli.ts"),
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
    await sleep(700);
    await cast.stop();
    chrome.kill("SIGKILL");

    let result = null;

    try { result = JSON.parse(stdout.trim()); } catch {}

    if (!frameIndex) throw new Error("Screencast captured zero frames");

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
      goals: args.goals,
      mp4,
      gif,
      result: result
        ? {
            status: result.status,
            steps: result.steps,
            decisions: result.decisions,
            elapsed_ms: result.elapsed_ms,
            final_url: result.final_url,
            error: result.error,
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
