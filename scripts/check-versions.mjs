#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

const expected = readJson("package.json").version;

if (expected?.constructor !== String) {
  console.error(`package.json version: ${JSON.stringify(expected)} is not a string`);

  process.exit(1);
}

const mismatches = [];

function check(file, field, actual) {
  if (actual === expected) return;
  const shown = actual === undefined ? "missing" : JSON.stringify(actual);
  mismatches.push(`${file} ${field}: ${shown} !== ${JSON.stringify(expected)}`);
}

const plugin = readJson("plugin.json");

check("plugin.json", "version", plugin.version);

const claudePlugin = readJson(".claude-plugin/plugin.json");

check(".claude-plugin/plugin.json", "version", claudePlugin.version);

const marketplace = readJson(".claude-plugin/marketplace.json");

check(".claude-plugin/marketplace.json", "metadata.version", marketplace.metadata?.version);

const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];

for (let index = 0; index < plugins.length; index += 1) {
  check(".claude-plugin/marketplace.json", `plugins[${index}].version`, plugins[index]?.version);
}

if (!Array.isArray(marketplace.plugins)) {
  mismatches.push(".claude-plugin/marketplace.json plugins: missing");
}

const lock = readJson("package-lock.json");

check("package-lock.json", "version", lock.version);

check("package-lock.json", 'packages[""].version', lock.packages?.[""]?.version);

if (mismatches.length > 0) {
  console.error("version mismatch:");

  for (const line of mismatches) console.error(`  ${line}`);

  process.exit(1);
}

console.log(`check-versions: ok (${expected})`);
