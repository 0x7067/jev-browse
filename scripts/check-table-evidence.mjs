import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CdpBrowser } from "../src/cdp/browser.ts";

const profile = mkdtempSync(join(tmpdir(), "jev-tables-"));

const out = resolve("evals/results", `table-shape-proof-${Date.now()}`);

process.env.JEV_PROFILE = profile;

mkdirSync(out, { recursive: true });

let browser;

try {
  browser = await CdpBrowser.open(new URL("../evals/fixtures/table-evidence.html", import.meta.url).href);
  const before = await browser.observe();

  assert.equal(before.tables[0].label, "Current staff");
  assert.deepEqual(before.tables[0].rows[0].cells.map(cell => cell.kind), ["header", "header", "header"]);
  assert.deepEqual(before.tables[0].rows[1].cells.map(cell => cell.text), ["Hart", "Milo", "Support"]);
  assert.equal(before.tables[1].label, "Archived staff");

  const action = before.actions.find(action => action.kind === "click" && action.label.includes("Given name ascending"));

  assert(action);
  await browser.act(action, before);

  const after = await browser.observe();

  assert.deepEqual(after.tables[0].rows[1].cells.map(cell => cell.text), ["Quinn", "Azra", "Engineering"]);
  assert.equal(after.tables[0].rows[0].cells[1].sort, "ascending");
  assert.equal(after.tables[1].rows[1].cells[0].text, "Stone");
  assert.notEqual(before.fingerprint, after.fingerprint);
  writeFileSync(join(out, "before.json"), JSON.stringify(before, null, 2));
  writeFileSync(join(out, "after.json"), JSON.stringify(after, null, 2));
  console.log(JSON.stringify({ out, tables: after.tables.length, verified: true }));
} finally {
  await browser?.close();
  rmSync(profile, { recursive: true, force: true });
}
