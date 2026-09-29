#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CdpBrowser } from '../src/cdp/browser.ts';

const profile = mkdtempSync(join(tmpdir(), 'jev-settle-proof-'));

try {
  const fixture = pathToFileURL(join(import.meta.dirname, '../evals/fixtures/replay.html')).href;
  const browser = await CdpBrowser.open(fixture, { profileDir: profile });

  try {
    await browser.observe();
    await browser.evaluate(`(() => {
      const original = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) => original(fn, ms + 2000, ...args);
      return true;
    })()`);
    const quietStart = performance.now();
    await browser.settle(150, 100);
    const quietMs = Math.round(performance.now() - quietStart);
    assert.ok(quietMs >= 90 && quietMs < 1000, `Quiet wait took ${quietMs}ms`);
    await browser.evaluate(`(() => {
      let tick = 0;
      window.__settleProof = setInterval(() => { document.body.dataset.tick = String(++tick); }, 20);
      return true;
    })()`);
    const activeStart = performance.now();
    await browser.settle(200, 100);
    const activeMs = Math.round(performance.now() - activeStart);
    await browser.evaluate('clearInterval(window.__settleProof)');
    assert.ok(activeMs >= 180 && activeMs < 1000, `Active wait took ${activeMs}ms`);
    console.log(JSON.stringify({ quiet_ms: quietMs, active_ms: activeMs, verified: true }));
  } finally {
    await browser.close();
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
