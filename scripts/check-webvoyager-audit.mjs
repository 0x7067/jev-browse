import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "jev-audit-"));

const output = join(root, "audit.json");

const task = join(root, "Example--1");

const write = (path, value) => writeFileSync(path, JSON.stringify(value));

const invoke = () => spawnSync(process.execPath, [resolve("scripts/audit-webvoyager.mjs"), "--run", root, "--out", output], { encoding: "utf8" });

try {
  mkdirSync(task);
  const run = { result: { answer: "Claim without supporting evidence" } };
  write(join(task, "run.json"), run);

  const report = {
    actual_selection: ["Example--1", "Example--2", "Example--3", "Example--4"],
    results: [{ id: "Example--1", verdict: "verified" }, { id: "Example--2", verdict: "verified" }, { id: "Example--3", verdict: "excluded" }],
  };

  write(join(root, "report.json"), report);
  write(join(task, "adjudication.json"), {
    verdict: "unverifiable", category: "insufficient_evidence", reason: "Only one option was observed", source: "run.json",
    original_verdict_preserved: true, run_sha256: createHash("sha256").update(readFileSync(join(task, "run.json"))).digest("hex"),
  });
  const success = invoke();
  assert.equal(success.status, 0, success.stderr);
  const audited = JSON.parse(readFileSync(output));
  assert.deepEqual(audited.adjudicated_counts, { selected: 4, attempted: 2, unattempted: 1, verified: 1, failed: 0, unverifiable: 1, excluded: 1 });
  assert.equal(audited.automated_counts.verified, 2);
  assert.deepEqual(audited.review_coverage, { reviewed: 1, changed: 1, unreviewed_verified: ["Example--2"] });
  assert.equal(audited.results[0].automated_judgment.verdict, "verified");
  assert.deepEqual(JSON.parse(readFileSync(join(root, "report.json"))), report);
  const saved = readFileSync(output, "utf8");
  assert.notEqual(invoke().status, 0);
  assert.equal(readFileSync(output, "utf8"), saved);
  rmSync(output);
  writeFileSync(join(root, "runner.lock"), "active");
  assert.match(invoke().stderr, /Run is still active/);
  rmSync(join(root, "runner.lock"));
  write(join(task, "run.json"), { result: { answer: "Changed evidence" } });
  assert.match(invoke().stderr, /Review source mismatch/);
  console.log("Audit CLI preserves raw verdicts and denominators; refuses active runs, stale reviews, and overwrites");
} finally {
  rmSync(root, { recursive: true, force: true });
}
