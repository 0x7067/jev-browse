/**
 * The text helper: a small OpenAI-compatible model writes field values for
 * TYPE_TEXT. Values are never guessed by the executor — no key, no typing.
 */

import { isString } from "../json.ts";
import { TEXT_VALUE } from "../questions.ts";
import type { JsonValue, ObservedAction, PageState } from "../types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson(url: string, key: string, body: JsonValue): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("Model connection failed; no action executed.");
    }

    if ([429, 529, 503].includes(response.status) && attempt < 2) {
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Model provider returned HTTP ${response.status}; no action executed.`);
    }

    return response.json();
  }

  throw new Error("Model unavailable");
}

export function fieldContext(goal: string, action: ObservedAction, page: PageState, history: any[]) {
  return {
    goal,
    field: { label: action.label, role: action.role, value: action.value },
    page: { title: page.title, text: page.text.slice(0, 6000) },
    recent_actions: history
      .slice(-6)
      .map((h) =>
        Object.fromEntries(["action", "text"].flatMap((k) => (k in h ? [[k, h[k]]] : []))),
      ),
  };
}

export async function fieldText(
  context: JsonValue,
): Promise<{ text: string; helper: { model: string; latency_ms: number; usage: JsonValue } }> {
  const key = process.env.TEXT_MODEL_API_KEY;

  if (!key) {
    throw new Error(
      "TYPE_TEXT needs TEXT_MODEL_API_KEY; no text is hardcoded or guessed by the executor.",
    );
  }

  const base = (process.env.TEXT_MODEL_BASE_URL ?? "https://api.deepseek.com/v1").replace(/\/+$/, "");
  const model = process.env.TEXT_MODEL ?? "deepseek-chat";

  const reasoning = base.includes("api.deepseek.com/")
    ? { thinking: { type: "disabled" } }
    : { reasoning: { effort: "low" } };

  const reasoningFinal = process.env.TEXT_MODEL_REASONING === "none" ? { reasoning: { enabled: false } } : reasoning;

  const started = performance.now();

  const result = await postJson(`${base}/chat/completions`, key, {
    model,
    max_tokens: 1024,
    response_format: { type: "json_object" },
    ...reasoningFinal,
    messages: [
      { role: "system", content: TEXT_VALUE },
      { role: "user", content: JSON.stringify(context) },
    ],
  });

  let text: string;

  try {
    const output = JSON.parse(result.choices[0].message.content);
    const value: JsonValue = output.text;

    if (
      Object.keys(output).join() !== "text" ||
      !isString(value) ||
      !value.trim() ||
      value.length > 2000
    ) {
      throw new Error();
    }

    text = value;
  } catch {
    throw new Error("Text helper returned no valid field value; nothing typed.");
  }

  return {
    text,
    helper: {
      model,
      latency_ms: Math.round(performance.now() - started),
      usage: result.usage ?? {},
    },
  };
}
