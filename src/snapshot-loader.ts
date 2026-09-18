// Load the page-state extractor (snapshot.js). Resolution order lets a bundled
// adapter find the copy installed beside the CLI even when the bundle itself
// sits in a directory where a sibling .js file would be loaded as a plugin
// (e.g. ~/.config/opencode/plugin/).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export function loadSnapshotJs(): string {
  const candidates = [
    fileURLToPath(new URL("./snapshot.js", import.meta.url)),
    join(homedir(), ".jev-browse", "install", "src", "snapshot.js"),
  ];

  for (const path of candidates) {
    if (existsSync(path)) return readFileSync(path, "utf8");
  }

  throw new Error(`jev-browse: snapshot.js not found (tried ${candidates.join(", ")})`);
}
