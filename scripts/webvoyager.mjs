import { validateRequirements, aggregateChecks, judgmentFormat, REQUIREMENT_JUDGE } from "./lib/webvoyager/requirements.mjs";
import { reportedUsage } from "./lib/webvoyager/usage.mjs";
import { createHash } from "node:crypto";
import { trajectory, executionFailure, counts } from "./lib/webvoyager/evidence.mjs";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { loadEnvFile } from "./lib/env.mjs";

const root = resolve(import.meta.dirname, "..");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const save = (path, value) => {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temporary, path);
};

const interruption = new AbortController();

let stopChild;

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  interruption.abort(new Error(`Interrupted by ${signal}`));
  stopChild?.();
});

const { values: args } = parseArgs({ options: {
  out: { type: "string" }, manifest: { type: "string", default: "evals/webvoyager/pilot.json" }, tasks: { type: "string" },
  "max-steps": { type: "string", default: "30" },
  "timeout-ms": { type: "string", default: "180000" },
  "judge-only": { type: "boolean" }, resume: { type: "boolean" }, help: { type: "boolean" },
} });

if (args.help) {
  console.log("node scripts/webvoyager.mjs [--out DIR] [--manifest FILE] [--tasks id,id] [--max-steps 30] [--timeout-ms 180000] [--judge-only | --resume]\nJudge: WEBVOYAGER_JUDGE_MODEL (default openai/gpt-5.4), OPENROUTER_API_KEY. Results are a custom-judge pilot, not an official score.");
  process.exit(0);
}

const env = loadEnvFile(join(root, ".env"), { ...process.env });

const manifest = JSON.parse(readFileSync(resolve(root, args.manifest)));

const selected = args.tasks?.split(",");

const tasks = manifest.tasks.filter((t) => !selected || selected.includes(t.id));

if (!tasks.length || selected?.some((id) => !tasks.some((t) => t.id === id))) throw new Error("Unknown or empty task selection");

for (const task of tasks) {
  if (task.id !== "Google Search--15") validateRequirements(task.requirements);
}

const maxSteps = Number(args["max-steps"]);

const timeout = Number(args["timeout-ms"]);

if (!Number.isInteger(maxSteps) || maxSteps < 1 || !Number.isInteger(timeout) || timeout < 1000) throw new Error("Invalid limits");

if (args.resume && args["judge-only"]) throw new Error("--resume and --judge-only are mutually exclusive");

if ((args.resume || args["judge-only"]) && !args.out) throw new Error("--judge-only requires --out");

const out = resolve(args.out ?? join(root, "evals/results", `webvoyager-${Date.now()}`));

if (!args.resume && !args["judge-only"] && existsSync(out)) throw new Error("Output already exists; choose a new directory");

mkdirSync(out, { recursive: true });

const judgeModel = env.WEBVOYAGER_JUDGE_MODEL ?? "openai/gpt-5.4";

const evaluationOut = args["judge-only"] ? join(out, "judgments", String(Date.now())) : out;

mkdirSync(evaluationOut, { recursive: true });

const sourceReport = args["judge-only"] ? JSON.parse(readFileSync(join(out, "report.json"))) : null;

const bundleHash = () => createHash("sha256").update(readFileSync(join(root, "bundled/cli.mjs"))).digest("hex");

const initialBundleHash = bundleHash();

const snapshotHash = () => createHash("sha256").update(readFileSync(join(root, "bundled/snapshot.js"))).digest("hex");

env.ANSWER_REVIEW_MODEL ??= (env.TEXT_MODEL_BASE_URL ?? "").includes("openrouter.ai") ? "anthropic/claude-opus-5.5" : env.TEXT_MODEL ?? "deepseek-chat";

const report = { judge_prompt: REQUIREMENT_JUDGE, judge_prompt_sha256: createHash("sha256").update(REQUIREMENT_JUDGE).digest("hex"), runner_pid: process.pid, snapshot_sha256: args["judge-only"] ? sourceReport.snapshot_sha256 ?? null : snapshotHash(), protocol: "webvoyager-pilot-custom-judge-v7", evaluation_requirements: Object.fromEntries(tasks.map(t => [t.id, t.requirements ?? null])), actual_selection: tasks.map((t) => t.id), source_run: sourceReport, bundle_sha256: args["judge-only"] ? sourceReport.bundle_sha256 ?? null : initialBundleHash, started: new Date().toISOString(), revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()), dataset: manifest, max_steps: maxSteps, timeout_ms: timeout, judge_model: judgeModel, model_config: Object.fromEntries(Object.entries(env).filter(([k]) => /^(JEV_PROVIDER|TYPESAFE_MODEL|TYPESAFE_BASE_URL|TEXT_MODEL|TEXT_MODEL_BASE_URL|ANSWER_REVIEW_MODEL)$/.test(k))), results: [] };

if (sourceReport) {
  for (const key of ["revision", "dirty", "dataset", "max_steps", "timeout_ms", "model_config"]) report[key] = sourceReport[key];
}

if (args.resume) {
  const previous = JSON.parse(readFileSync(join(out, "report.json")));

  if (!previous.runner_pid || !previous.snapshot_sha256) throw new Error("This older run lacks resume identity; start a new run instead");

  try {
    process.kill(previous.runner_pid, 0);
    throw new Error("Recorded runner is still live; refuse concurrent resume");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }

  for (const key of ["protocol", "judge_prompt_sha256", "bundle_sha256", "snapshot_sha256", "actual_selection", "dataset", "model_config", "judge_model", "max_steps", "timeout_ms"]) {
    if (JSON.stringify(previous[key]) !== JSON.stringify(report[key])) throw new Error(`Resume configuration changed: ${key}`);
  }

  report.started = previous.started;
  report.results = previous.results;
  report.resumed_at = [...(previous.resumed_at ?? []), new Date().toISOString()];
}

const lockPath = join(evaluationOut, "runner.lock");

const lock = openSync(lockPath, "wx", 0o600);

writeFileSync(lock, JSON.stringify({ pid: process.pid }));

closeSync(lock);

process.on("exit", () => rmSync(lockPath, { force: true }));

report.counts = counts(report.results, tasks.length);

save(join(evaluationOut, "report.json"), report);

async function cdp(url) {
  const ws = new WebSocket(url);

  try {
    await once(ws, "open", { signal: AbortSignal.timeout(5000) });
  } catch (error) {
    ws.close();
    throw error;
  }

  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", ({ data }) => {
    const m = JSON.parse(String(data));
    const p = pending.get(m.id);

    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);

    if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
  });

  return { close: () => ws.close(), send: (method, params = {}) => new Promise((resolvePromise, reject) => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout: ${method}`)); }, 5000);
    pending.set(n, { resolve: resolvePromise, reject, timer });
    ws.send(JSON.stringify({ id: n, method, params }));
  }) };
}

async function run(task, dir) {
  const work = mkdtempSync(join(tmpdir(), "jev-webvoyager-"));
  const chromePath = [env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && existsSync(p));

  if (!chromePath) throw new Error("Chrome not found");
  const chrome = spawn(chromePath, ["--remote-debugging-port=0", `--user-data-dir=${work}`, "--headless=new", "--no-first-run", "--no-default-browser-check", "--window-size=1024,768", "about:blank"], { stdio: "ignore" });
  let chromeError;
  chrome.on("error", (e) => { chromeError = e; });
  let child;
  let session;
  let timer;
  let capturing;
  const screenshots = [];
  const captureErrors = [];
  const started = Date.now();

  try {
    const portFile = join(work, "DevToolsActivePort");

    for (let i = 0; !existsSync(portFile) && i < 100; i++) {
      if (interruption.signal.aborted) throw interruption.signal.reason;

      if (chromeError) throw chromeError;
      await sleep(100);
    }

    const port = readFileSync(portFile, "utf8").split("\n")[0];
    const endpoint = `http://127.0.0.1:${port}`;

    async function capture() {
      try {
        const targets = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());

        for (const target of targets.filter((t) => t.type === "page")) {
          session = await cdp(target.webSocketDebuggerUrl);
          const { data } = await session.send("Page.captureScreenshot", { format: "png" });
          const file = `screenshot-${String(screenshots.length).padStart(4, "0")}.png`;
          writeFileSync(join(dir, file), Buffer.from(data, "base64"));
          screenshots.push({ file, target_id: target.id, url: target.url, elapsed_ms: Date.now() - started });
          session.close();
          session = undefined;
        }
      } catch (e) { captureErrors.push(String(e)); }
      finally { session?.close(); session = undefined; }
    }

    child = spawn(process.execPath, [join(root, "bundled/cli.mjs"), "--url", task.web, "--goal", task.ques, "--cdp", endpoint, "--max-steps", String(maxSteps), "--trace", join(dir, "trace.jsonl")], { cwd: root, env: { ...env, JEV_PROFILE: work } });
    save(join(dir, "resources.json"), { chrome_pid: chrome.pid, cli_pid: child.pid, profile: work });
    stopChild = () => child.kill("SIGKILL");

    if (interruption.signal.aborted) stopChild();
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    timer = setInterval(() => { if (!capturing) capturing = capture().finally(() => { capturing = undefined; }); }, 2000);
    let timedOut = false;
    const killer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeout);
    const [exitCode] = await once(child, "close").finally(() => clearTimeout(killer));
    clearInterval(timer);
    await capturing;
    await capture();
    writeFileSync(join(dir, "stdout.json"), stdout, { mode: 0o600 });
    writeFileSync(join(dir, "stderr.jsonl"), stderr, { mode: 0o600 });
    let result;

    try { result = JSON.parse(stdout); } catch { result = { status: "error", error: "CLI returned no JSON" }; }

    return { started_at: new Date(started).toISOString(), result, interrupted: interruption.signal.aborted, timed_out: timedOut, exit_code: exitCode, wall_ms: Date.now() - started, screenshots, capture_errors: captureErrors, usage: result.history?.map((h) => h.usage) ?? [], cost_usd: null };
  } finally {
    stopChild = undefined;
    clearInterval(timer);
    child?.kill("SIGKILL");
    await capturing;
    session?.close();

    if (chrome.exitCode === null && chrome.signalCode === null) {
      const closed = once(chrome, "close");
      chrome.kill("SIGKILL");
      await closed;
    }

    rmSync(work, { recursive: true, force: true });
  }
}

async function judge(task, runResult, dir, evaluationDir) {
  const failure = executionFailure(runResult);

  if (failure) return failure;

  if (!env.OPENROUTER_API_KEY) return { verdict: "unverifiable", reason: "OPENROUTER_API_KEY missing for independent vision judge" };

  const rubricTask = manifest.tasks.find(candidate => candidate.id === task.id && candidate.ques === task.ques);
  const requirements = validateRequirements(rubricTask?.requirements);
  save(join(evaluationDir, "requirements.json"), { task: task.ques, requirements });
  const evidence = trajectory(dir, runResult);
  save(join(evaluationDir, "judge-evidence.json"), evidence);

  if (!evidence.screenshots.length && !evidence.observations.length) return { verdict: "unverifiable", category: "missing_evidence", reason: "No independent page evidence captured" };
  const content = [{ type: "text", text: JSON.stringify({ reference_time: runResult.started_at ?? sourceReport?.started ?? report.started, task: task.ques, requirements, answer: runResult.result?.answer ?? null, final_url: runResult.result?.final_url, ...evidence }) }, ...evidence.screenshots.map(({ file }) => ({ type: "image_url", image_url: { url: `data:image/png;base64,${readFileSync(join(dir, file)).toString("base64")}` } }))];
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", signal: AbortSignal.any([interruption.signal, AbortSignal.timeout(90000)]), headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: judgeModel, temperature: 0, max_tokens: 3000, response_format: judgmentFormat(requirements), messages: [{ role: "system", content: REQUIREMENT_JUDGE }, { role: "user", content }] }) });

  if (!response.ok) throw new Error(`Judge HTTP ${response.status}`);
  const raw = await response.json();
  save(join(evaluationDir, "judge-response.json"), raw);
  const verdict = aggregateChecks(requirements, JSON.parse(raw.choices[0].message.content), runResult.result?.answer);

  return { ...verdict, usage: raw.usage };
}

for (const selectedTask of tasks) {
  if (interruption.signal.aborted) break;

  if (args.resume && report.results.some((r) => r.id === selectedTask.id)) continue;
  const task = args["judge-only"] && selectedTask.id !== "Google Search--15" ? JSON.parse(readFileSync(join(out, selectedTask.id.replace(/[^a-zA-Z0-9_-]/g, "_"), "task.json"))) : selectedTask;

  if (task.id === "Google Search--15") {
    report.results.push({ id: task.id, verdict: "excluded", reason: "Excluded: dataset task requires credential use; not authorized for this pilot" });
    continue;
  }

  const dir = join(out, task.id.replace(/[^a-zA-Z0-9_-]/g, "_"));
  const evaluationDir = join(evaluationOut, task.id.replace(/[^a-zA-Z0-9_-]/g, "_"));
  mkdirSync(evaluationDir, { recursive: true });

  if (!args["judge-only"]) {
    if (bundleHash() !== initialBundleHash || snapshotHash() !== report.snapshot_sha256) throw new Error("Bundle changed during run; refusing a mixed-build benchmark");
    save(join(dir, "task.json"), task);
  }

  console.log(`Running ${task.id}`);
  let runResult;

  try {
    if (args.resume && existsSync(join(dir, "trace.jsonl")) && !existsSync(join(dir, "run.json"))) {
      runResult = { result: { status: "error", error: "Interrupted attempt has a trace but no final result; preserved without rerun" }, interrupted: true, screenshots: [] };
    } else {
      runResult = args["judge-only"] || (args.resume && existsSync(join(dir, "run.json"))) ? JSON.parse(readFileSync(join(dir, "run.json"))) : await run(task, dir);
    }
  } catch (e) { runResult = { result: { status: "error", error: String(e) }, screenshots: [] }; }

  if (!args["judge-only"] && !(args.resume && existsSync(join(dir, "run.json")))) save(join(dir, "run.json"), runResult);
  let evaluation;

  try { evaluation = interruption.signal.aborted ? { verdict: "unverifiable", category: "interrupted", reason: "Run interrupted by operator" } : await judge(task, runResult, dir, evaluationDir); }
  catch (e) { evaluation = { verdict: "unverifiable", category: "judge_error", reason: String(e) }; }

  save(join(evaluationDir, "usage.json"), { agent: reportedUsage(dir), judge: evaluation.usage ?? null });
  save(join(evaluationDir, "verdict.json"), evaluation);
  report.results.push({ id: task.id, status: runResult.result?.status, wall_ms: runResult.wall_ms, timed_out: runResult.timed_out, ...evaluation });
  report.counts = counts(report.results, tasks.length);
  save(join(evaluationOut, "report.json"), report);
  console.log(`${task.id}: ${evaluation.verdict} — ${evaluation.reason}`);

  if (/credits|402|401|API.key/i.test(runResult.result?.error ?? "")) {
    report.stopped_reason = runResult.result.error;
    save(join(evaluationOut, "report.json"), report);
    break;
  }
}

report.counts = counts(report.results, tasks.length);

report.interrupted = interruption.signal.aborted;

save(join(evaluationOut, "report.json"), report);

console.log(JSON.stringify({ out: evaluationOut, counts: report.counts }));

process.exitCode = interruption.signal.aborted ? 130 : report.counts.failed || report.counts.unverifiable ? 1 : 0;
