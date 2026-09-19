/**
 * The decision request: one systemOne call answers the operation and, in
 * parallel, a speculative target per compatible operation. Retries are
 * scoped — malformed answers retry once unchanged, context overflow retries
 * on a shrunken page state.
 */

import type { TypeSafeClient, Questions, ChoiceCriteria } from "@typesafe-ai/sdk";

import { isFiniteNumber, isString } from "../json.ts";
import { NEXT_ACTION, TARGET } from "../questions.ts";
import type { JsonValue, PageState } from "../types.ts";
import { actionSpace } from "./space.ts";

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

export interface Decision {
  choice: string;
  operation: string;
  target: string | null;
  /** Speculative next step, resolved against the post-action state. */
  follow_up?: string;
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
          ["role", "checked", "selected", "expanded", "cls"].flatMap((k) =>
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

  // Speculation: common sequences (type → pick suggestion, fill → submit)
  // can execute without a second decision round-trip when the model is
  // confident. Resolution is deferred to the post-action observation; an
  // unresolvable prediction falls back to a normal decide.
  const followUps: ChoiceCriteria = {
    NONE: "The next step can't be predicted confidently.",
    CLICK_MATCH_TYPED:
      "After typing, the next step is clicking the suggestion or result whose label contains the typed text.",
    PRESS_ENTER: "After this action, the next step is pressing Enter to submit.",
    DONE_AFTER: "This action completes every part of the goal.",
  };

  questions.follow_up = {
    type: "choice",
    criteria: followUps,
    instructions: {
      goal,
      rules: [
        "Predict what immediately follows the action you chose. Only pick a non-NONE prediction when the follow-up is a conventional, unambiguous consequence — autocomplete pick after typing, Enter to submit, or the goal is visibly complete.",
      ],
    },
  };

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

  // Speculation is best-effort: an absent or malformed follow-up is NONE,
  // never a reason to discard an otherwise valid decision.
  const followUpAnswer = answers.follow_up;

  const followUp =
    followUpAnswer &&
    isString(followUpAnswer.choice) &&
    followUpAnswer.choice in followUps
      ? followUpAnswer.choice
      : "NONE";

  return {
    choice,
    operation,
    target,
    follow_up: followUp,
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
