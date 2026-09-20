/**
 * Driver probe: open a page, run a list of "label regex[:text]" actions
 * through the real CdpBrowser, print what each observation saw and how long
 * each phase took. For bisecting stress failures without the agent loop.
 *
 *   node scripts/stress/probe.mjs URL "Type a city:Lis" "^Lisbon$" "@scroll_down" "@press_end"
 */
import { CdpBrowser } from "../../src/cdp/browser.ts";

const [url, ...steps] = process.argv.slice(2);

const t0 = performance.now();

const ms = () => Math.round(performance.now() - t0);

const browser = await CdpBrowser.open(url, {});

let page = await browser.observe();

console.log(`observe#0 ${ms()}ms actions=${page.actions.length} text=${page.text.length}ch`);

for (const step of steps) {
  const [pattern, text] = step.startsWith("@") ? [step] : step.split(":");
  const strip = (l) => l.replace(/^\[[^\]]+\] /, "");

  const action = step.startsWith("@")
    ? page.actions.find((a) => a.id === step.slice(1))
    : page.actions.find((a) => (text ? a.kind === "fill" : a.kind !== "fill") && new RegExp(pattern, "i").test(strip(a.label)));

  if (!action) {
    console.log(`no action for ${step}; labels: ${page.actions.slice(0, 40).map((a) => `${a.kind}:${a.label}`).join(" | ")}`);
    break;
  }

  const a0 = ms();

  try {
    await browser.act(action, page, text ?? null);
  } catch (e) {
    console.log(`act ${action.kind}:${action.label} threw ${e.message}`);
    page = await browser.observe();
    continue;
  }

  const a1 = ms();
  const before = page;
  page = await browser.observe();
  const added = page.text.split("\n").filter((l) => !before.text.includes(l));
  console.log(`act ${action.kind}:${action.label} act=${a1 - a0}ms observe=${ms() - a1}ms changed=${page.fingerprint !== before.fingerprint} scrollY=${page.scroll.y} newText=${JSON.stringify(added.slice(0, 5))}`);
}

await browser.close();
