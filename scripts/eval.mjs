#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cliEntryPath } from "./lib/cli-entry.mjs";
import { expandDates } from "./lib/dates.mjs";
import { loadEnvFile } from "./lib/env.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const RESULTS_DIR = join(ROOT, "evals", "results");

const TASK_TIMEOUT_MS = 120_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HELP = `Usage: node scripts/eval.mjs [options]

  --file tasks.json       Task file under evals/ (default: tasks.json)
  --tasks id1,id2         Run only these task ids
  --trace                 Save per-run observations, model input, targets, and CDP timing
  --repeat N              Median-of-N runs per task (default: 1)
  --retry N               Rerun a failed run up to N times (default: 0)
  --label NAME            Tag the results file
  --engine cdp|agent-browser  Browser engine (default: cli default)
  --compare a.json b.json Compare two result files
  --help                  Show this help

Results land in evals/results/. Exit code is non-zero when any run fails verification.
`;

function parseArgs(argv) {
  const args = { repeat: 1, retry: 0, label: null, tasks: null, compare: null, file: "tasks.json" };

  for (let i = 0; i < argv.length; i++) {
    const val = () => argv[++i];

    switch (argv[i]) {
      case "--help":
      case "-h":
        args.help = true;
        break;
      case "--trace": args.trace = true; break;
      case "--repeat": args.repeat = Number(val()); break;
      case "--retry": args.retry = Number(val()); break;
      case "--label": args.label = val(); break;
      case "--tasks": args.tasks = val().split(","); break;
      case "--engine": args.engine = val(); break;
      case "--file": args.file = val(); break;
      case "--compare": args.compare = [val(), val()]; i++; break;
      default: throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }

  return args;
}

const VERIFIABLE_KEYS = ["status", "url_match", "url_not_match", "text_match", "state_match", "action_match", "answer_match", "download_match", "frames_match", "challenge_match", "action_not_match"];

const isVerifiable = (task) => VERIFIABLE_KEYS.some((k) => task.expect?.[k] !== undefined);

const clip = (v, n = 160) => String(v ?? "").replace(/\s+/g, " ").slice(0, n);

function verify(task, result, opsText) {
  const url = result.final_url ?? "";
  const exp = task.expect ?? {};
  const fail = (clause, pattern, actual) => ({ ok: false, clause, pattern: String(pattern), actual: clip(actual) });

  if (exp.status) {
    if (result.status !== exp.status) return fail("status", exp.status, result.status);
  } else if (result.status !== "done") {
    return fail("status", "done", `${result.status}${result.blocked_cause ? `/${result.blocked_cause}` : ""}${result.error ? `: ${result.error}` : ""}`);
  }

  if (exp.url_match && !new RegExp(exp.url_match).test(url)) return fail("url_match", exp.url_match, url);

  if (exp.url_not_match && new RegExp(exp.url_not_match).test(url)) return fail("url_not_match", exp.url_not_match, url);

  const text = (result.final_text ?? "").replace(/\s+/g, " ");

  if (exp.text_match && !new RegExp(exp.text_match).test(text)) return fail("text_match", exp.text_match, text);

  const state = (result.final_state ?? "").replace(/\s+/g, " ");

  if (exp.state_match && !new RegExp(exp.state_match).test(state)) return fail("state_match", exp.state_match, state);

  if (exp.action_match && !new RegExp(exp.action_match).test(opsText)) return fail("action_match", exp.action_match, opsText);

  if (exp.answer_match !== undefined && !new RegExp(exp.answer_match).test(result.answer ?? "")) {
    return fail("answer_match", exp.answer_match, result.answer ?? `(no answer — ${result.answer_note ?? "reason unrecorded"})`);
  }

  if (exp.download_match !== undefined && !(result.downloads ?? []).some((f) => new RegExp(exp.download_match).test(f))) {
    return fail("download_match", exp.download_match, (result.downloads ?? []).join(", "));
  }

  if (exp.frames_match && !new RegExp(exp.frames_match).test(JSON.stringify(result.final_frames ?? []))) {
    return fail("frames_match", exp.frames_match, JSON.stringify(result.final_frames ?? []));
  }

  if (exp.challenge_match && !new RegExp(exp.challenge_match).test(JSON.stringify(result.challenge_reasons ?? []))) {
    return fail("challenge_match", exp.challenge_match, JSON.stringify(result.challenge_reasons ?? []));
  }

  if (exp.action_not_match && new RegExp(exp.action_not_match).test(opsText)) {
    return fail("action_not_match", exp.action_not_match, opsText);
  }

  return { ok: true };
}

function verdictFields(task, result, ops) {
  if (!isVerifiable(task)) return { verified: "unverifiable" };

  const v = verify(task, result, ops.join(" "));

  return v.ok ? { verified: true } : { verified: false, why: { clause: v.clause, pattern: v.pattern, actual: v.actual } };
}

function runOnce(task, env, engine, traceEnabled) {
  return new Promise((resolvePromise) => {
    const url = task.file_url ? `file://${join(ROOT, task.url)}` : task.url;
    const profile = mkdtempSync(join(tmpdir(), "jev-eval-"));
    const traceFile = traceEnabled ? join(RESULTS_DIR, `trace-${randomUUID()}.jsonl`) : undefined;
    const childEnv = { ...env, JEV_PROFILE: profile, JEV_AB_PROFILE: profile };

    if (task.file_url) childEnv.JEV_ALLOW_FILE_URLS = "1";

    const cli = spawn(
      process.execPath,
      [
        cliEntryPath(ROOT),
        "--url", url,
        "--goal", expandDates(task.goal, new Date()),
        ...(task.completion ? ["--expect", JSON.stringify(task.completion)] : []),
        ...(traceFile ? ["--trace", traceFile] : []),
        ...(task.max_steps ? ["--max-steps", String(task.max_steps)] : []),
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
      rmSync(profile, { recursive: true, force: true });

      if (traceFile) {
        writeFileSync(traceFile + ".stdout", stdout, { mode: 0o600 });
        writeFileSync(traceFile + ".stderr", stderr, { mode: 0o600 });
      }

      let result = null;

      try { result = JSON.parse(stdout.trim()); } catch {}

      if (!result) {
        resolvePromise({ trace_file: traceFile, status: "error", error: `no result (stderr tail: ${stderr.slice(-300)})`, steps: 0, decisions: 0, elapsed_ms: TASK_TIMEOUT_MS, history: [] });

        return;
      }

      const ops = (result.history ?? []).map((h) =>
        `${h.operation}:${(`${h.action ?? ""}${h.text ? ` "${h.text}"` : ""}`).slice(0, 80)}`);

      const jev_ms = (result.history ?? []).reduce((s, h) => s + (h.latency_ms || 0), 0);
      const text_ms = (result.history ?? []).reduce((s, h) => s + (h.text_latency_ms || 0), 0);

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

      const trail = (result.history ?? []).map((h) => ({
        op: h.operation,
        action: (h.action ?? "").slice(0, 60),
        text: h.text,
        changed: h.page_changed,
        follow_up: h.follow_up,
        jev_ms: h.latency_ms,
        text_ms: h.text_latency_ms,
        at_ms: h.elapsed_ms,
      }));

      const stale = stderr.split('"type":"stale"').length - 1;

      const decisionEvents = stderr
        .split("\n")
        .map((l) => { try { return JSON.parse(l); } catch { return null; } })
        .filter((e) => e?.type === "decision" || e?.type === "done_consult");

      const offered = decisionEvents.filter((e) => e.type === "decision");

      const space = offered.length
        ? {
            max_elements: Math.max(...offered.map((e) => e.offered_elements)),
            max_controls: Math.max(...offered.map((e) => e.offered_controls)),
            repaired: offered.filter((e) => e.repaired).length,
          }
        : null;

      resolvePromise({
        trace_file: traceFile,
        status: result.status,
        ...verdictFields(task, result, ops),
        stale,
        trail,
        final_text: (result.final_text ?? "").slice(0, 1200),
        final_state: (result.final_state ?? "").slice(0, 1200),
        final_frames: result.final_frames,
        challenge_reasons: result.challenge_reasons,
        answer_note: result.answer_note,
        elapsed_ms: result.elapsed_ms,
        steps: result.steps,
        decisions: result.decisions,
        jev_ms,
        text_ms,
        final_url: result.final_url,
        answer: result.answer,
        downloads: result.downloads,
        error: result.error,
        blocked_cause: result.blocked_cause,
        ops,
        events,
        space,
        done_consults: decisionEvents.filter((e) => e.type === "done_consult").length,
        completion_ms: decisionEvents.reduce((total, e) => total + (e.type === "done_consult" ? e.latency_ms ?? 0 : 0), 0),
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

  if (args.help) {
    console.log(HELP.trimEnd());

    return;
  }

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

  const all = JSON.parse(readFileSync(join(ROOT, "evals", args.file), "utf8"));
  const tasks = args.tasks ? all.filter((t) => args.tasks.includes(t.id)) : all;

  if (!tasks.length) throw new Error("No tasks selected");

  const env = { ...process.env };
  loadEnvFile(join(ROOT, ".env"), env);

  const report = { label: args.label, started: new Date().toISOString(), tasks: {} };
  mkdirSync(RESULTS_DIR, { recursive: true });

  const isInfra = (r) =>
    (r.status === "error" && (r.steps ?? 0) === 0) || /TypeSafe API credits/.test(r.error ?? "");

  for (const task of tasks) {
    const runs = [];

    for (let i = 0; i < args.repeat; i++) {
      let r = await runOnce(task, env, args.engine, args.trace);
      let attempts = 1;

      while (r.verified === false && attempts <= args.retry) {
        console.log(
          `${task.id.padEnd(24)} retry ${attempts}/${args.retry} after ${r.status} verified:NO`,
        );

        attempts++;
        await sleep(500);
        r = await runOnce(task, env, args.engine, args.trace);
      }

      r.attempts = attempts;
      r.retried = attempts > 1;
      runs.push(r);
      const verdict = r.verified === "unverifiable" ? "unverifiable" : r.verified ? "yes" : "NO";
      console.log(
        `${task.id.padEnd(24)} run ${i + 1}/${args.repeat}  ${String(r.status).padEnd(8)} verified:${verdict.padEnd(12)} ${String(r.elapsed_ms).padStart(6)}ms  steps:${r.steps} decisions:${r.decisions} jev:${r.jev_ms}ms txt:${r.text_ms}ms${r.retried ? " (after retry)" : ""}${r.error ? `  err:${r.error.slice(0, 80)}` : ""}${r.why ? `\n${" ".repeat(26)}↳ ${r.why.clause} want:${JSON.stringify(r.why.pattern)} got:${JSON.stringify(r.why.actual.slice(0, 90))}` : ""}`,
      );
      await sleep(500);
    }

    const passed = runs.filter((r) => r.verified === true).length;
    const unverifiable = runs.filter((r) => r.verified === "unverifiable").length;
    const flaky = runs.filter((r) => r.verified === true && r.retried).length;
    const infra = runs.filter((r) => r.verified === false && isInfra(r)).length;

    report.tasks[task.id] = {
      runs: runs.length,
      verified: passed,
      unverifiable,
      flaky,
      infra_errors: infra,
      median_ms: median(runs.map((r) => r.elapsed_ms)),
      median_decisions: median(runs.map((r) => r.decisions)),
      median_jev_ms: median(runs.map((r) => r.jev_ms)),
      median_text_ms: median(runs.map((r) => r.text_ms)),
      why: runs.find((r) => r.why && !isInfra(r))?.why ?? null,
      detail: runs,
    };
  }

  report.median_total_ms = Object.values(report.tasks).reduce((s, t) => s + t.median_ms, 0);

  const totals = Object.values(report.tasks).reduce(
    (s, t) => ({
      verified: s.verified + t.verified,
      unverifiable: s.unverifiable + t.unverifiable,
      flaky: s.flaky + (t.flaky ?? 0),
      infra_errors: s.infra_errors + (t.infra_errors ?? 0),
      failed: s.failed + t.runs - t.verified - t.unverifiable - (t.infra_errors ?? 0),
    }),
    { verified: 0, unverifiable: 0, flaky: 0, infra_errors: 0, failed: 0 },
  );

  const name = `${args.label ?? "run"}-${Date.now()}.json`;
  writeFileSync(join(RESULTS_DIR, name), JSON.stringify(report, null, 2));
  console.log(
    `\nwrote evals/results/${name}  median total: ${report.median_total_ms}ms  verified:${totals.verified} unverifiable:${totals.unverifiable} flaky:${totals.flaky} infra:${totals.infra_errors} failed:${totals.failed}`,
  );

  const byClause = new Map();

  for (const [id, t] of Object.entries(report.tasks)) {
    if (!t.why) continue;

    const runsFailed = t.runs - t.verified - t.unverifiable;
    (byClause.get(t.why.clause) ?? byClause.set(t.why.clause, []).get(t.why.clause))
      .push(`${id} (${runsFailed}/${t.runs})`);
  }

  if (byClause.size) {
    console.log("\nfailures by clause:");

    for (const [clause, ids] of [...byClause].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${clause.padEnd(14)} ${ids.length}  ${ids.join(", ")}`);
    }
  }

  if (totals.failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
