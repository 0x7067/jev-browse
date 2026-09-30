import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadEnvFile } from "./lib/env.mjs";
import { aggregateChecks, judgmentFormat, REQUIREMENT_JUDGE } from "./lib/webvoyager/requirements.mjs";

const env = loadEnvFile(resolve(".env"), { ...process.env });

const model = env.WEBVOYAGER_JUDGE_MODEL ?? "openai/gpt-5.4";

const out = resolve("evals/results", `judge-calibration-${Date.now()}`);

mkdirSync(out, { recursive: true });

const pair = [{ id: "north", description: "Return the North station sensor count.", delivery: "answer" }, { id: "south", description: "Return the South station sensor count.", delivery: "answer" }];

const full = [{ url: "https://fixture.invalid/report", text: "North station: 18 active sensors. South station: 12 active sensors." }];

const cases = [
  { id: "complete", task: "Report both station sensor counts.", requirements: pair, answer: "North: 18. South: 12.", observations: full, expected: "verified" },
  { id: "partial", task: "Report both station sensor counts.", requirements: pair, answer: "North: 18.", observations: full, expected: "failed" },
  { id: "absent-answer", task: "Report both station sensor counts.", requirements: pair, answer: null, observations: full, expected: "failed" },
  { id: "contradiction", task: "Report both station sensor counts.", requirements: pair, answer: "North: 999. South: 12.", observations: full, expected: "failed" },
  { id: "sampled-evidence", task: "Report both station sensor counts.", requirements: pair, answer: "North: 18. South: 12.", observations: [{ url: "https://fixture.invalid/report", text: "North station: 18 active sensors.", text_truncated: true }], expected: "unverifiable" },
  { id: "unsupported-ceiling", task: "Can this device be configured with more than 18 channels?", requirements: [{ id: "configuration", description: "Answer whether more than 18 channels can be configured, supported by configuration-limit evidence.", delivery: "answer" }], answer: "No, 18 is the maximum.", observations: [{ url: "https://fixture.invalid/specs", text: "Standard package: 18 channels. See configuration options for upgrades.", controls: [{ label: "Configuration options", kind: "click" }] }], expected: "unverifiable" },
  { id: "browser-only", task: "Select express delivery and stop.", requirements: [{ id: "selection", description: "Select express delivery.", delivery: "browser" }], answer: null, observations: [{ url: "https://fixture.invalid/form", text: "Delivery method", controls: [{ label: "Express delivery", checked: "true", role: "radio" }] }], expected: "verified" },
  { id: "relative-date", task: "Find a repository updated in the past two days with at least 500 stars.", requirements: [{ id: "repository", description: "Return a repository updated in the past two days with at least 500 stars.", delivery: "answer" }], answer: "RiverTools, updated September 28, 2026, with 650 stars.", observations: [{ url: "https://fixture.invalid/river", text: "RiverTools · Updated 2026-09-28 · 650 stars" }], expected: "verified" },
  { id: "ordinary-scope", task: "Summarize three places in this travel article.", requirements: [{ id: "places", description: "Summarize three places from the same travel article.", delivery: "answer" }], answer: "Portville has a waterfront, the Beacon Museum has ship models, and Pine Bay has calm water.", observations: [{ url: "https://fixture.invalid/travel", text: "Portville has a waterfront. Beacon Museum displays ship models. Pine Bay is known for calm water." }], expected: "verified" },
];

const allSupported = { checks: pair.map(requirement => ({ id: requirement.id, delivery: "present", support: "supported", category: "outcome", reason: "Claims success" })) };

assert.equal(aggregateChecks(pair, allSupported, null).verdict, "failed");

assert.throws(() => aggregateChecks(pair, { checks: [allSupported.checks[0], allSupported.checks[0]] }, "answer"));

assert.throws(() => aggregateChecks(pair, { checks: [allSupported.checks[0]] }, "answer"));

assert.equal(aggregateChecks(pair, { checks: [allSupported.checks[0], { ...allSupported.checks[1], delivery: "missing", reason: "Missing second requested outcome" }] }, "partial").verdict, "failed");

cases.push(
  { id: "explicit-limit", task: "What is the maximum memory this workstation supports?", requirements: [{ id: "limit", description: "Provide the supported memory maximum.", delivery: "answer" }], answer: "64 GB.", observations: [{ url: "https://fixture.invalid/workstation", text: "Supported memory configurations: 16 GB, 32 GB, and 64 GB. Maximum supported memory is 64 GB." }], expected: "verified" },
  { id: "unmet-browser-state", task: "Enable weekly reminders.", requirements: [{ id: "reminders", description: "Enable weekly reminders.", delivery: "browser" }], answer: null, observations: [{ url: "https://fixture.invalid/settings", text: "Reminder settings", controls: [{ label: "Weekly reminders", checked: "false", role: "checkbox" }] }], expected: "failed" },
  { id: "site-block", task: "Report the shelf count in the inventory.", requirements: [{ id: "count", description: "Return the shelf count.", delivery: "answer" }], answer: null, observations: [{ url: "https://fixture.invalid/inventory", text: "Access denied. Security verification required before inventory can be viewed." }], expected: "failed" },
);

cases.push(
  { id: "qualifier-not-repeated", task: "Find a sensor pack with 20 modules. Provide the pack name.", requirements: [{ id: "name", description: "Return the pack name.", delivery: "answer" }, { id: "modules", description: "Establish that the identified pack contains 20 modules.", delivery: "browser" }], answer: "NorthPack.", observations: [{ url: "https://fixture.invalid/packs", text: "NorthPack contains 20 modules." }], expected: "verified" },
  { id: "qualifier-not-met", task: "Find a sensor pack with 20 modules. Provide the pack name.", requirements: [{ id: "name", description: "Return the pack name.", delivery: "answer" }, { id: "modules", description: "Establish that the identified pack contains 20 modules.", delivery: "browser" }], answer: "NorthPack.", observations: [{ url: "https://fixture.invalid/packs", text: "NorthPack contains 10 modules." }], expected: "failed" },
);

const results = [];

for (const test of cases) {
  const payload = { reference_time: "2026-09-29T12:00:00Z", task: test.task, requirements: test.requirements, answer: test.answer, observations: test.observations, coverage: { sampling: "Controlled calibration evidence; marked truncation is intentional" } };
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", signal: AbortSignal.timeout(90000), headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model, temperature: 0, max_tokens: 3000, response_format: judgmentFormat(test.requirements), messages: [{ role: "system", content: REQUIREMENT_JUDGE }, { role: "user", content: JSON.stringify(payload) }] }) });

  if (!response.ok) throw new Error(`Judge HTTP ${response.status}`);
  const raw = await response.json();
  const actual = aggregateChecks(test.requirements, JSON.parse(raw.choices[0].message.content), test.answer);
  writeFileSync(join(out, `${test.id}.json`), JSON.stringify({ payload, expected: test.expected, raw, actual }, null, 2));
  results.push({ id: test.id, expected: test.expected, actual: actual.verdict, passed: actual.verdict === test.expected });
  writeFileSync(join(out, "report.json"), JSON.stringify({ model, protocol: "webvoyager-pilot-custom-judge-v7", prompt: REQUIREMENT_JUDGE, results }, null, 2));
  console.log(JSON.stringify(results.at(-1)));
}

console.log(out);

process.exitCode = results.every(result => result.passed) ? 0 : 1;
