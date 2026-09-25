import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const dir = join(root, "src", "snapshot");

const parts = readdirSync(dir)
  .filter((f) => f.endsWith(".js"))
  .sort()
  .map((f) => readFileSync(join(dir, f), "utf8").trimEnd());

writeFileSync(join(root, "src", "snapshot.js"), `(() => {\n${parts.join("\n\n")}\n})()\n`);
