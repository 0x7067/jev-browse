import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { TypeSafeClient } from "@typesafe-ai/sdk";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

// Fill missing keys from .env (package dir first, then cwd). Shell exports win.
export function loadDotEnv(): void {
  for (const dir of [PACKAGE_ROOT, process.cwd()]) {
    let text: string;

    try {
      text = readFileSync(join(dir, ".env"), "utf8");
    } catch {
      continue;
    }

    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();

      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");

      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

export function makeClient(): TypeSafeClient {
  loadDotEnv();

  if (!process.env.TYPESAFE_API_KEY) {
    throw new Error(
      "TYPESAFE_API_KEY is not set. Get a key at https://console.typesafe.ai/settings/keys",
    );
  }

  return new TypeSafeClient({ defaultModel: process.env.TYPESAFE_MODEL ?? "jev-latest" });
}
