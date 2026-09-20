/**
 * Chrome/Chromium discovery for the launched engine: CHROME_PATH, per-user
 * installs, platform candidates, driver caches (Playwright/Puppeteer), then a
 * PATH sweep. Attach mode (`--cdp`) skips all of this.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** System-installed Chrome-family binaries, stable and pre-release channels. */
function systemCandidates(): readonly string[] {
  switch (platform()) {
    case "darwin":
      return [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      ];
    case "linux":
      return [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/google-chrome-beta",
        "/usr/bin/google-chrome-unstable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/microsoft-edge",
        "/snap/bin/chromium",
      ];
    case "win32": {
      const roots = [
        process.env.PROGRAMFILES,
        process.env["PROGRAMFILES(X86)"],
        process.env.LOCALAPPDATA,
      ].filter((r): r is string => r !== undefined);

      return roots.flatMap((root) =>
        [
          "Google\\Chrome\\Application\\chrome.exe",
          "Google\\Chrome Beta\\Application\\chrome.exe",
          "Google\\Chrome SxS\\Application\\chrome.exe",
          "Microsoft\\Edge\\Application\\msedge.exe",
          "Chromium\\Application\\chrome.exe",
          "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        ].map((rel) => join(root, rel)),
      );
    }

    default:
      return [];
  }
}

/** Versioned driver caches — the binary sits a few directories deep. */
function cacheRoots(): string[] {
  const roots: string[] = [];

  if (process.env.PLAYWRIGHT_BROWSERS_PATH) roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);

  roots.push(
    join(homedir(), "Library", "Caches", "ms-playwright"),
    join(homedir(), ".cache", "ms-playwright"),
    join(homedir(), ".cache", "puppeteer"),
  );

  return roots;
}

/** Executable basenames inside those caches (macOS .app names included). */
const CACHE_BINARY = new Set([
  "chrome",
  "chrome.exe",
  "chromium",
  "Chromium",
  "Google Chrome for Testing",
  "msedge.exe",
]);

function cacheCandidates(): string[] {
  const found: string[] = [];

  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;

    let entries;

    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) walk(path, depth + 1);
      else if (CACHE_BINARY.has(entry.name)) found.push(path);
    }
  };

  for (const root of cacheRoots()) walk(root, 0);

  return found.sort();
}

export function findChrome(): string {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  for (const candidate of systemCandidates()) {
    if (existsSync(candidate)) return candidate;
  }

  for (const candidate of cacheCandidates()) {
    if (existsSync(candidate)) return candidate;
  }

  // PATH fallback: catches flatpak, nix, homebrew-link, and vendor installs.
  for (const name of [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "chrome",
    "msedge",
    "brave-browser",
  ]) {
    for (const dir of (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")) {
      for (const bin of platform() === "win32" ? [name, `${name}.exe`] : [name]) {
        const candidate = join(dir, bin);

        if (existsSync(candidate)) return candidate;
      }
    }
  }

  throw new Error(
    `No Chrome/Chromium found. Set CHROME_PATH, or attach to a running browser with --cdp http://host:9222`,
  );
}
