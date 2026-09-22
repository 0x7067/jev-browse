import { join } from "node:path";

/** Same entrypoint installed users get via the `jev-browse` bin. */
export function cliEntryPath(root) {
  return join(root, "bundled", "cli.mjs");
}
