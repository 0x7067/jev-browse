import { clockContext } from "./clock.ts";
import { compactObservations, observationViewport, OBSERVED_TEXT_SCOPE, type ProgressObservation } from "../agent/progress.ts";
import { trace } from "../trace.ts";

import { isJsonObject, isString } from "../json.ts";
import { ANSWER_VALUE, TEXT_VALUE } from "../questions.ts";
import { sleep } from "../sleep.ts";
import type { JsonObject, JsonValue, ObservedAction, PageState } from "../types.ts";
import { actionSpace } from "./space.ts";

class InvalidTextResponse extends Error {}

class TextModelRefusal extends Error {}

async function postJson(url: string, key: string, body: JsonValue): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;

    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
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

export function fieldContext(goal: string, action: ObservedAction, page: PageState, history: any[], observations: ProgressObservation[] = []) {
  return {
    ...clockContext(),
    goal,
    field: { label: action.label, role: action.role, value: action.value },
    observed_history: compactObservations(observations, []),
    other_fields: page.actions
      .filter((a) => a.kind === "fill" && a.node !== action.node)
      .slice(0, 20)
      .map((a) => ({ label: a.label, value: a.value ?? "" })),
    page: { title: page.title, url: page.url, text: page.text.slice(0, 6000), text_scope: OBSERVED_TEXT_SCOPE, viewport: observationViewport(page), excerpt_truncated: page.text.length > 6000 },
    recent_actions: history
      .slice(-6)
      .map((h) =>
        Object.fromEntries(["action", "text"].flatMap((k) => (k in h ? [[k, h[k]]] : []))),
      ),
  };
}

export async function helperJson(
  systemPrompt: string,
  context: JsonValue,
  requireKey: boolean,
  reason: boolean,
  modelOverride?: string,
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
  const model = modelOverride ?? process.env.TEXT_MODEL ?? "deepseek-chat";

  const reasoning = base.includes("api.deepseek.com/")
    ? { thinking: { type: "disabled" } }
    : { reasoning: reason ? { effort: "low" } : { enabled: false } };

  const started = performance.now();

  const result = await postJson(`${base}/chat/completions`, key, {
    model,
    max_tokens: 1024,
    response_format: { type: "json_object" },
    ...reasoning,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(context) },
    ],
  });

  trace("text_helper_response", { id: result.id, model, usage: result.usage, choices: result.choices, latency_ms: Math.round(performance.now() - started) });
  const choices: JsonValue = result.choices;
  const first = Array.isArray(choices) ? choices[0] : undefined;
  const message = isJsonObject(first) ? first.message : undefined;
  const content = isJsonObject(message) ? message.content : undefined;

  if (isJsonObject(message) && message.refusal !== undefined && message.refusal !== null) throw new TextModelRefusal("Text model refused the request");

  if (!isString(content) || !content.trim()) throw new InvalidTextResponse("Text model returned no message content");
  let output: JsonValue;

  try {
    output = JSON.parse(content);
  } catch {
    throw new InvalidTextResponse("Text model returned invalid JSON");
  }

  if (!isJsonObject(output)) throw new InvalidTextResponse("Text helper returned a non-object.");

  return {
    output,
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
    ({ output, helper } = await helperJson(TEXT_VALUE, context, true, false));
  } catch (error) {
    const msg = String(error);

    if (msg.includes("TEXT_MODEL_API_KEY") || msg.includes("not configured")) throw error;
    trace("text_helper_error", { error: msg });
    throw new Error(`Text helper returned no valid field value; nothing typed. ${msg}`);
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
  observations: ProgressObservation[] = [],
  feedback?: string,
  fallbackModel?: string,
): Promise<{ answer: string | null; helper: { model: string; latency_ms: number } }> {
  const elements = actionSpace(page.actions)
    .elements.map((e) => [e.label, e.value, e.checked, e.selected].filter(Boolean).join(" = "))
    .join("\n")
    .slice(0, 2000);

  const context = {
    ...clockContext(),
    goal,
    observed_history: compactObservations(observations, page.tables),
    review_feedback: feedback,
    page: { title: page.title, url: page.url, text: page.text.slice(0, 6000), text_scope: OBSERVED_TEXT_SCOPE, viewport: observationViewport(page), excerpt_truncated: page.text.length > 6000, elements, tables: page.tables ?? [], omitted_tables: page.omitted_tables ?? 0 },
  };

  let modelOverride: string | undefined;

  for (let attempt = 1; ; attempt++) {
    const lastAttempt = attempt === 2;
    let result: { output: JsonObject; helper: { model: string; latency_ms: number } };

    try {
      result = await helperJson(ANSWER_VALUE, context, false, true, modelOverride);

      if (Object.keys(result.output).join() !== "answer" || (result.output.answer !== null && !isString(result.output.answer))) {
        throw new InvalidTextResponse("Text model returned an invalid answer object");
      }
    } catch (error) {
      if (error instanceof TextModelRefusal || String(error).includes("not configured") || lastAttempt) throw error;

      if (error instanceof InvalidTextResponse && fallbackModel) {
        modelOverride = fallbackModel;
        trace("answer_generation_fallback", { model: fallbackModel, reason: error.message });
      }

      continue;
    }

    const value: JsonValue = result.output.answer;
    const text = isString(value) ? value.trim() : "";

    if (text || lastAttempt) return { answer: text || null, helper: result.helper };
  }
}

export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function atWordBoundary(haystack: string, needle: string): boolean {
  let i = haystack.indexOf(needle);

  while (i !== -1) {
    if (i === 0 || !/[\p{L}\p{N}]/u.test(haystack[i - 1])) return true;
    i = haystack.indexOf(needle, i + 1);
  }

  return false;
}
