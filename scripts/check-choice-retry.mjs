import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { choiceRequest } from "../src/model/choice-request.ts";

let calls = 0;

let alwaysInvalid = false;

const server = createServer(async (req, res) => {
  for await (const chunk of req) void chunk;
  calls++;
  const invalid = alwaysInvalid || calls === 1;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ model: "fixture", answers: { result: { type: "choice", choice: "YES", probabilities: { YES: invalid ? 0.4 : 1, NO: invalid ? 0.6 : 0 }, confidence: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1, cost: 0 } }));
});

server.listen(0, "127.0.0.1");

await once(server, "listening");

const address = server.address();

assert(address && Object.hasOwn(address, "port"));

const client = new TypeSafeClient({ apiKey: "fixture-only", baseURL: `http://127.0.0.1:${address.port}` });

const request = { state: "fixture", questions: { result: { type: "choice", criteria: { YES: "yes", NO: "no" } } } };

try {
  const result = await choiceRequest(client, request, "check");
  assert.equal(calls, 2);
  assert.equal(result.answers.result.choice, "YES");
  assert.equal(result.answers.result.probabilities.YES, 1);
  alwaysInvalid = true;
  calls = 0;
  await assert.rejects(() => choiceRequest(client, request, "check"), /Invalid TypeSafe response/);
  assert.equal(calls, 2);
  console.log("choice-retry: corrected response accepted; persistent inconsistency rejected after two calls");
} finally {
  server.close();
}
