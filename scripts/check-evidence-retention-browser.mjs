import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CdpBrowser } from "../src/cdp/browser.ts";
import { AgentBrowser } from "../src/abrowser.ts";
import { rememberObservation, compactObservations } from "../src/agent/progress.ts";

const baselinePath = process.env.RETENTION_BASELINE;

const baseline = baselinePath ? await import(baselinePath) : null;

const out = resolve("evals/results", `evidence-retention-browser-${Date.now()}`);

const url = new URL("../evals/fixtures/evidence-retention.html", import.meta.url).href;

const evidence = /Team plan costs 14 dollars/;

const report = {};

mkdirSync(out, { recursive: true });

for (const [engine, Driver] of [["cdp", CdpBrowser], ["agent-browser", AgentBrowser]]) {
  const profile = mkdtempSync(join(tmpdir(), "jev-retention-"));
  process.env.JEV_PROFILE = profile;
  process.env.JEV_AB_PROFILE = profile;

  let browser;

  try {
    browser = await Driver.open(url, { allowFileUrls: true });
    const current = [];
    const previous = [];
    let page = await browser.observe();

    assert.doesNotMatch(page.text, evidence, `${engine}: landing page must not contain pricing`);

    const record = step => {
      rememberObservation(current, page, step);

      if (baseline) baseline.rememberObservation(previous, page, step);
    };

    record(0);

    const link = page.actions.find(action => action.kind === "click" && /Pricing/.test(action.label));

    assert.ok(link, `${engine}: pricing link must be offered`);
    await browser.act(link, page, null);

    for (let wait = 0; wait < 20 && !evidence.test(page.text); wait++) {
      await new Promise(done => setTimeout(done, 150));
      page = await browser.observe();
    }

    assert.match(page.text, evidence, `${engine}: pricing page must show plan prices`);
    record(1);

    for (let step = 2; step <= 15; step++) {
      const scroll = page.actions.find(action => action.kind === "scroll" && /down/i.test(action.label) && action.node === undefined);

      assert.ok(scroll, `${engine}: page scroll action must be offered at step ${step}`);
      await browser.act(scroll, page, null);
      page = await browser.observe();
      record(step);
    }

    const serialized = JSON.stringify(compactObservations(current, page.tables));
    const kept = current.map(observation => observation.after_step);
    const result = { kept, pricing_retained: evidence.test(serialized), final_scroll: page.scroll?.y ?? null, baseline_kept: baseline ? previous.map(observation => observation.after_step) : null, baseline_pricing_retained: baseline ? evidence.test(JSON.stringify(previous)) : null };

    report[engine] = result;
    console.log(JSON.stringify({ engine, ...result }));
    assert.ok((page.scroll?.y ?? 0) > 3000, `${engine}: page must actually scroll away from pricing`);
    assert.doesNotMatch(page.text, evidence, `${engine}: current observation no longer shows pricing`);
    assert.ok(result.pricing_retained, `${engine}: pricing evidence must remain in observed history`);
    assert.equal(kept.at(-1), 15);
    assert.ok(current.length <= 8);
  } finally {
    await browser?.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));

console.log(JSON.stringify({ out }));
