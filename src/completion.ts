import { isJsonObject, isString } from "./json.ts";
import { stateSummary } from "./agent/observe.ts";
import type { JsonValue, PageState } from "./types.ts";

const KEYS = ["url_match", "text_match", "state_match", "frames_match"] as const;

export type CompletionExpectation = Partial<Record<(typeof KEYS)[number], string>>;

export function parseExpectation(value: JsonValue): CompletionExpectation {
  if (!isJsonObject(value) || !Object.keys(value).length) {
    throw new Error("--expect requires a nonempty object of completion patterns");
  }

  if (Object.keys(value).some(key => !KEYS.some(allowed => key === allowed))) {
    throw new Error(`Completion patterns support only ${KEYS.join(", ")}`);
  }

  const expectation: CompletionExpectation = {};

  for (const key of KEYS) {
    const pattern = value[key];

    if (pattern === undefined) continue;

    if (!isString(pattern) || !pattern.length) throw new Error(`${key} must be a nonempty regex string`);
    new RegExp(pattern);
    expectation[key] = pattern;
  }

  return expectation;
}

export function completionEvidence(page: PageState, expectation: CompletionExpectation) {
  const actual = {
    url_match: page.url,
    text_match: page.text.replace(/\s+/g, " "),
    state_match: stateSummary(page).replace(/\s+/g, " "),
    frames_match: JSON.stringify(page.frames ?? []),
  };

  return KEYS.flatMap(key => {
    const pattern = expectation[key];

    return pattern === undefined ? [] : [{ key, pattern, actual: actual[key], matched: new RegExp(pattern).test(actual[key]) }];
  });
}
