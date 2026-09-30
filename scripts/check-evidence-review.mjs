import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { loadDotEnv } from "../src/env.ts";
import { reviewEvidence } from "./lib/evidence-review.ts";
import { OBSERVED_TEXT_SCOPE } from "../src/agent/progress.ts";

loadDotEnv();

const { values } = parseArgs({ options: { calibration: { type: "string" }, replay: { type: "string" } } });

if (!values.calibration || !values.replay) throw new Error("Supply --calibration REPORT.json --replay CONTEXT.json");

const read = path => JSON.parse(readFileSync(path, "utf8"));

const cases = read(values.calibration).filter(test => test.expected !== "NOT_REQUESTED").map(test => ({ id: test.id, context: test.context, expected: test.expected !== "MISSING_EVIDENCE" }));

for (let i = 0; i < 3; i++) cases.push({ id: `replay-${i}`, context: read(values.replay).context, expected: false });

const out = resolve("evals/results", `evidence-review-${Date.now()}`);

mkdirSync(out, { recursive: true });

const results = [];

for (const test of cases) {
  const { proposed_answer: omitted, ...context } = test.context;
  assert.notEqual(omitted, undefined);

  for (const observation of [context.current, ...context.observed_progress]) observation.text_scope = OBSERVED_TEXT_SCOPE;
  const response = await reviewEvidence(context);
  const pass = response.sufficient === test.expected;
  results.push({ id: test.id, context, expected: test.expected, response, pass });
  writeFileSync(join(out, "report.json"), JSON.stringify(results, null, 2));
  console.log(`${test.id}: ${response.sufficient} ${pass ? "PASS" : "FAIL"}`);
}

console.log(out);

assert.equal(results.filter(result => !result.pass).length, 0);
