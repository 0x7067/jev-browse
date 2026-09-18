/**
 * Chrome/Chromium discovery for the launched engine: CHROME_PATH, per-user
 * installs, platform candidates, then a PATH sweep. Attach mode (`--cdp`)
 * skips all of this.
 */

import { existsSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ],
};

export function findChrome(): string {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  if (platform() === "win32" && process.env.LOCALAPPDATA) {
    const perUser = join(
      process.env.LOCALAPPDATA,
      "Google\\Chrome\\Application\\chrome.exe",
    );

    if (existsSync(perUser)) return perUser;
  }

  for (const candidate of CHROME_CANDIDATES[platform()] ?? []) {
    if (existsSync(candidate)) return candidate;
  }

  // PATH fallback: catches flatpak, nix, homebrew-link, and vendor installs.
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    for (const dir of (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":")) {
      const candidate = join(dir, name);

      if (existsSync(candidate)) return candidate;
    }
  }

  throw new Error(
    `No Chrome/Chromium found. Set CHROME_PATH, or attach to a running browser with --cdp http://host:9222`,
  );
}
