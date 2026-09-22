import { existsSync, readFileSync } from "node:fs";

export function loadEnvFile(path, env) {
  if (!existsSync(path)) return env;

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);

    if (!m || line.trim().startsWith("#")) continue;

    if (env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }

  return env;
}
