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

const out = resolve("evals/results", `context-fallback-proof-${Date.now()}`);

mkdirSync(out, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), "jev-context-"));

process.env.JEV_PROFILE = profile;

let agent;

let injected = false;

try {
  await withTrace(join(out, "trace.jsonl"), async () => {
    agent = await Agent.start({ url: new URL("../evals/fixtures/large-controls.html", import.meta.url).href, goal: "Export the quarterly report and stop when export is confirmed.", open: url => CdpBrowser.open(url), maxSteps: 8 });
    const original = agent.client.systemOne.bind(agent.client);

    agent.client.systemOne = async request => {
      if (!injected && request.questions.operation) {
        injected = true;
        throw new Error("Request exceeds context limit");
      }

      return original(request);
    };

    const result = await agent.run();
    writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2));
    assert(injected);
    assert.equal(result.status, "done");
    assert.match(result.final_text, /Quarterly report exported/);
    assert(result.history.some(entry => entry.action === "Export quarterly report"));
    console.log(JSON.stringify({ out, status: result.status, steps: result.steps }));
  });
} finally {
  await agent?.close();
  rmSync(profile, { recursive: true, force: true });
}
