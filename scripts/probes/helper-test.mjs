import { readFileSync } from "node:fs";
const TEXT_VALUE = readFileSync("src/questions.ts","utf8").match(/TEXT_VALUE = `([^`]*)`/)[1];
const key = process.env.OPENROUTER_API_KEY;
const ctx = { goal: "Log in with username tomsmith and password SuperSecretPassword!, then stop when the secure area is shown.", field: { label: "Username", role: "textbox", value: "" }, page: { title: "The Internet", text: "Login Page This is where you can log into the secure area. Enter tomsmith for the username and SuperSecretPassword! for the password. Username Password Login" }, recent_actions: [] };
const ctx2 = { goal: "Search for 'rust async runtime' and open the first result.", field: { label: "Search", role: "searchbox", value: "" }, page: { title: "crates.io", text: "crates.io: Rust Package Registry Search Browse All Crates" }, recent_actions: [] };
async function call(model, context, reasoningOff=true){
  const t=performance.now();
  const body={model,max_tokens:1024,response_format:{type:"json_object"},...(reasoningOff?{reasoning:{enabled:false}}:{reasoning:{effort:"low"}}),messages:[{role:"system",content:TEXT_VALUE},{role:"user",content:JSON.stringify(context)}]};
  const r=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key}`},body:JSON.stringify(body)});
  const ms=Math.round(performance.now()-t);
  if(!r.ok) return {model,ms,http:r.status,err:(await r.text()).slice(0,120)};
  const j=await r.json(); const c=j.choices?.[0]?.message?.content; let parsed=null, valid=false;
  try{ parsed=JSON.parse(c); valid=Object.keys(parsed).join()==="text"&&typeof parsed.text==="string"&&parsed.text.trim().length>0; }catch{}
  return {model,ms,valid,text:parsed?.text,raw:valid?undefined:String(c).slice(0,100),finish:j.choices?.[0]?.finish_reason,tokens:j.usage?.completion_tokens,cost:j.usage?.cost};
}
const models=process.argv.slice(2);
for (const m of models){ const res=[]; for (let i=0;i<6;i++) res.push(await call(m, i%2?ctx2:ctx)); 
  const ok=res.filter(r=>r.valid).length; const lat=res.map(r=>r.ms).sort((a,b)=>a-b);
  console.log(`\n=== ${m}: valid ${ok}/6, latency min/med/max ${lat[0]}/${lat[3]}/${lat[5]} ms, cost/call ~$${(res.reduce((a,r)=>a+(r.cost||0),0)/6).toFixed(6)}`);
  for (const r of res) console.log("  ", JSON.stringify(r));
}
