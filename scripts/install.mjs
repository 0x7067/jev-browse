#!/usr/bin/env node
/**
 * Install jev-browse as a STANDALONE plugin per harness.
 *
 *   node scripts/install.mjs [pi|claude|opencode|codex|all|clean]
 *
 * The install materializes a self-contained copy under ~/.jev-browse/install/:
 * esbuild bundles each entry point (SDK inlined, host APIs external) and the
 * portable manifests are copied verbatim. Nothing installed references this
 * repo — every path inside the bundle is plugin-relative.
 *
 * Layout (mirrors the repo so relative resolution is identical):
 *   install/src/cli.ts|mcp.ts|snapshot.js   — bundled CLI + MCP server
 *   install/integrations/pi/index.ts        — bundled pi extension
 *   install/integrations/opencode/jev-browse.ts + snapshot.js — bundled plugin
 *   install/plugin.json|mcp.json|skills/|.claude-plugin|.mcp.json|package.json
 *
 * Re-run to refresh after repo changes. Idempotent.
 */

import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DRIVE = fileURLToPath(new URL("..", import.meta.url));
const INSTALL = join(homedir(), ".jev-browse", "install");
const ESBUILD = join(DRIVE, "node_modules", ".bin", "esbuild");

const targets = process.argv.length > 2 ? process.argv.slice(2) : ["pi", "claude", "opencode", "codex"];

function bundle(entry, outfile, externals = []) {
  mkdirSync(dirname(outfile), { recursive: true });
  execFileSync(
    ESBUILD,
    [
      entry,
      "--bundle",
      "--format=esm",
      "--platform=node",
      "--target=node22",
      ...externals.map((e) => `--external:${e}`),
      `--outfile=${outfile}`,
    ],
    { stdio: "pipe" },
  );
}

function materialize() {
  console.log(`bundling -> ${INSTALL}`);
  bundle(join(DRIVE, "src", "cli.ts"), join(INSTALL, "src", "cli.ts"));
  bundle(join(DRIVE, "src", "mcp.ts"), join(INSTALL, "src", "mcp.ts"));
  bundle(
    join(DRIVE, "integrations", "pi", "index.ts"),
    join(INSTALL, "integrations", "pi", "index.ts"),
    ["typebox", "@earendil-works/*"],
  );
  // @opencode-ai/plugin is bundled in — local plugin dirs can't resolve it.
  bundle(
    join(DRIVE, "integrations", "opencode", "jev-browse.ts"),
    join(INSTALL, "integrations", "opencode", "jev-browse.ts"),
  );
  // Each bundle reads ./snapshot.js beside itself at runtime.
  for (const dir of [
    join(INSTALL, "src"),
    join(INSTALL, "integrations", "pi"),
    join(INSTALL, "integrations", "opencode"),
  ]) {
    cpSync(join(DRIVE, "src", "snapshot.js"), join(dir, "snapshot.js"));
  }
  for (const f of [
    "plugin.json",
    "mcp.json",
    ".mcp.json",
    "package.json",
    "README.md",
    ".env.example",
  ]) {
    cpSync(join(DRIVE, f), join(INSTALL, f));
  }
  cpSync(join(DRIVE, ".claude-plugin"), join(INSTALL, ".claude-plugin"), { recursive: true });
  cpSync(join(DRIVE, "skills"), join(INSTALL, "skills"), { recursive: true });
}

function installPi() {
  // Register the standalone dir as a pi package; drop any prior drive entry.
  const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
  if (!existsSync(settingsPath)) {
    console.log(`pi: no ${settingsPath}; run \`pi install ${INSTALL}\` manually`);
    return;
  }
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  settings.packages = (settings.packages ?? []).filter((p) => {
    const source = typeof p === "string" ? p : p?.source;
    return !(
      source &&
      (source.includes(".jev-drive") ||
        source.includes(".jev-browse") ||
        source.includes("typesafe/drive") ||
        source.includes("Development/jev-drive"))
    );
  });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  try {
    execFileSync("pi", ["install", INSTALL], { stdio: "inherit" });
  } catch {
    console.log(`pi: \`pi install ${INSTALL}\` failed — run it manually`);
  }
}

function installClaude() {
  console.log(`claude: per-session:  claude --plugin-dir ${INSTALL}`);
  console.log(
    `claude: persistent:   register ${INSTALL} in a local marketplace, then \`claude plugin install jev-browse\``,
  );
  console.log("claude: exposes jev_browse over MCP (needs Node >=22.18 on PATH)");
}

function installOpencode() {
  // OpenCode v2 has no plugin-tool API — register the bundled MCP server
  // instead. Remove stale plugin files from earlier installs.
  for (const dir of ["plugin", "plugins"]) {
    rmSync(join(homedir(), ".config", "opencode", dir, "jev-browse.ts"), { force: true });
    rmSync(join(homedir(), ".config", "opencode", dir, "snapshot.js"), { force: true });
  }
  try {
    execFileSync(
      "opencode",
      ["mcp", "add", "jev", "--global", "--", "node", join(INSTALL, "src", "mcp.ts")],
      { stdio: "inherit" },
    );
    console.log("opencode: registered jev MCP server (global)");
  } catch {
    console.log("opencode: `opencode mcp add` failed — add this to ~/.config/opencode/opencode.json:");
    console.log(
      `  "mcp": { "servers": { "jev": { "type": "local", "command": ["node", "${join(INSTALL, "src", "mcp.ts")}"] } } }`,
    );
  }
}

function installCodex() {
  // Personal marketplace: ~/.agents/plugins/marketplace.json, root = ~/.
  const home = homedir();
  const rel = relative(home, INSTALL).split("\\").join("/");
  if (rel.startsWith("..") || rel === "") {
    console.log(`codex: install dir must live under ${home}`);
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
  const path = `./${rel}`;
  const entry = marketplace.plugins.find((p) => p.name === "jev-browse");
  if (!entry) {
    marketplace.plugins.push({
      name: "jev-browse",
      source: { source: "local", path },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity",
    });
    writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
    console.log(`codex: added jev-browse to ${marketplacePath}`);
  } else if (entry.source?.path !== path) {
    entry.source.path = path;
    writeFileSync(marketplacePath, JSON.stringify(marketplace, null, 2) + "\n");
    console.log(`codex: updated jev-browse path in ${marketplacePath}`);
  } else {
    console.log("codex: marketplace entry already present");
  }
  const configPath = join(home, ".codex", "config.toml");
  const key = `[plugins."jev-browse@${name}"]`;
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  mkdirSync(dirname(configPath), { recursive: true });
  if (!existing.includes(key)) {
    writeFileSync(configPath, `${existing}\n${key}\nenabled = true\n`);
    console.log(`codex: enabled in ${configPath}`);
  }
  console.log("codex: restart the app, then /plugins to verify jev_browse");
}

materialize();
for (const target of targets) {
  if (target === "all") {
    for (const fn of [installPi, installClaude, installOpencode, installCodex]) fn();
  } else if (target === "pi") installPi();
  else if (target === "claude") installClaude();
  else if (target === "opencode") installOpencode();
  else if (target === "codex") installCodex();
  else if (target === "clean") {
    rmSync(INSTALL, { recursive: true, force: true });
    console.log(`removed ${INSTALL}`);
  } else {
    console.error(`unknown target: ${target} (pi|claude|opencode|codex|all|clean)`);
    process.exitCode = 1;
  }
}
