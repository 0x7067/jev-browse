/**
 * TypeSafe makes choices; an optional small OpenAI-compatible model writes
 * field values. Ported from jev-ultrafast's model.py.
 */

import type { TypeSafeClient, Questions, ChoiceCriteria } from "@typesafe-ai/sdk";

import { NEXT_ACTION, TARGET, TEXT_VALUE } from "./questions.ts";
import type { ObservedAction, PageState } from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postJson(url: string, key: string, body: unknown): Promise<any> {
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
  choice?: unknown;
  confidence?: unknown;
  probabilities?: Record<string, unknown>;
}

export function validateChoice(answer: RawChoiceAnswer, ids: Set<string>): asserts answer is {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
} {
  const probabilities = answer?.probabilities;
  const numbers = [...Object.values(probabilities ?? {}), answer?.confidence];

  const sum = Object.values(probabilities ?? {}).reduce(
    (a: number, b) => a + (typeof b === "number" ? b : NaN),
    0,
  );

  const valid =
    typeof answer?.choice === "string" &&
    ids.has(answer.choice) &&
    !!probabilities &&
    Object.keys(probabilities).length === ids.size &&
    Object.keys(probabilities).every((k) => ids.has(k)) &&
    numbers.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) &&
    Math.abs(sum - 1) < 0.02 &&
    (probabilities[answer.choice] as number) >=
      Math.max(...Object.values(probabilities).map(Number)) - 1e-6;

  if (!valid) {
    throw new Error("Invalid TypeSafe response; no action executed.");
  }
}

/** One index per observed element; each operation has its own valid target choices. */
export function actionSpace(actions: ObservedAction[]) {
  const elements: any[] = [];
  const indices = new Map<number, string>();
  const targets: Record<string, Record<string, ObservedAction>> = {};
  const controls: Record<string, ObservedAction> = {};

  const operations: Record<string, string> = {
    click: "CLICK",
    fill: "TYPE_TEXT",
    select: "SELECT",
    hover: "HOVER",
  };

  for (const action of actions) {
    const kind = action.kind;

    if (!(kind in operations)) {
      controls[action.id.toUpperCase()] = action;
      continue;
    }

    const node = action.node!;
    let index = indices.get(node);

    if (index === undefined) {
      index = String(elements.length + 1);
      indices.set(node, index);
      const element: any = {};

      for (const k of ["role", "value", "checked", "selected", "expanded"] as const) {
        if (k in action) element[k] = action[k];
      }

      element.index = index;
      element.label = action.label.split(" → ")[0];
      element.operations = [] as string[];

      if (kind === "select") {
        element.value = action.current_value ?? "";
        element.options = [] as any[];
      }

      elements.push(element);
    }

    const operation = operations[kind];
    const group = (targets[operation] ??= {});
    const element = elements[Number(index) - 1];

    if (!element.operations.includes(operation)) element.operations.push(operation);
    let target = index;

    if (kind === "select") {
      target = `${index}:${element.options.length + 1}`;
      element.options.push({ index: target, label: action.label, value: action.value });
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

export async function choose(
  client: TypeSafeClient,
  state: PageState,
  goal: string,
  history: any[],
): Promise<Decision> {
  const { elements, targets, controls } = actionSpace(state.actions);

  const labels: Record<string, string> = {
    CLICK: "Click an element, button, menu option, autocomplete suggestion, or calendar day.",
    TYPE_TEXT:
      "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
    SELECT: "Select an observed dropdown value.",
    HOVER: "Hover over an element to reveal menus, tooltips, or hover-only controls.",
  };

  const operations: ChoiceCriteria = {};

  for (const key of Object.keys(targets)) operations[key] = labels[key];

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

  const answers = result.answers as Record<string, any>;
  const operationAnswer = answers.operation ?? {};
  validateChoice(operationAnswer, new Set(Object.keys(operations)));
  const operation = operationAnswer.choice;

  let target: string | null = null;
  let targetAnswer: any = null;
  let probabilities: Record<string, number> = {};
  let choice: string;

  if (operation in targets) {
    // Unused target heads cannot cause an action. Validate the selected head only.
    targetAnswer = answers[`${operation.toLowerCase()}_target`] ?? {};
    validateChoice(targetAnswer, new Set(Object.keys(targets[operation])));
    target = targetAnswer.choice;
    choice = targets[operation][target].id;

    for (const [index, a] of Object.entries(targets[operation])) {
      probabilities[a.id] = targetAnswer.probabilities[index];
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
    target_probabilities: targetAnswer?.probabilities ?? {},
    target_confidence: targetAnswer?.confidence ?? null,
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
  context: unknown,
): Promise<{ text: string; helper: { model: string; latency_ms: number; usage: unknown } }> {
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

  let value: unknown;

  try {
    const output = JSON.parse(result.choices[0].message.content);
    value = output.text;

    if (
      Object.keys(output).join() !== "text" ||
      typeof value !== "string" ||
      !value.trim() ||
      value.length > 2000
    ) {
      throw new Error();
    }
  } catch {
    throw new Error("Text helper returned no valid field value; nothing typed.");
  }

  return {
    text: value,
    helper: {
      model,
      latency_ms: Math.round(performance.now() - started),
      usage: result.usage ?? {},
    },
  };
}
