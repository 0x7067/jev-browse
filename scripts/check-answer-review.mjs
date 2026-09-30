import { loadEnvFile } from "./lib/env.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { case: { type: "string" } } });

const root = resolve(import.meta.dirname, "..");

const reviewEnv = { ...process.env };

loadEnvFile(join(root, ".env"), reviewEnv);

const reviewModel = reviewEnv.ANSWER_REVIEW_MODEL ?? ((reviewEnv.TEXT_MODEL_BASE_URL ?? "").includes("openrouter.ai") ? "anthropic/claude-opus-5.5" : reviewEnv.TEXT_MODEL);

const out = join(root, "evals/results", `answer-review-check-${Date.now()}`);

mkdirSync(out, { recursive: true });

let answers = [];

let calls = 0;

let activeCase;

let fallbackCalls = 0;

const server = createServer(async (req, res) => {
  if (req.method === "HEAD") {
    res.writeHead(200);
    res.end();

    return;
  }

  let body = "";

  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);

  const isReview = request.messages?.[0]?.content?.startsWith("Independently review");

  if (isReview || request.model !== "fixture") {
    if (!isReview) fallbackCalls++;

    try {
      const response = await fetch(`${reviewEnv.TEXT_MODEL_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${reviewEnv.TEXT_MODEL_API_KEY}` },
        body,
        signal: AbortSignal.timeout(30000),
      });

      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(await response.text());
    } catch {
      res.writeHead(502);
      res.end("{}");
    }

    return;
  }

  const answer = answers[Math.min(calls++, answers.length - 1)];
  const content = activeCase.fault === "empty" || activeCase.fault === "refusal" ? null : activeCase.fault === "json" ? "{broken" : activeCase.fault === "schema" ? "{}" : JSON.stringify({ answer });
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content, refusal: activeCase.fault === "refusal" ? "Fixture provider declined this request" : null }, finish_reason: "stop" }], usage: {} }));
});

server.listen(0, "127.0.0.1");

await once(server, "listening");

const address = server.address();

assert(address && Object.hasOwn(address, "port"));

const cases = [
  { name: "rewrite-placeholder", answers: ["...", "North: 18 sensors. South: 12 sensors. Maintenance: Tuesday 14:00–16:00 UTC."], status: "done", calls: 2, fallback: 0 },
  { name: "reject-invented-facts", answers: ["North: 999 sensors. South: 888 sensors. Maintenance: Friday 01:00–02:00 UTC."], status: "blocked", calls: 2, fallback: 0 },
  { name: "empty-content", answers: [], fault: "empty", status: "done", calls: 1, fallback: 1 },
  { name: "invalid-json", answers: [], fault: "json", status: "done", calls: 1, fallback: 1 },
  { name: "invalid-schema", answers: [], fault: "schema", status: "done", calls: 1, fallback: 1 },
  { name: "null-answer", answers: [null], status: "blocked", calls: 4, fallback: 0 },
  { name: "provider-refusal", answers: [], fault: "refusal", status: "blocked", calls: 1, fallback: 0 },
].filter(test => !values.case || test.name === values.case);

assert(cases.length > 0, "Unknown case");

const results = [];

try {
  for (const test of cases) {
    activeCase = test;
    answers = test.answers;
    calls = 0;
    fallbackCalls = 0;
    const profile = mkdtempSync(join(tmpdir(), "jev-answer-review-"));
    const trace = join(out, `${test.name}.jsonl`);
    const child = spawn(process.execPath, [join(root, "bundled/cli.mjs"), "--url", `file://${join(root, "evals/fixtures/answer-evidence.html")}`, "--goal", "Summarize the station report, including each station sensor count and the maintenance window.", "--allow-file-urls", "--trace", trace], { cwd: root, env: { ...process.env, JEV_PROVIDER: "openrouter", JEV_PROFILE: profile, TEXT_MODEL_BASE_URL: `http://127.0.0.1:${address.port}`, TEXT_MODEL_API_KEY: "fixture-only", TEXT_MODEL: "fixture", ANSWER_REVIEW_MODEL: reviewModel } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 90000);

    try {
      await once(child, "close");
      writeFileSync(join(out, `${test.name}.stdout`), stdout);
      writeFileSync(join(out, `${test.name}.stderr`), stderr);
      const result = JSON.parse(stdout);
      const events = readFileSync(trace, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      const reviews = events.filter((event) => event.type === "answer_review_verdict").map((event) => event.data.verdict);
      assert.equal(result.status, test.status);
      assert.equal(calls, test.calls);
      assert.equal(fallbackCalls, test.fallback);

      if (test.status === "done" && test.fallback) {
        assert.match(result.answer, /18/);
        assert.match(result.answer, /12/);
        assert.match(result.answer, /Tuesday/);
        assert.match(result.answer, /14:00/);
        assert.match(result.answer, /16:00/);
        assert.match(result.answer, /UTC/);
        assert.equal(reviews.at(-1), "SUPPORTED");
      } else if (test.status === "done") assert.equal(result.answer, test.answers[1]);
      else {
        assert.equal(result.blocked_cause, "answer_unverified");
        assert.equal(result.answer, undefined);
      }

      results.push({ name: test.name, status: result.status, calls, fallbackCalls, reviews });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      clearTimeout(timer);
      child.kill("SIGKILL");
      rmSync(profile, { recursive: true, force: true });
    }
  }
} finally {
  server.close();
  writeFileSync(join(out, "report.json"), JSON.stringify(results, null, 2));
  console.log(out);
}
