
import { isString } from "../json.ts";
import { ANSWER_VALUE, TEXT_VALUE } from "../questions.ts";
import { actionSpace } from "./space.ts";
import type { JsonObject, JsonValue, ObservedAction, PageState } from "../types.ts";

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

async function helperJson(
  systemPrompt: string,
  context: JsonValue,
  requireKey: boolean,
): Promise<{ output: JsonObject; helper: { model: string; latency_ms: number; usage: JsonValue } }> {
  const key = process.env.TEXT_MODEL_API_KEY;

  if (!key) {
    if (requireKey) {
      throw new Error(
        "TYPE_TEXT needs TEXT_MODEL_API_KEY; no text is hardcoded or guessed by the executor.",
      );
    }

    throw new Error("Text helper is not configured.");
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
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(context) },
    ],
  });

  return {
    output: JSON.parse(result.choices[0].message.content),
    helper: {
      model,
      latency_ms: Math.round(performance.now() - started),
      usage: result.usage ?? {},
    },
  };
}

export async function fieldText(
  context: JsonValue,
): Promise<{ text: string; helper: { model: string; latency_ms: number; usage: JsonValue } }> {
  let output: JsonObject;
  let helper: { model: string; latency_ms: number; usage: JsonValue };

  try {
    ({ output, helper } = await helperJson(TEXT_VALUE, context, true));
  } catch (error) {
    const msg = String(error);

    if (msg.includes("TEXT_MODEL_API_KEY") || msg.includes("not configured")) throw error;
    throw new Error("Text helper returned no valid field value; nothing typed.");
  }

  const value: JsonValue = output.text;

  if (
    Object.keys(output).join() !== "text" ||
    !isString(value) ||
    !value.trim() ||
    value.length > 2000
  ) {
    throw new Error("Text helper returned no valid field value; nothing typed.");
  }

  return { text: value, helper };
}

export async function extractAnswer(
  goal: string,
  page: PageState,
): Promise<{ answer: string | null; helper: { model: string; latency_ms: number } }> {
  const elements = actionSpace(page.actions)
    .elements.map((e) => [e.label, e.value, e.checked, e.selected].filter(Boolean).join(" = "))
    .join("\n")
    .slice(0, 2000);

  const context = {
    goal,
    page: { title: page.title, url: page.url, text: page.text.slice(0, 6000), elements },
  };

  let output: JsonObject;
  let helper: { model: string; latency_ms: number };

  try {
    ({ output, helper } = await helperJson(ANSWER_VALUE, context, false));
  } catch (error) {
    if (String(error).includes("not configured")) throw error;
    ({ output, helper } = await helperJson(ANSWER_VALUE, context, false));
  }

  const value: JsonValue = output.answer;
  const text = isString(value) ? value.replace(/\s+/g, " ").trim().slice(0, 2000) : "";

  return { answer: text || null, helper };
}
