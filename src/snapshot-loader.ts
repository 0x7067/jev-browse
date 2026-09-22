
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function loadSnapshotJs(): string {
  const path = fileURLToPath(new URL("./snapshot.js", import.meta.url));

  if (!existsSync(path)) {
    throw new Error(`jev-browse: snapshot.js not found at ${path}`);
  }

  return readFileSync(path, "utf8");
}
