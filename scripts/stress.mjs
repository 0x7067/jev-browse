#!/usr/bin/env node
/**
 * Machinery stress suite: runs evals/stress.json through src/cli.ts against a
 * local site and a scripted mock model. No API keys, no model variance —
 * what is measured is the browser driver, the snapshot extractor, the
 * freshness guards, the fuses, and the loop itself.
 *
 *   node scripts/stress.mjs                       # all tasks
 *   node scripts/stress.mjs --tasks big-dom,overlay
 *   node scripts/stress.mjs --repeat 3 --parallel 4
 *   node scripts/stress.mjs --latency 400         # simulate model round-trips
 *   node scripts/stress.mjs --label pre-fix
 *   node scripts/stress.mjs --cli bundled          # run the committed bundle instead of src/
 *
 * Verification mirrors scripts/eval.mjs (url_match, text_match, action_match,
 * status). Timing per task separates model time (mock latency) from
 * machinery time.
 */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { startMock } from "./stress/mock-model.mjs";
import { startSite } from "./stress/site.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const RESULTS_DIR = join(ROOT, "evals", "results");

const TASK_TIMEOUT_MS = 150_000;

function parseArgs(argv) {
  const args = { repeat: 1, parallel: 1, latency: 0, label: "stress", tasks: null, keep: false, cli: "src" };

  for (let i = 0; i < argv.length; i++) {
    const val = () => argv[++i];

    switch (argv[i]) {
      case "--repeat": args.repeat = Number(val()); break;
      case "--parallel": args.parallel = Number(val()); break;
      case "--latency": args.latency = Number(val()); break;
      case "--label": args.label = val(); break;
      case "--tasks": args.tasks = val().split(","); break;
      case "--keep": args.keep = true; break;
      case "--cli": args.cli = val(); break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }

  return args;
}

function verify(task, result, opsText) {
  const exp = task.expect ?? {};
  const url = result.final_url ?? "";

  if (exp.status ? result.status !== exp.status : result.status !== "done") return false;

  if (exp.url_match && !new RegExp(exp.url_match).test(url)) return false;

  if (exp.url_not_match && new RegExp(exp.url_not_match).test(url)) return false;

  if (exp.text_match && !new RegExp(exp.text_match).test(result.final_text ?? "")) return false;

  if (exp.action_match && !new RegExp(exp.action_match).test(opsText)) return false;

  return true;
}

function runOnce(task, env, origin, keep, entry) {
  return new Promise((resolvePromise) => {
    const profile = mkdtempSync(join(tmpdir(), "jev-stress-"));
    const childEnv = { ...env, JEV_PROFILE: profile };
    const started = performance.now();

    const cli = spawn(
      process.execPath,
      [
        entry === "bundled" ? join(ROOT, "bundled", "cli.mjs") : join(ROOT, "src", "cli.ts"),
        "--url", `${origin}${task.url}`,
        "--goal", task.goal,
        ...(task.max_steps ? ["--max-steps", String(task.max_steps)] : []),
      ],
      { cwd: ROOT, env: childEnv },
    );

    let stdout = "";
    let stderr = "";
    cli.stdout.on("data", (d) => (stdout += d));
    cli.stderr.on("data", (d) => (stderr += d));

    const killer = setTimeout(() => cli.kill("SIGKILL"), TASK_TIMEOUT_MS);

    cli.on("exit", (code) => {
      clearTimeout(killer);
      const wall_ms = Math.round(performance.now() - started);

      if (!keep) rmSync(profile, { recursive: true, force: true });

      let result = null;

      try {
        result = JSON.parse(stdout.trim());
      } catch {}

      const events = stderr
        .split("\n")
        .flatMap((l) => {
          try {
            return [JSON.parse(l)];
          } catch {
            return [];
          }
        });

      if (!result) {
        resolvePromise({
          status: "error",
          verified: false,
          error: `no result (exit ${code}; stderr tail: ${stderr.slice(-400)})`,
          elapsed_ms: wall_ms,
          wall_ms,
          steps: 0,
          decisions: 0,
          ops: [],
          events: events.map(summarizeEvent),
        });

        return;
      }

      const history = result.history ?? [];
      const ops = history.map((h) => `${h.operation}:${(h.action ?? "").slice(0, 30)}`);
      const model_ms = history.reduce((s, h) => s + (h.latency_ms || 0) + (h.text_latency_ms || 0), 0);

      resolvePromise({
        status: result.status,
        verified: verify(task, result, ops.join(" ")),
        error: result.error,
        elapsed_ms: result.elapsed_ms,
        wall_ms,
        model_ms,
        machinery_ms: Math.max(0, result.elapsed_ms - model_ms),
        steps: result.steps,
        decisions: result.decisions,
        stale: events.filter((e) => e.type === "stale").length,
        final_url: result.final_url,
        final_text_tail: (result.final_text ?? "").slice(-160),
        ops,
        events: events.map(summarizeEvent),
      });
    });
  });
}

const summarizeEvent = (e) =>
  `${e.type}:${e.operation ?? ""}:${(e.action ?? e.error ?? "").slice(0, 40)}@${e.elapsed_ms ?? ""}`;

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);

  return s[Math.floor(s.length / 2)];
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const all = JSON.parse(readFileSync(join(ROOT, "evals", "stress.json"), "utf8"));
  const tasks = args.tasks ? all.filter((t) => args.tasks.includes(t.id)) : all;

  if (!tasks.length) throw new Error("No tasks selected");

  const site = await startSite();
  const scripts = new Map(all.map((t) => [t.goal.trim(), { script: t.script, done_when: t.done_when }]));
  const mock = await startMock(scripts, { latencyMs: args.latency });
  const mockOrigin = `http://127.0.0.1:${mock.port}`;

  const env = {
    ...process.env,
    TYPESAFE_API_KEY: "mock",
    TYPESAFE_BASE_URL: mockOrigin,
    TEXT_MODEL_API_KEY: "mock",
    TEXT_MODEL_BASE_URL: `${mockOrigin}/v1`,
    TEXT_MODEL: "mock-text",
    TEXT_MODEL_REASONING: "none",
  };

  if (!env.CHROME_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH) {
    env.CHROME_PATH = join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium");
  }

  const report = {
    label: args.label,
    started: new Date().toISOString(),
    cli: args.cli,
    latency_ms: args.latency,
    parallel: args.parallel,
    tasks: {},
  };

  mkdirSync(RESULTS_DIR, { recursive: true });

  const queue = tasks.flatMap((task) => Array.from({ length: args.repeat }, (_, i) => ({ task, i })));
  const results = new Map(tasks.map((t) => [t.id, []]));
  const suiteStart = performance.now();

  const worker = async () => {
    for (;;) {
      const item = queue.shift();

      if (!item) return;
      const before = mock.calls.log.length;
      const r = await runOnce(item.task, env, site.origin, args.keep, args.cli);
      // Parallel runs interleave; keep this task's own decisions only.
      r.mock_log = mock.calls.log.slice(before).filter((l) => l.goal === item.task.goal.trim()).map((l) => `${l.op} (${l.note}) n=${l.elements}`);
      results.get(item.task.id).push(r);
      const verdict = r.verified ? "yes" : "NO";
      console.log(
        `${item.task.id.padEnd(24)} ${String(r.status).padEnd(8)} verified:${verdict.padEnd(4)} ${String(r.elapsed_ms).padStart(6)}ms (wall ${String(r.wall_ms).padStart(6)}ms) steps:${String(r.steps).padStart(2)} decisions:${String(r.decisions).padStart(2)} stale:${r.stale ?? 0}${r.error ? `  err:${r.error.slice(0, 100)}` : ""}`,
      );
    }
  };

  await Promise.all(Array.from({ length: args.parallel }, worker));

  const suite_wall_ms = Math.round(performance.now() - suiteStart);

  for (const task of tasks) {
    const runs = results.get(task.id);
    report.tasks[task.id] = {
      runs: runs.length,
      verified: runs.filter((r) => r.verified).length,
      median_ms: median(runs.map((r) => r.elapsed_ms)),
      median_wall_ms: median(runs.map((r) => r.wall_ms)),
      median_machinery_ms: median(runs.map((r) => r.machinery_ms ?? r.elapsed_ms)),
      median_steps: median(runs.map((r) => r.steps)),
      median_decisions: median(runs.map((r) => r.decisions)),
      detail: runs,
    };
  }

  const totals = Object.values(report.tasks).reduce(
    (s, t) => ({ verified: s.verified + t.verified, failed: s.failed + t.runs - t.verified }),
    { verified: 0, failed: 0 },
  );

  report.suite_wall_ms = suite_wall_ms;
  report.mock_calls = { decide: mock.calls.decide, text: mock.calls.text, unmatched: mock.calls.unmatched };
  report.median_total_ms = Object.values(report.tasks).reduce((s, t) => s + t.median_ms, 0);

  const name = `${args.label}-${Date.now()}.json`;
  writeFileSync(join(RESULTS_DIR, name), JSON.stringify(report, null, 2));

  const failed = Object.entries(report.tasks).filter(([, t]) => t.verified < t.runs).map(([id]) => id);
  console.log(
    `\nwrote evals/results/${name}  verified:${totals.verified} failed:${totals.failed}  median total:${report.median_total_ms}ms  suite wall:${suite_wall_ms}ms  mock decide:${mock.calls.decide} text:${mock.calls.text}${failed.length ? `\nfailed: ${failed.join(", ")}` : ""}`,
  );

  await mock.close();
  await site.close();
  process.exit(totals.failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
