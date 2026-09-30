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

const variants = [
  { name: "recovery", query: "", always: false },
  { name: "missing", query: "?missing", always: true },
];

for (const [engine, Driver] of [["cdp", CdpBrowser], ["agent-browser", AgentBrowser]]) {
  for (const variant of variants) {
    const profile = mkdtempSync(join(tmpdir(), "jev-field-"));
    process.env.JEV_PROFILE = profile;
    process.env.JEV_AB_PROFILE = profile;

    let agent;
    let forced = 0;

    try {
      await withTrace(join(out, `${engine}-${variant.name}.jsonl`), async () => {
        const url = new URL("../evals/fixtures/field-recovery.html", import.meta.url).href + variant.query;
        agent = await Agent.start({ url, goal: "Verify this inspection using the code from its sealed report.", open: target => Driver.open(target), maxSteps: 10 });
        const original = agent.client.systemOne.bind(agent.client);

        agent.client.systemOne = async request => {
          const response = await original(request);
          const target = Object.entries(request.questions.type_text_target?.criteria ?? {}).find(([, value]) => value.element?.endsWith("] Inspection code"));

          if (!target || agent.page.text.includes("Inspection code:")) return response;

          if (!variant.always && forced > 0) return response;

          forced++;
          trace("controlled_unavailable_field", { engine, variant: variant.name, forced, target: target[0] });
          response.answers.goal_progress = choice(request.questions.goal_progress, "INCOMPLETE");
          response.answers.operation = choice(request.questions.operation, "TYPE_TEXT");
          response.answers.type_text_target = choice(request.questions.type_text_target, target[0]);
          response.answers.follow_up = choice(request.questions.follow_up, "NONE");

          return response;
        };

        const result = await agent.run();
        const fills = result.history.filter(entry => entry.kind === "fill");
        writeFileSync(join(out, `${engine}-${variant.name}.json`), JSON.stringify({ forced, result }, null, 2));
        console.log(JSON.stringify({ out, engine, variant: variant.name, forced, status: result.status, steps: result.steps, decisions: agent.decisions.length }));

        if (variant.name === "recovery") {
          assert.equal(result.status, "done");
          assert.match(result.final_text, /Inspection verified/);
          assert.equal(fills.length, 1);
          assert.equal(forced, 1);
        } else {
          assert.notEqual(result.status, "done");
          assert.notEqual(result.status, "error");
          assert.equal(fills.length, 0);
          assert.equal(forced, 1);
          assert.doesNotMatch(result.final_text, /Incorrect inspection code|Inspection verified/);
        }
      });
    } finally {
      await agent?.close();
      rmSync(profile, { recursive: true, force: true });
    }
  }
}
