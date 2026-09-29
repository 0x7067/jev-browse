import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Agent } from "../src/agent.ts";
import { CdpBrowser } from "../src/cdp/browser.ts";
import { AgentBrowser } from "../src/abrowser.ts";
import { loadDotEnv } from "../src/env.ts";

loadDotEnv();

process.env.JEV_PROVIDER = "openrouter";

const out = resolve("evals/results", `countdown-proof-${Date.now()}`);

mkdirSync(out, { recursive: true });

for (const [engine, Driver] of [["cdp", CdpBrowser], ["agent-browser", AgentBrowser]]) {
  const profile = mkdtempSync(join(tmpdir(), "jev-countdown-"));
  process.env.JEV_PROFILE = profile;
  process.env.JEV_AB_PROFILE = profile;

  let agent;

  try {
    agent = await Agent.start({ url: new URL("../evals/fixtures/countdown-controls.html", import.meta.url).href, goal: "Open the operations report and stop when it is open.", open: url => Driver.open(url), maxSteps: 8 });
    const page = await agent.browser.observe();
    const offer = page.actions.find(action => action.kind === "click" && action.label.startsWith("Optional offer"));
    const report = page.actions.find(action => action.kind === "click" && action.label === "Open operations report");

    assert(offer && report);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await agent.browser.fresh(page), false);
    assert.equal(await agent.browser.fresh(page, undefined, "structure"), true);
    assert.equal(await agent.browser.fresh(page, offer, "page"), false);
    assert.equal(await agent.browser.fresh(page, { ...offer, kind: "double_click" }, "page"), false);
    assert.equal(await agent.browser.fresh(page, report, "page"), true);

    const result = await agent.run();

    writeFileSync(join(out, `${engine}.json`), JSON.stringify(result, null, 2));
    assert.equal(result.status, "done");
    assert.match(result.final_text, /Operations report opened/);
    console.log(JSON.stringify({ out, engine, status: result.status, steps: result.steps }));
  } finally {
    await agent?.close();
    rmSync(profile, { recursive: true, force: true });
  }
}
