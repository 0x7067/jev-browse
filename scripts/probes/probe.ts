// Model-free probe: open every task URL through the CDP driver, observe once,
// and record reachability + extractor stats. No Jev, no text model.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpBrowser } from "../../src/cdp/browser.ts";
const ROOT=new URL("../..", import.meta.url).pathname;
const files = ["tasks.json","tasks-hard.json","tasks-harder.json","tasks-hardest.json"];
const seen = new Set<string>(); const rows:any[] = [];
for (const f of files) for (const t of JSON.parse(readFileSync(join(ROOT,"evals",f),"utf8"))) {
  const url = t.file_url ? `file://${join(ROOT,t.url)}` : t.url;
  if (seen.has(url)) continue; seen.add(url);
  process.env.JEV_PROFILE = mkdtempSync(join(tmpdir(),"jev-probe-"));
  if (t.file_url) process.env.JEV_ALLOW_FILE_URLS="1";
  const started = performance.now(); let b: CdpBrowser|null=null; const row:any={tier:f,id:t.id,url};
  try {
    b = await Promise.race([CdpBrowser.open(url,{}), new Promise<never>((_,rej)=>setTimeout(()=>rej(new Error("open timeout 40s")),40000))]) as CdpBrowser;
    const p = await b.observe();
    const roles:Record<string,number>={}; for (const a of p.actions) roles[a.role??a.kind]=(roles[a.role??a.kind]??0)+1;
    Object.assign(row,{ok:true,ms:Math.round(performance.now()-started),final_url:p.url,title:p.title,actions:p.actions.length,omitted:p.omitted_actions,text_chars:p.text.length,challenge:p.challenge??false,pending:p.pending_requests,shadow:p.actions.filter(a=>a.shadow).length,framed:p.actions.filter(a=>a.frame).length,roles,text_head:p.text.slice(0,140).replace(/\s+/g," ")});
  } catch (e:any) { Object.assign(row,{ok:false,ms:Math.round(performance.now()-started),error:String(e?.message??e).slice(0,160)}); }
  try { await b?.close(); } catch {}
  console.log(JSON.stringify(row));
  rows.push(row);
}
writeFileSync(new URL("../../evals/results/probe-urls.json", import.meta.url).pathname, JSON.stringify(rows,null,1));
