import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpBrowser } from "../../src/cdp/browser.ts";

process.env.JEV_ALLOW_FILE_URLS = "1";
const FIXTURE_URL = "file://" + new URL("../../fixture-interactions.html", import.meta.url).pathname;
process.env.JEV_PROFILE = mkdtempSync(join(tmpdir(), "jev-rel-"));
const b = await CdpBrowser.open(FIXTURE_URL, {});
const t0 = performance.now();
const log: string[] = [];

try {
  let page = await b.observe();
  const below = page.actions.filter((a) => a.below === true);
  log.push(`below-fold actions=${below.length} labels=${below.map((a) => a.label).slice(0, 8).join(" / ")}`);

  const next = below.find((a) => /next/i.test(a.label));
  log.push(`next offered=${next ? "yes" : "NO"}`);

  const covered = page.actions.find((a) => /claim the prize/i.test(a.label));
  log.push(`covered offered=${covered ? "yes" : "NO"}`);

  if (covered) {
    try {
      await b.act(covered, page, null);
      await new Promise((r) => setTimeout(r, 250));
      page = await b.observe();
      log.push(`covered-click ${page.text.includes("DONE: prize claimed") ? "PASS" : "FAIL text=" + page.text.slice(0, 200)}`);
    } catch (e: any) {
      log.push(`covered-click threw ${e.name}: ${String(e.message).slice(0, 120)}`);
    }
  }

  if (next) {
    const p = await b.observe();
    const target = p.actions.find((a) => /next/i.test(a.label));
    try {
      await b.act(target ?? next, p, null);
      await new Promise((r) => setTimeout(r, 300));
      page = await b.observe();
      log.push(`below-next ${page.text.includes("DONE: page 2") ? "PASS" : "FAIL text=" + page.text.slice(-200)}`);
    } catch (e: any) {
      log.push(`below-next threw ${e.name}: ${String(e.message).slice(0, 120)}`);
    }
  }

  const slow = page.actions.find((a) => /load the report/i.test(a.label));
  if (slow) {
    await b.act(slow, page, null);
    const w0 = performance.now();
    let waits = 0;
    page = await b.observe();
    while (!page.text.includes("DONE: report ready") && performance.now() - w0 < 12_000 && waits < 20) {
      const w = page.actions.find((a) => a.kind === "wait");
      if (!w) break;
      await b.act(w, page, null);
      waits++;
      page = await b.observe();
    }
    log.push(`slow-wait ${page.text.includes("DONE: report ready") ? "PASS" : "FAIL"} waits=${waits} elapsed=${Math.round(performance.now() - w0)}ms`);
  } else {
    log.push("slow button NO TARGET");
  }
} catch (e: any) {
  log.push(`ERR ${e.message}`);
}

console.log(`[${Math.round(performance.now() - t0)}ms] ` + log.join(" || "));
await b.close().catch(() => {});
