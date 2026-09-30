import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { REQUIREMENT_JUDGE } from "./lib/webvoyager/requirements.mjs";
import { counts } from "./lib/webvoyager/evidence.mjs";

const { values } = parseArgs({ options: { baseline: { type: "string" }, candidate: { type: "string" }, out: { type: "string" }, manifest: { type: "string", default: "evals/webvoyager/pilot.json" }, model: { type: "string", default: "openai/gpt-5.4" } } });

if (!values.baseline || !values.candidate || !values.out) throw new Error("Supply --baseline DIR --candidate DIR --out FILE");

const manifest = JSON.parse(readFileSync(resolve(values.manifest)));

const promptHash = createHash("sha256").update(REQUIREMENT_JUDGE).digest("hex");

const read = path => JSON.parse(readFileSync(path));

const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");

function collect(directory) {
  const root = resolve(directory);
  const original = read(join(root, "report.json"));
  const judgments = join(root, "judgments");
  const files = existsSync(judgments) ? readdirSync(judgments).filter(name => /^\d+$/.test(name)).sort((a, b) => Number(b) - Number(a)).map(name => join(judgments, name, "report.json")) : [];
  const selected = new Map();

  for (const file of [...files, join(root, "report.json")]) {
    const report = read(file);

    if (report.protocol !== "webvoyager-pilot-custom-judge-v7" || report.judge_model !== values.model || report.judge_prompt_sha256 !== promptHash) continue;

    if (existsSync(join(resolve(file, ".."), "runner.lock"))) throw new Error(`Matching judgment still in progress: ${file}`);

    if ((report.bundle_sha256 ?? null) !== (original.bundle_sha256 ?? null) || (report.source_run?.started ?? report.started) !== original.started) throw new Error(`Source identity mismatch: ${file}`);

    for (const result of report.results) {
      const task = manifest.tasks.find(task => task.id === result.id);

      if (!task || selected.has(task.id) || JSON.stringify(report.evaluation_requirements?.[task.id]) !== JSON.stringify(task.requirements)) continue;
      const sourceTask = original.dataset.tasks.find(item => item.id === task.id);

      if (sourceTask?.ques !== task.ques) throw new Error(`Source task changed: ${task.id}`);
      selected.set(task.id, { ...result, source_report: file, source_report_sha256: hash(file) });
    }
  }

  const missing = manifest.tasks.filter(task => !selected.has(task.id)).map(task => task.id);

  if (missing.length) throw new Error(`Missing compatible judgments: ${missing.join(", ")}`);
  const results = manifest.tasks.map(task => selected.get(task.id));

  return { root, original_started: original.started, bundle_sha256: original.bundle_sha256 ?? null, build_identity: original.bundle_sha256 ? "recorded" : "not recorded in original run", counts: counts(results, manifest.tasks.length), results };
}

const report = { protocol: "webvoyager-pilot-custom-judge-v7", model: values.model, judge_prompt_sha256: promptHash, requirements: manifest.tasks.map(({ id, ques, requirements }) => ({ id, ques, requirements })), baseline: collect(values.baseline), candidate: collect(values.candidate), selection_rule: "Latest compatible judgment per task; same original source identity, task wording, exact rubric, judge model and prompt. No best-score selection.", limitation: "Comparison of saved captures, not a fresh run of the current worktree; model judgments still require evidence review." };

const out = resolve(values.out);

if (existsSync(out)) throw new Error("Output exists; preserve prior comparisons");

writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

console.log(JSON.stringify({ out, baseline: report.baseline.counts, candidate: report.candidate.counts }));
