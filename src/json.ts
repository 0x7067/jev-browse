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

/**
 * The part of a marker that survives node re-creation and ambient churn:
 * document identity, URL, title, visible text with digit runs collapsed,
 * offered controls by semantics (not node ids), and form state. A clock or
 * a virtual-DOM re-render must not read as a changed page; a navigation, a
 * content swap, or a status/result text update must.
 */
export function structureOf(marker: JsonValue): JsonValue {
  if (!Array.isArray(marker)) return null;

  const strip = (a: JsonValue) =>
    isJsonObject(a)
      ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== "node" && k !== "id"))
      : a;

  const controls = Array.isArray(marker[8]) ? marker[8].map(strip) : marker[8];
  // Digit runs carry most ambient text churn (clocks, counters, relative
  // times, prices). Collapse them so a real status/result text update —
  // "Processing" → "Report failed" — still breaks DONE freshness.
  const text = isString(marker[7]) ? marker[7].replace(/\p{N}+/gu, "#") : marker[7];

  return [marker[0], marker[1], marker[6], controls, marker[9], text];
}

/** Freshness compare shared by the drivers: "full" is the whole marker,
 *  "structure" ignores node ids, geometry, and digit-only text churn.
 *  ("page" compares the page key and never reaches here.) */
export function markerMatches(level: "full" | "structure", current: JsonValue, observed: JsonValue): boolean {
  const project = level === "structure" ? structureOf : (m: JsonValue) => m;

  return JSON.stringify(project(current)) === JSON.stringify(project(observed));
}
