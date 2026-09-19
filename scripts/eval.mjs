#!/usr/bin/env node
/**
 * Real-world eval runner for jev-browse.
 *
 *   node scripts/eval.mjs                     # all tasks, one run each
 *   node scripts/eval.mjs --repeat 3          # median-of-N per task
 *   node scripts/eval.mjs --tasks hn-comments,flights-zurich-london
 *   node scripts/eval.mjs --label baseline    # tag the results file
 *   node scripts/eval.mjs --compare a.json b.json
 *
 * Each run spawns src/cli.ts, parses the RunResult on stdout, and verifies
 * the outcome against the task's URL expectations — DONE is a claim, not
 * proof. Results (per-step latencies included) land in evals/results/.
 *
 * Env: repo .env, merged over the current environment.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const RESULTS_DIR = join(ROOT, "evals", "results");

const TASK_TIMEOUT_MS = 120_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnvFile(path, env) {
  if (!existsSync(path)) return env;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

    if (!m || line.trim().startsWith("#")) continue;

    if (env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }

  return env;
}

function parseArgs(argv) {
  const args = { repeat: 1, label: null, tasks: null, compare: null };

  for (let i = 0; i < argv.length; i++) {
    const val = () => argv[++i];

    switch (argv[i]) {
      case "--repeat": args.repeat = Number(val()); break;
      case "--label": args.label = val(); break;
      case "--tasks": args.tasks = val().split(","); break;
      case "--engine": args.engine = val(); break;
      case "--compare": args.compare = [val(), val()]; i++; break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }

  return args;
}

const VERIFIABLE_KEYS = ["status", "url_match", "url_not_match", "text_match", "action_match"];

// A task with no runnable expectation can't be verified — reported
// "unverifiable", not silently counted as a pass.
const isVerifiable = (task) => VERIFIABLE_KEYS.some((k) => task.expect?.[k] !== undefined);

function verify(task, result, opsText) {
  const url = result.final_url ?? "";
  const exp = task.expect ?? {};

  if (exp.status) {
    // Expected non-done outcome — e.g. "blocked" is the honest answer when a
    // page binds interactivity with no DOM signal to offer.
    if (result.status !== exp.status) return false;
  } else if (result.status !== "done") {
    return false;
  }

  if (exp.url_match && !new RegExp(exp.url_match).test(url)) return false;

  if (exp.url_not_match && new RegExp(exp.url_not_match).test(url)) return false;

  if (exp.text_match && !new RegExp(exp.text_match).test(result.final_text ?? "")) return false;

  if (exp.action_match && !new RegExp(exp.action_match).test(opsText)) return false;

  return true;
}

function runOnce(task, env, engine) {
  return new Promise((resolvePromise) => {
    const url = task.file_url ? `file://${join(ROOT, task.url)}` : task.url;
    // Fresh profile per run: cookies and SPA sessions persist in the shared
    // profile, which makes anonymous-state tasks non-deterministic (a logged-in
    // ParaBank page has no login form to fill).
    const profile = mkdtempSync(join(tmpdir(), "jev-eval-"));
    // Both driver env vars point at the same fresh dir; each engine reads its
    // own (JEV_PROFILE for cdp, JEV_AB_PROFILE for agent-browser).
    const childEnv = { ...env, JEV_PROFILE: profile, JEV_AB_PROFILE: profile };

    if (task.file_url) childEnv.JEV_ALLOW_FILE_URLS = "1";

    const cli = spawn(
      process.execPath,
      [
        join(ROOT, "src", "cli.ts"),
        "--url", url,
        "--goal", task.goal,
        ...(engine ? ["--engine", engine] : []),
        ...(task.file_url ? ["--allow-file-urls"] : []),
      ],
      { cwd: ROOT, env: childEnv },
    );

    let stdout = "";
    let stderr = "";
    cli.stdout.on("data", (d) => (stdout += d));
    cli.stderr.on("data", (d) => (stderr += d));

    const killer = setTimeout(() => cli.kill("SIGKILL"), TASK_TIMEOUT_MS);
    cli.on("exit", () => {
      clearTimeout(killer);
      let result = null;

      try { result = JSON.parse(stdout.trim()); } catch {}

      if (!result) {
        resolvePromise({ status: "error", error: `no result (stderr tail: ${stderr.slice(-300)})`, steps: 0, decisions: 0, elapsed_ms: TASK_TIMEOUT_MS, history: [] });

        return;
      }

      const ops = (result.history ?? []).map((h) => `${h.operation}:${(h.action ?? "").slice(0, 30)}`);
      const jev_ms = (result.history ?? []).reduce((s, h) => s + (h.latency_ms || 0), 0);
      const text_ms = (result.history ?? []).reduce((s, h) => s + (h.text_latency_ms || 0), 0);

      // Error results drop history; stderr step events keep the run legible.
      const events = stderr
        .split("\n")
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter((e) => e?.type === "step")
        .map((e) => `${e.operation}:${(e.action ?? "").slice(0, 30)}@${e.elapsed_ms}`);

      resolvePromise({
        status: result.status,
        verified: isVerifiable(task) ? verify(task, result, ops.join(" ")) : "unverifiable",
        elapsed_ms: result.elapsed_ms,
        steps: result.steps,
        decisions: result.decisions,
        jev_ms,
        text_ms,
        final_url: result.final_url,
        error: result.error,
        ops,
        events,
      });
    });
  });
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);

  return s[Math.floor(s.length / 2)];
};

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.compare) {
    const [a, b] = args.compare.map((f) => JSON.parse(readFileSync(resolve(f), "utf8")));
    console.log(`\n${"task".padEnd(24)} ${(a.label ?? "A").padEnd(22)} ${b.label ?? "B"}`);

    for (const id of Object.keys(a.tasks)) {
      const ra = a.tasks[id], rb = b.tasks[id];

      if (!rb) continue;
      const cell = (r) => `${r.median_ms}ms ok:${r.verified}/${r.runs - (r.unverifiable ?? 0)}`;
      console.log(`${id.padEnd(24)} ${cell(ra).padEnd(22)} ${cell(rb)}`);
    }

    console.log(
      `\n${"TOTAL (median sum)".padEnd(24)} ${`${a.median_total_ms}ms`.padEnd(22)} ${b.median_total_ms}ms`,
    );

    return;
  }

  const all = JSON.parse(readFileSync(join(ROOT, "evals", "tasks.json"), "utf8"));
  const tasks = args.tasks ? all.filter((t) => args.tasks.includes(t.id)) : all;

  if (!tasks.length) throw new Error("No tasks selected");

  const env = { ...process.env };
  loadEnvFile(join(ROOT, ".env"), env);

  const report = { label: args.label, started: new Date().toISOString(), tasks: {} };
  mkdirSync(RESULTS_DIR, { recursive: true });

  for (const task of tasks) {
    const runs = [];

    for (let i = 0; i < args.repeat; i++) {
      const r = await runOnce(task, env, args.engine);
      runs.push(r);
      const verdict = r.verified === "unverifiable" ? "unverifiable" : r.verified ? "yes" : "NO";
      console.log(
        `${task.id.padEnd(24)} run ${i + 1}/${args.repeat}  ${String(r.status).padEnd(8)} verified:${verdict.padEnd(12)} ${String(r.elapsed_ms).padStart(6)}ms  steps:${r.steps} decisions:${r.decisions} jev:${r.jev_ms}ms txt:${r.text_ms}ms${r.error ? `  err:${r.error.slice(0, 80)}` : ""}`,
      );
      await sleep(500);
    }

    report.tasks[task.id] = {
      runs: runs.length,
      verified: runs.filter((r) => r.verified === true).length,
      unverifiable: runs.filter((r) => r.verified === "unverifiable").length,
      median_ms: median(runs.map((r) => r.elapsed_ms)),
      median_decisions: median(runs.map((r) => r.decisions)),
      median_jev_ms: median(runs.map((r) => r.jev_ms)),
      median_text_ms: median(runs.map((r) => r.text_ms)),
      detail: runs,
    };
  }

  report.median_total_ms = Object.values(report.tasks).reduce((s, t) => s + t.median_ms, 0);

  const totals = Object.values(report.tasks).reduce(
    (s, t) => ({
      verified: s.verified + t.verified,
      unverifiable: s.unverifiable + t.unverifiable,
      failed: s.failed + t.runs - t.verified - t.unverifiable,
    }),
    { verified: 0, unverifiable: 0, failed: 0 },
  );

  const name = `${args.label ?? "run"}-${Date.now()}.json`;
  writeFileSync(join(RESULTS_DIR, name), JSON.stringify(report, null, 2));
  console.log(
    `\nwrote evals/results/${name}  median total: ${report.median_total_ms}ms  verified:${totals.verified} unverifiable:${totals.unverifiable} failed:${totals.failed}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
