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
  };

  return createHash("sha256").update(JSON.stringify(canonicalize(content))).digest("hex");
}

export function structureOf(marker: JsonValue): JsonValue {
  if (!Array.isArray(marker)) return null;

  const strip = (a: JsonValue) =>
    isJsonObject(a)
      ? Object.fromEntries(Object.entries(a).filter(([k]) => k !== "node" && k !== "id"))
      : a;

  const controls = Array.isArray(marker[8]) ? marker[8].map(strip) : marker[8];
  const text = isString(marker[7]) ? marker[7].replace(/\p{N}+/gu, "#") : marker[7];

  return [marker[0], marker[1], marker[6], controls, marker[9], text];
}

export function markerMatches(level: "full" | "structure", current: JsonValue, observed: JsonValue): boolean {
  const project = level === "structure" ? structureOf : (m: JsonValue) => m;

  return JSON.stringify(project(current)) === JSON.stringify(project(observed));
}
