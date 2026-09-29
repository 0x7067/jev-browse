import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Agent } from "../src/agent.ts";
import { CdpBrowser } from "../src/cdp/browser.ts";
import { AgentBrowser } from "../src/abrowser.ts";
import { loadDotEnv } from "../src/env.ts";
import { trace, withTrace } from "../src/trace.ts";

loadDotEnv();

process.env.JEV_PROVIDER = "openrouter";

const out = resolve("evals/results", `field-recovery-${Date.now()}`);

mkdirSync(out, { recursive: true });

const choice = (question, selected) => ({ type: "choice", choice: selected, confidence: 1, probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, Number(key === selected)])) });

for (const [engine, Driver] of [["cdp", CdpBrowser], ["agent-browser", AgentBrowser]]) {
  const profile = mkdtempSync(join(tmpdir(), "jev-field-"));
  process.env.JEV_PROFILE = profile;
  process.env.JEV_AB_PROFILE = profile;

  let agent;
  let repeated = 0;

  try {
    await withTrace(join(out, `${engine}.jsonl`), async () => {
      agent = await Agent.start({ url: new URL("../evals/fixtures/field-recovery.html", import.meta.url).href, goal: "Verify this inspection using the code from its sealed report.", open: url => Driver.open(url), maxSteps: 10 });
      const original = agent.client.systemOne.bind(agent.client);

      agent.client.systemOne = async request => {
        const response = await original(request);
        const target = Object.entries(request.questions.type_text_target?.criteria ?? {}).find(([, value]) => value.element?.endsWith("] Inspection code"));

        if (!target || agent.page.text.includes("Inspection code:")) return response;
        repeated++;
        trace("controlled_unavailable_field", { engine, repeated, target: target[0] });
        response.answers.goal_progress = choice(request.questions.goal_progress, "INCOMPLETE");
        response.answers.operation = choice(request.questions.operation, "TYPE_TEXT");
        response.answers.type_text_target = choice(request.questions.type_text_target, target[0]);
        response.answers.follow_up = choice(request.questions.follow_up, "NONE");

        return response;
      };

      const result = await agent.run();
      writeFileSync(join(out, `${engine}.json`), JSON.stringify({ repeated, result }, null, 2));
      console.log(JSON.stringify({ out, engine, repeated, status: result.status, steps: result.steps }));
      assert.equal(result.status, "done");
      assert.match(result.final_text, /Inspection verified/);
      assert.equal(result.history.filter(entry => entry.kind === "fill").length, 1);
      assert.equal(repeated, 1);
    });
  } finally {
    await agent?.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
