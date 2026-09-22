import { join } from "node:path";

export function cliEntryPath(root) {
  return join(root, "bundled", "cli.mjs");
}
