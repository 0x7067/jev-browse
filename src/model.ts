/**
 * TypeSafe makes choices; an optional small OpenAI-compatible model writes
 * field values. Ported from jev-ultrafast's model.py.
 */

import type { TypeSafeClient, Questions, ChoiceCriteria } from "@typesafe-ai/sdk";

import { isFiniteNumber, isString } from "./json.ts";
import { NEXT_ACTION, TARGET, TEXT_VALUE } from "./questions.ts";
import type { ActionKind, JsonValue, ObservedAction, PageState } from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Pre-establish TLS/HTTP2 to the model endpoints while the browser still
 * launches and navigates — the first real request then skips the handshake.
 * Fire-and-forget; failures are irrelevant.
 */
export function warmModelEndpoints(): void {
  const origins = new Set<string>();

  for (const raw of [
    process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai",
    process.env.TEXT_MODEL_BASE_URL,
  ]) {
    try {
      if (raw) origins.add(new URL(raw).origin);
    } catch {
      // unparseable env — the real request will surface it
    }
  }

  for (const origin of origins) {
    fetch(origin, { method: "HEAD" })
      .then((r) => r.arrayBuffer())
      .catch(() => {});
  }
}

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

interface RawChoiceAnswer {
  choice?: JsonValue;
  confidence?: JsonValue;
  probabilities?: Record<string, JsonValue>;
}

export function validateChoice(answer: RawChoiceAnswer, ids: Set<string>): asserts answer is {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
} {
  const probabilities = answer?.probabilities;
  const choice = answer?.choice;
  const values = Object.values(probabilities ?? {});

  const sum = values.reduce((a: number, b) => a + (isFiniteNumber(b) ? b : NaN), 0);
  const chosen = isString(choice) && probabilities !== undefined ? probabilities[choice] : undefined;

  const valid =
    isString(choice) &&
    ids.has(choice) &&
    probabilities !== undefined &&
    Object.keys(probabilities).length === ids.size &&
    Object.keys(probabilities).every((k) => ids.has(k)) &&
    [...values, answer?.confidence].every(
      (n) => isFiniteNumber(n) && n >= 0 && n <= 1,
    ) &&
    Math.abs(sum - 1) < 0.02 &&
    isFiniteNumber(chosen) &&
    chosen >= Math.max(...values.map(Number)) - 1e-6;

  if (!valid) {
    throw new Error("Invalid TypeSafe response; no action executed.");
  }
}

/** One index per observed element; each operation has its own valid target choices. */
/** One candidate element as presented to the choice model. */
type ElementChoice = {
  index: string;
  label: string;
  operations: string[];
  role?: string;
  value?: string;
  checked?: string;
  selected?: string;
  expanded?: string;
  options?: { index: string; label: string; value: JsonValue }[];
};

export function actionSpace(actions: ObservedAction[]) {
  const elements: any[] = [];
  const indices = new Map<number, string>();
  const targets: Record<string, Record<string, ObservedAction>> = {};
  const controls: Record<string, ObservedAction> = {};

  const operations: Partial<Record<ActionKind, string>> = {
    click: "CLICK",
    fill: "TYPE_TEXT",
    select: "SELECT",
    hover: "HOVER",
  };

  for (const action of actions) {
    const kind = action.kind;
    const operation = operations[kind];

    if (operation === undefined) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }

    const node = action.node!;
    let index = indices.get(node);

    if (index === undefined) {
      index = String(elements.length + 1);
      indices.set(node, index);

      const element: ElementChoice = {
        index,
        label: action.label.split(" → ")[0],
        operations: [],
      };

      for (const k of ["role", "value", "checked", "selected", "expanded"] as const) {
        const v = action[k];

        if (v !== undefined) element[k] = v;
      }

      if (kind === "select") {
        element.value = action.current_value ?? "";
        element.options = [];
      }

      elements.push(element);
    }

    const group = (targets[operation] ??= {});
    const element = elements[Number(index) - 1];

    if (!element.operations.includes(operation)) element.operations.push(operation);
    let target = index;

    if (kind === "select") {
      const options = (element.options ??= []);
      target = `${index}:${options.length + 1}`;
      options.push({ index: target, label: action.label, value: action.value });
    }

    group[target] = action;
  }

  return { elements, targets, controls };
}

export interface Decision {
  choice: string;
  operation: string;
  target: string | null;
  confidence: number;
  probabilities: Record<string, number>;
  operation_probabilities: Record<string, number>;
  target_probabilities: Record<string, number>;
  target_confidence: number | null;
  raw_answers: unknown;
  model: string;
  usage: unknown;
  latency_ms: number;
}

/**
 * Shrink the decision input for context-limit retries. Element ids are bound
 * to DOM nodes (not positions), so trimming the offered set stays consistent —
 * but node-less controls (scroll/wait/back/press) must all survive the cut.
 */
function shrunkState(state: PageState, textCap: number, actionCap: number): PageState {
  const elements = state.actions.filter((a) => a.node !== undefined);
  const controls = state.actions.filter((a) => a.node === undefined);

  return {
    ...state,
    text: state.text.slice(0, textCap),
    actions: [...elements.slice(0, actionCap), ...controls],
  };
}

export async function choose(
  client: TypeSafeClient,
  state: PageState,
  goal: string,
  history: any[],
): Promise<Decision> {
  const attempts = [state, shrunkState(state, 2500, 40), shrunkState(state, 1000, 20)];
  let invalidRetried = false;

  for (let i = 0; i < attempts.length; i++) {
    try {
      return await chooseOnce(client, attempts[i], goal, history);
    } catch (error) {
      const msg = String(error);

      // A malformed answer hasn't mutated anything — one fresh ask is safe.
      if (msg.includes("Invalid TypeSafe response") && !invalidRetried) {
        invalidRetried = true;
        i--;
        continue;
      }

      // Context overflow: the next attempt offers less state.
      if (/max_tokens|context|too (large|long|many)/i.test(msg) && i + 1 < attempts.length) continue;

      throw error;
    }
  }

  throw new Error("unreachable");
}

async function chooseOnce(
  client: TypeSafeClient,
  state: PageState,
  goal: string,
  history: any[],
): Promise<Decision> {
  const { elements, targets, controls } = actionSpace(state.actions);

  const labels = new Map([
    ["CLICK", "Click an element, button, menu option, autocomplete suggestion, or calendar day."],
    [
      "TYPE_TEXT",
      "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
    ],
    ["SELECT", "Select an observed dropdown value."],
    ["HOVER", "Hover over an element to reveal menus, tooltips, or hover-only controls."],
  ]);

  const operations: ChoiceCriteria = {};

  for (const key of Object.keys(targets)) {
    const label = labels.get(key);

    if (label !== undefined) operations[key] = label;
  }

  for (const [key, value] of Object.entries(controls)) operations[key] = value.label;
  operations.DONE = "Every requirement is visibly satisfied.";
  operations.BLOCKED = "No supported operation can progress.";

  const questions: Questions = {
    operation: {
      type: "choice",
      criteria: operations,
      instructions: { goal, rules: NEXT_ACTION },
    },
  };

  for (const [operation, candidates] of Object.entries(targets)) {
    const criteria: ChoiceCriteria = {};

    for (const [index, a] of Object.entries(candidates)) {
      criteria[index] = {
        element: `[${index}] ${a.label}`,
        current_value: a.current_value ?? a.value ?? "",
        ...Object.fromEntries(
          ["role", "checked", "selected", "expanded"].flatMap((k) =>
            k in a ? [[k, a[k]]] : [],
          ),
        ),
      };
    }

    questions[`${operation.toLowerCase()}_target`] = {
      type: "choice",
      criteria,
      instructions: { goal, operation, rules: [NEXT_ACTION, TARGET] },
    };
  }

  const started = performance.now();

  const result = await client.systemOne({
    state: {
      page: { url: state.url, title: state.title, text: state.text },
      elements,
      recent_actions: history
        .slice(-10)
        .map((h) =>
          Object.fromEntries(
            ["action", "kind", "text", "page_changed"].flatMap((k) =>
              k in h ? [[k, h[k]]] : [],
            ),
          ),
        ),
    },
    questions,
  });

  // SAFETY: systemOne answers are free-form per question name; validateChoice decodes the used fields.
  const answers = result.answers as Record<string, RawChoiceAnswer>;
  const operationAnswer = answers.operation ?? {};
  validateChoice(operationAnswer, new Set(Object.keys(operations)));
  const operation = operationAnswer.choice;

  let target: string | null = null;
  let targetProbabilities: Record<string, number> = {};
  let targetConfidence: number | null = null;
  let probabilities: Record<string, number> = {};
  let choice: string;

  if (operation in targets) {
    // Unused target heads cannot cause an action. Validate the selected head only.
    const answer = answers[`${operation.toLowerCase()}_target`] ?? {};
    validateChoice(answer, new Set(Object.keys(targets[operation])));
    target = answer.choice;
    targetProbabilities = answer.probabilities;
    targetConfidence = answer.confidence;
    choice = targets[operation][target].id;

    for (const [index, a] of Object.entries(targets[operation])) {
      probabilities[a.id] = answer.probabilities[index];
    }
  } else {
    choice = operation in controls ? controls[operation].id : operation;
    probabilities[choice] = operationAnswer.probabilities[operation];
  }

  return {
    choice,
    operation,
    target,
    confidence: operationAnswer.confidence,
    probabilities,
    operation_probabilities: operationAnswer.probabilities,
    target_probabilities: targetProbabilities,
    target_confidence: targetConfidence,
    raw_answers: answers,
    model: result.model,
    usage: result.usage,
    latency_ms: Math.round(performance.now() - started),
  };
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
