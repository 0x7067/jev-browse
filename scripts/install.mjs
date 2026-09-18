#!/usr/bin/env node
/**
 * Install jev-drive as a native plugin in each harness:
 *
 *   node scripts/install.mjs [pi|claude|opencode|codex|all]
 *
 * pi       — `pi install <drive>`; the package.json `pi` manifest exposes the
 *            extension and the skill
 * claude   — prints the plugin commands (Claude owns the install step)
 * opencode — writes a stub into ~/.config/opencode/plugin/ that re-exports the
 *            canonical plugin file, so repo updates flow
 * codex    — merges an entry into ~/.agents/plugins/marketplace.json (personal
 *            marketplace rooted at ~) and enables it in ~/.codex/config.toml
 *
 * Idempotent: re-running changes nothing already installed.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DRIVE = fileURLToPath(new URL("..", import.meta.url));
const OPENCODE_PLUGIN = join(DRIVE, "integrations", "opencode", "jev-drive.ts");

const targets = process.argv[2] ? [process.argv[2]] : ["pi", "claude", "opencode", "codex"];

function installPi() {
  try {
    execFileSync("pi", ["install", DRIVE], { stdio: "inherit" });
  } catch {
    console.log(`pi: \`pi install ${DRIVE}\` failed — run it manually`);
  }
}

function installClaude() {
  console.log(`claude: per-session:  claude --plugin-dir ${DRIVE}`);
  console.log(
    "claude: persistent:   register " +
      `${DRIVE} in a local marketplace, then \`claude plugin install jev-drive\``,
  );
  console.log("claude: exposes jev_browse over MCP (needs Node >=22.18 on PATH)");
}

function installOpencode() {
  const pluginDir = join(homedir(), ".config", "opencode", "plugin");
  mkdirSync(pluginDir, { recursive: true });
  const stub = join(pluginDir, "jev-drive.ts");
  const content =
    "// Installed by jev-drive — re-exports the canonical plugin so repo updates flow.\n" +
    `export { default } from ${JSON.stringify(OPENCODE_PLUGIN)};\n`;
  if (existsSync(stub) && readFileSync(stub, "utf8") === content) {
    console.log("opencode: already installed");
    return;
  }
  writeFileSync(stub, content);
  console.log(`opencode: wrote ${stub}`);
}

function installCodex() {
  // Personal marketplace: ~/.agents/plugins/marketplace.json, root = ~/.
  // source.path must be ./-relative and stay inside that root.
  const home = homedir();
  const rel = relative(home, DRIVE).split("\\").join("/");
  if (rel.startsWith("..") || rel === "") {
    console.log(`codex: plugin must live under ${home} for the personal marketplace`);
    return;
  }
  const marketplaceDir = join(home, ".agents", "plugins");
  const marketplacePath = join(marketplaceDir, "marketplace.json");
  mkdirSync(marketplaceDir, { recursive: true });
  const marketplace = existsSync(marketplacePath)
    ? JSON.parse(readFileSync(marketplacePath, "utf8"))
    : { name: "personal", interface: { displayName: "Personal" }, plugins: [] };
  marketplace.plugins ??= [];
  const name = marketplace.name ?? "personal";
  if (!marketplace.plugins.some((p) => p.name === "jev-drive")) {
    marketplace.plugins.push({
      name: "jev-drive",
      source: { source: "local", path: `./${rel}` },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    });
    writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
    console.log(`codex: added jev-drive to ${marketplacePath}`);
  } else {
    console.log("codex: marketplace entry already present");
  }

  // Enable it in user config: [plugins."jev-drive@<marketplace-name>"]
  const configPath = join(home, ".codex", "config.toml");
  const key = `[plugins."jev-drive@${name}"]`;
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  mkdirSync(dirname(configPath), { recursive: true });
  if (!existing.includes(key)) {
    writeFileSync(configPath, `${existing}\n${key}\nenabled = true\n`);
    console.log(`codex: enabled in ${configPath}`);
  }
  console.log("codex: restart the app, then /plugins to verify the jev_browse tool");
}

for (const target of targets) {
  if (target === "all") {
    for (const fn of [installPi, installClaude, installOpencode, installCodex]) fn();
  } else if (target === "pi") installPi();
  else if (target === "claude") installClaude();
  else if (target === "opencode") installOpencode();
  else if (target === "codex") installCodex();
  else {
    console.error(`unknown target: ${target} (pi|claude|opencode|codex|all)`);
    process.exitCode = 1;
  }
}
