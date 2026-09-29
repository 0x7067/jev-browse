import assert from "node:assert/strict";
import { rememberObservation, OBSERVATION_LIMIT } from "../src/agent/progress.ts";

const page = (url, lines, y = 0) => ({
  url,
  title: url,
  text: lines.join("\n"),
  h: 800,
  scroll: { y, height: 6000 },
  tables: [],
  omitted_tables: 0,
  actions: [],
  omitted_actions: 0,
  frames: [],
  fingerprint: `${url}#${y}`,
});

const chrome = ["Models", "Datasets", "Spaces", "Docs", "Pricing", "Log in", "Sign up"];

const observations = [];

let step = 0;

rememberObservation(observations, page("https://hub.example/", [...chrome, "The platform where the community collaborates", "Trending models"]), step++);

rememberObservation(observations, page("https://hub.example/pricing", [...chrome, "PRO account $9 per month", "Enterprise Hub $20 per user per month", "Inference credits included"]), step++);

for (let y = 0; y < 12; y++) {
  rememberObservation(observations, page("https://hub.example/docs", [...chrome, "Documentation", `Section ${y} overview`, "Getting started guide"], y * 700), step++);
}

assert.equal(observations.length, OBSERVATION_LIMIT);

assert.equal(observations[0].url, "https://hub.example/");

assert.ok(observations.some(o => o.text.includes("PRO account $9 per month")), "unique pricing evidence must survive later low-novelty observations");

assert.equal(observations.at(-1).after_step, step - 1, "newest observation is always kept");

const order = observations.map(o => o.after_step);

assert.deepEqual(order, [...order].sort((a, b) => a - b), "retained observations stay chronological");

const loop = [];

for (let i = 0; i < 20; i++) rememberObservation(loop, page(`https://site.example/p${i % 3}`, [...chrome, `Page ${i % 3} body`], 0), i);

assert.equal(loop.length, OBSERVATION_LIMIT);

assert.equal(loop.at(-1).after_step, 19);

for (const variant of [0, 1, 2]) assert.ok(loop.some(o => o.url.endsWith(`p${variant}`)), "each distinct page in a cycle keeps a representative");

console.log(JSON.stringify({ ok: true, retained: observations.map(o => [o.after_step, o.url]) }));
