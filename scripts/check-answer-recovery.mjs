import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Agent } from "../src/agent.ts";
import { CdpBrowser } from "../src/cdp/browser.ts";
import { loadDotEnv } from "../src/env.ts";
import { withTrace } from "../src/trace.ts";

loadDotEnv();

process.env.JEV_PROVIDER = "openrouter";

const out = resolve("evals/results", `answer-recovery-proof-${Date.now()}`);

mkdirSync(out, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "jev-recovery-"));

process.env.JEV_PROFILE = profile;

let agent;

const injected = new Set();

const choice = (question, selected) => ({ choice: selected, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === selected)])) });

try {
  await withTrace(join(out, "trace.jsonl"), async () => {
    agent = await Agent.start({ url: new URL("../evals/fixtures/answer-recovery.html", import.meta.url).href, goal: "Summarize both stations' sensor counts and the maintenance window.", open: url => CdpBrowser.open(url), maxSteps: 8 });
    const original = agent.client.systemOne.bind(agent.client);
    agent.client.systemOne = async request => {
      const key = ["goal_progress", "completion"].find(key => request.questions[key] && !injected.has(key));

      if (!key) return original(request);
      injected.add(key);

      if (key === "goal_progress") {
        const response = await original(request);
        response.answers.goal_progress = choice(request.questions.goal_progress, "SATISFIED");

        return response;
      }

      const answers = { completion: choice(request.questions.completion, "SATISFIED"), basis: choice(request.questions.basis, "CURRENT_STATE") };

      return { answers, model: "controlled-premature-completion", usage: {} };
    };

    const result = await agent.run();
    writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
    assert.equal(injected.size, 2);
    assert.equal(result.status, "done");
    assert.match(result.final_url, /answer-evidence\.html$/);
    assert.match(result.answer, /18/);
    assert.match(result.answer, /12/);
    assert.match(result.answer, /Tuesday/);
    assert(result.history.some(entry => entry.kind === "click"));
    console.log(JSON.stringify({ out, status: result.status, steps: result.steps, injected: [...injected] }));
  });
} finally {
  await agent?.close();
  rmSync(profile, { recursive: true, force: true });
}
