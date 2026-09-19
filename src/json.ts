import { createHash } from "node:crypto";

import type { JsonObject, JsonValue, PageState } from "./types.ts";

/** JSON.parse emits only plain objects and arrays; primitives and null fail Object(). */
export function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && value !== undefined && !Array.isArray(value) && value === Object(value);
}

export const isString = (value: JsonValue): value is string => typeof value === "string";

/** Finite numbers only: NaN and Infinity are not JSON-representable quantities. */
export const isFiniteNumber = (value: JsonValue): value is number => Number.isFinite(value);

/** Deep-sort object keys so the fingerprint is insensitive to key order. */
const canonicalize = (value: JsonValue): JsonValue =>
  Array.isArray(value)
    ? value.map(canonicalize)
    : isJsonObject(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonicalize(value[k])]),
        )
      : value;

/** Stable hash over the state fields that define page identity for freshness checks. */
export function fingerprint(state: PageState): string {
  const content: JsonObject = {
    url: state.url,
    text: state.text,
    // Marker parity: geometry is resolved and hit-tested at input time, so
    // layout jitter between observations must not move the fingerprint.
    actions: state.actions.map(({ rect: _rect, ...action }) => action),
    scroll: state.scroll,
  };

  return createHash("sha256").update(JSON.stringify(canonicalize(content))).digest("hex");
}
