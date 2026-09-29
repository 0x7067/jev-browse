import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "jev-eval-accounting-"));

try {
  for (const directory of ["scripts/lib", "bundled", "evals"]) mkdirSync(join(root, directory), { recursive: true });

  for (const file of ["eval.mjs", "lib/cli-entry.mjs", "lib/dates.mjs", "lib/env.mjs"]) {
    copyFileSync(new URL(file, import.meta.url), join(root, "scripts", file));
  }

  writeFileSync(join(root, "evals/tasks.json"), JSON.stringify([{ id: "error-case", url: "https://example.com", goal: "Open the menu", expect: { text_match: "Menu open" } }]));

  for (const [label, error, infrastructure] of [
    ["execution", "Dropdown execution was not confirmed; inspect before retrying.", 0],
    ["credentials", "OPENROUTER_API_KEY is not set. Get a key at provider", 1],
  ]) {
    writeFileSync(join(root, "bundled/cli.mjs"), `console.log(${JSON.stringify(JSON.stringify({ status: "error", error, steps: 0, history: [] }))});`);
    const run = spawnSync(process.execPath, [join(root, "scripts/eval.mjs"), "--label", label], { encoding: "utf8" });

    assert.equal(run.status, 1, run.stdout + run.stderr);

    const reportPath = readdirSync(join(root, "evals/results")).find(name => name.startsWith(label + "-"));
    const task = JSON.parse(readFileSync(join(root, "evals/results", reportPath), "utf8")).tasks["error-case"];

    assert.equal(task.verified, 0);
    assert.equal(task.infra_errors, infrastructure);
    assert.equal(task.why?.clause ?? null, infrastructure ? null : "status");
    console.log(`${label}: correct category and nonzero exit`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
