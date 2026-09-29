import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { counts } from "./lib/webvoyager/evidence.mjs";

const { values } = parseArgs({ options: { run: { type: "string" }, out: { type: "string" } } });

if (!values.run || !values.out) throw new Error("Supply --run DIR --out FILE");

const root = resolve(values.run);

const read = path => JSON.parse(readFileSync(path, "utf8"));

const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");

const reportPath = join(root, "report.json");

if (existsSync(join(root, "runner.lock"))) throw new Error("Run is still active; wait for its final report");

const report = read(reportPath);

if (report.source_run) throw new Error("Use the original capture directory, not a rejudgment directory");

const seen = new Set();

const results = report.results.map(result => {
  if (result.id?.constructor !== String || seen.has(result.id)) throw new Error("Missing or duplicate task ID");
  seen.add(result.id);

  const dir = join(root, result.id.replace(/[^a-zA-Z0-9_-]/g, "_"));
  const path = join(dir, "adjudication.json");

  if (!existsSync(path)) return { ...result, evidence_review: "not_reviewed" };

  const review = read(path);

  if (result.verdict === "excluded" || !["verified", "failed", "unverifiable"].includes(review.verdict)) throw new Error(`Invalid review verdict: ${result.id}`);

  for (const key of ["category", "reason", "source"]) {
    if (review[key]?.constructor !== String || !review[key].trim()) throw new Error(`Missing review ${key}: ${result.id}`);
  }

  if (review.original_verdict_preserved !== true || review.run_sha256 !== hash(join(dir, "run.json"))) throw new Error(`Review source mismatch: ${result.id}`);

  return {
    ...result,
    verdict: review.verdict,
    category: review.category,
    reason: review.reason,
    automated_judgment: result,
    evidence_review: "reviewed",
    adjudication: { ...review, path, sha256: hash(path) },
  };
});

const selected = report.actual_selection?.length ?? report.dataset.tasks.length;

const reviewed = results.filter(result => result.evidence_review === "reviewed");

const unreviewedPasses = results.filter(result => result.verdict === "verified" && result.evidence_review !== "reviewed").map(result => result.id);

const output = {
  created_at: new Date().toISOString(),
  source_report: reportPath,
  source_report_sha256: hash(reportPath),
  protocol: report.protocol,
  bundle_sha256: report.bundle_sha256,
  model_config: report.model_config,
  automated_counts: counts(report.results, selected),
  adjudicated_counts: counts(results, selected),
  review_coverage: { reviewed: reviewed.length, changed: reviewed.filter(result => result.verdict !== result.automated_judgment.verdict).length, unreviewed_verified: unreviewedPasses },
  limitation: "Evidence reviews are explicit local adjudications, not an independent evaluator. Unreviewed verdicts remain automated. This is a custom pilot, not an official leaderboard score.",
  results,
};

writeFileSync(resolve(values.out), JSON.stringify(output, null, 2) + "\n", { flag: "wx" });

console.log(JSON.stringify({ out: resolve(values.out), automated: output.automated_counts, adjudicated: output.adjudicated_counts, coverage: output.review_coverage }));
