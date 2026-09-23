import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { TypeSafeClient, type TypeSafeClientConfig } from "@typesafe-ai/sdk";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

export function loadDotEnv(): void {
  for (const dir of [
    PACKAGE_ROOT,
    process.env.PLUGIN_DATA,
    process.env.CLAUDE_PLUGIN_DATA,
    process.cwd(),
  ]) {
    if (!dir) continue;
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

const PROVIDERS = {
  typesafe: {
    keyVar: "TYPESAFE_API_KEY",
    baseURL: "https://api.typesafe.ai",
    keysPage: "https://console.typesafe.ai/settings/keys",
  },
  openrouter: {
    keyVar: "OPENROUTER_API_KEY",
    baseURL: "https://openrouter.ai/api",
    keysPage: "https://openrouter.ai/settings/keys",
  },
} as const;

type Provider = keyof typeof PROVIDERS;

function isProvider(name: string): name is Provider {
  return Object.hasOwn(PROVIDERS, name);
}

function selectProvider(): Provider {
  const named = process.env.JEV_PROVIDER;

  if (named === undefined || named === "") {
    return process.env.TYPESAFE_API_KEY || !process.env.OPENROUTER_API_KEY
      ? "typesafe"
      : "openrouter";
  }

  if (!isProvider(named)) {
    throw new Error(
      `JEV_PROVIDER must be one of ${Object.keys(PROVIDERS).join(", ")}; got ${named}`,
    );
  }

  return named;
}

function providerConfig(): Pick<TypeSafeClientConfig, "apiKey" | "baseURL"> {
  const provider = PROVIDERS[selectProvider()];
  const apiKey = process.env[provider.keyVar];

  if (!apiKey) {
    throw new Error(`${provider.keyVar} is not set. Get a key at ${provider.keysPage}`);
  }

  return { apiKey, baseURL: process.env.TYPESAFE_BASE_URL || provider.baseURL };
}

export function makeClient(): TypeSafeClient {
  loadDotEnv();

  return new TypeSafeClient({
    ...providerConfig(),
    defaultModel: process.env.TYPESAFE_MODEL ?? "jev-latest",
  });
}
