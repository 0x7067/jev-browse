import { isJsonObject } from "./json.ts";
import type { JsonValue } from "./types.ts";

export function parseOutput(stdout: string): JsonValue {
  const text = stdout.trim();

  if (!text) return null;

  try {
    const parsed = JSON.parse(text);

    if (isJsonObject(parsed) && "success" in parsed) {
      if (parsed.success === false) {
        throw new Error(String(parsed.error ?? "agent-browser call failed").slice(0, 500));
      }

      return parsed.data;
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      const match = /[{[].*$/s.exec(text);

      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
        }
      }

      return text;
    }

    throw error;
  }
}
