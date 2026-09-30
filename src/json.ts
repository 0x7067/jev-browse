import { trace } from "./trace.ts";
import { createHash } from "node:crypto";

import type { JsonObject, JsonValue, PageState } from "./types.ts";

export function isJsonObject(value: JsonValue): value is JsonObject {
  return value !== null && value !== undefined && !Array.isArray(value) && value === Object(value);
}

export const isString = (value: JsonValue): value is string => typeof value === "string";

export const isFiniteNumber = (value: JsonValue): value is number => Number.isFinite(value);

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

export function fingerprint(state: PageState): string {
  const content: JsonObject = {
    url: state.url,
    text: state.text,
    actions: state.actions.map(({ rect: _rect, ...action }) => action),
    scroll: state.scroll,
    frames: state.frames?.map(frame => ({ ...frame })),
    challenge_reasons: state.challenge_reasons,
    tables: state.tables,
    omitted_tables: state.omitted_tables,
  };

  return createHash("sha256").update(JSON.stringify(canonicalize(content))).digest("hex");
}

export function structureOf(marker: JsonValue, completion = false): JsonValue {
  if (!Array.isArray(marker)) return null;

  const strip = (a: JsonValue) =>
    isJsonObject(a)
      ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== "node" && k !== "id" && !(completion && k === "cls")).map(([k, v]) => [k, k === "label" && isString(v) ? v.replace(/\b\d{1,3}:\d{2}:\d{2}\b/g, "<clock>") : v]))
      : a;

  const controls = Array.isArray(marker[8]) ? marker[8].map(strip) : marker[8];
  const text = isString(marker[7]) ? marker[7].replace(/\p{N}+/gu, "#") : marker[7];

  return [marker[0], marker[1], marker[6], controls, marker[9], text, marker[10], marker[11], marker[12], marker[13], marker[14]];
}

export function markerMatches(level: "full" | "structure" | "completion", current: JsonValue, observed: JsonValue): boolean {
  const project = (marker: JsonValue) => level === "full" ? marker : structureOf(marker, level === "completion");

  const matches = JSON.stringify(project(current)) === JSON.stringify(project(observed));

  if (!matches) trace("freshness_mismatch", { level, current: project(current), observed: project(observed) });

  return matches;
}
