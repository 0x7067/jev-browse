import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
import { CdpBrowser } from "../../src/cdp/browser.ts";
process.env.JEV_ALLOW_FILE_URLS="1";
const FX="file://"+new URL("../../fixture-interactions.html", import.meta.url).pathname;
async function fresh(url:string){ process.env.JEV_PROFILE = mkdtempSync(join(tmpdir(),"jev-m3-")); return CdpBrowser.open(url,{}); }
{ const b=await fresh(FX); let p=await b.observe(); const src=p.actions.find(a=>a.draggable)!, dst=p.actions.find(a=>a.dropZone)!;
  const t=performance.now(); await b.act({...src,kind:"drag",dragTo:dst.node},p,null); await new Promise(r=>setTimeout(r,250)); p=await b.observe();
  console.log(`drag [${src.label}]->[${dst.label}] ${Math.round(performance.now()-t)}ms -> ${/DONE: postcard dropped/.test(p.text)?"PASS":"FAIL"}`); await b.close(); }
{ const b=await fresh(FX); let p=await b.observe(); const c=p.actions.find(a=>a.contextMenu)!;
  const t=performance.now(); await b.act({...c,kind:"context"},p,null); await new Promise(r=>setTimeout(r,250)); p=await b.observe();
  console.log(`context [${c.label}] ${Math.round(performance.now()-t)}ms -> ${/DONE: context menu opened/.test(p.text)?"PASS":"FAIL"}`); await b.close(); }
{ const b=await fresh(FX); let p=await b.observe(); const d=p.actions.find(a=>/Download fixture-report/.test(a.label))!;
  await b.act(d,p,null); await new Promise(r=>setTimeout(r,800)); p=await b.observe();
  console.log(`download [${d.label}] -> downloads=${JSON.stringify(p.downloads)} ${p.downloads?.some(f=>/fixture-report/.test(f))?"PASS":"FAIL"}`); await b.close(); }
{ const b=await fresh(FX); let p=await b.observe(); const f=p.actions.find(a=>/Type then press Enter/.test(a.label)&&a.kind==="fill")!;
  await b.act(f,p,"palette query"); p=await b.observe(); const enter=p.actions.find(a=>a.kind==="press"&&/enter/i.test(a.key??a.label))!;
  await b.act(enter,p,null); await new Promise(r=>setTimeout(r,250)); p=await b.observe();
  console.log(`type+enter focused=${p.focused} -> ${/DONE/.test(p.text.slice(p.text.indexOf("Type then")))?"PASS?":"see"} text=${p.text.replace(/\s+/g," ").match(/DONE[^ ]* ?[^.]{0,30}/g)?.join(";")}`); await b.close(); }
{ // SPA hydration race: crates.io
  const b=await fresh("https://crates.io/"); const t=performance.now(); let p=await b.observe(); const first={ms:Math.round(performance.now()-t),txt:p.text.length,acts:p.actions.length,pending:p.pending_requests};
  await new Promise(r=>setTimeout(r,3000)); p=await b.observe(); console.log(`crates first=${JSON.stringify(first)} after3s={txt:${p.text.length},acts:${p.actions.length},pending:${p.pending_requests}} head="${p.text.slice(0,80).replace(/\s+/g," ")}"`); await b.close(); }
