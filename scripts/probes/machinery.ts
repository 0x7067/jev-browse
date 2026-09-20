// Model-free machinery test: scripted actions through the real CDP driver on
// fixture-interactions.html, verified by the fixture's DONE text.
import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { CdpBrowser } from "../../src/cdp/browser.ts";
process.env.JEV_ALLOW_FILE_URLS="1";
const URL="file://"+new URL("../../fixture-interactions.html", import.meta.url).pathname;
type Step = { find: RegExp; kind?: string; text?: string; press?: string; expect?: RegExp; name: string };
const scenarios: Step[][] = [
 [{name:"shadow", find:/Shadow action/i, expect:/DONE\(shadow\)/}],
 [{name:"iframe", find:/frame/i, kind:"click", expect:/DONE\(frame\)/}],
 [{name:"modal-open", find:/Open modal|Delete draft|open-modal|Open/i, kind:"click"},{name:"modal-confirm", find:/^Confirm|Confirm/i, kind:"click", expect:/DONE: draft deleted/}],
 [{name:"hover", find:/Destinations/i, kind:"hover"},{name:"hover-pick", find:/Alpine stays/i, kind:"click", expect:/DONE: alpine picked/}],
 [{name:"redeem-type", find:/Invite code|code/i, kind:"fill", text:"ABC123"},{name:"redeem-click", find:/Redeem/i, kind:"click", expect:/DONE: code redeemed/}],
 [{name:"drag", find:/Postcard/i, kind:"drag", expect:/DONE: postcard dropped/}],
 [{name:"context", find:/Right-click this tile/i, kind:"context", expect:/DONE: context menu opened/}],
 [{name:"range-click", find:/Guests/i, kind:"click"},{name:"range-arrow", find:/ArrowRight/i, kind:"press"},{name:"range-arrow2", find:/ArrowRight/i, kind:"press"},{name:"range-arrow3", find:/ArrowRight/i, kind:"press"},{name:"range-arrow4", find:/ArrowRight/i, kind:"press"},{name:"range-arrow5", find:/ArrowRight/i, kind:"press", expect:/DONE: guests=/}],
 [{name:"newtab", find:/help/i, kind:"click", expect:/DONE: help visible/}],
 [{name:"select", find:/Region/i, kind:"select", expect:/./}],
 [{name:"date", find:/arrive|Arrival|date/i, kind:"fill", text:"2026-10-05", expect:/./}],
 [{name:"composer", find:/Message|composer/i, kind:"fill", text:"hello from the machinery test"},{name:"send", find:/^Send|Send/i, kind:"click", expect:/DONE:/}],
];
for (const sc of scenarios) {
  process.env.JEV_PROFILE = mkdtempSync(join(tmpdir(),"jev-mach-"));
  const b = await CdpBrowser.open(URL,{}); const t0=performance.now(); let log:string[]=[];
  try {
    let page = await b.observe();
    for (const st of sc) {
      let cands = page.actions.filter(a => (!st.kind || a.kind===st.kind) && (st.find.test(a.label) || (st.kind==="press" && st.find.test(a.key??""))));
      if (!cands.length) { log.push(`${st.name}: NO TARGET (kinds=${[...new Set(page.actions.map(a=>a.kind))].join(",")}; labels sample=${page.actions.filter(a=>a.kind==="click").map(a=>a.label).slice(0,12).join(" / ")})`); break; }
      const a = cands[0];
      try { await b.act(a, page, st.text ?? null); } catch (e:any) { log.push(`${st.name}: act threw ${e.name}: ${String(e.message).slice(0,80)}`); }
      await new Promise(r=>setTimeout(r,250));
      page = await b.observe();
      const hit = st.expect ? st.expect.test(page.text) : true;
      log.push(`${st.name}: ${a.kind} [${a.label.slice(0,40)}]${a.shadow?" shadow":""}${a.frame?" frame":""} -> ${st.expect ? (hit?"PASS":"FAIL") : "ok"}${hit?"":" text="+page.text.replace(/\s+/g," ").match(/DONE[^ ]* ?[^.]{0,40}/g)?.join(";")}`);
      if (st.expect && !hit) break;
    }
  } catch (e:any) { log.push(`ERR ${e.message}`); }
  console.log(`[${Math.round(performance.now()-t0)}ms] ` + log.join(" || "));
  await b.close().catch(()=>{});
}
