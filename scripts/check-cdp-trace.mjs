#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CdpBrowser } from '../src/cdp/browser.ts';
import { withTrace } from '../src/trace.ts';

const output = process.argv[2];

if (!output) throw new Error('Usage: node scripts/check-cdp-trace.mjs TRACE.jsonl');

const profile = mkdtempSync(join(tmpdir(), 'jev-trace-check-'));

try {
  await withTrace(output, async () => {
    const browser = await CdpBrowser.open('about:blank', { profileDir: profile });

    try {
      assert.equal(await browser.evaluate('6 * 7', false, 'proof_sync'), 42);
      assert.equal(await browser.evaluate('new Promise(resolve => setTimeout(() => resolve("ready"), 6000))', true, 'proof_slow'), 'ready');
      await assert.rejects(browser.evaluate('(() => { throw new Error("fixture evaluation failed"); })()', false, 'proof_error'), /fixture evaluation failed/);
      await assert.rejects(browser.evaluate('new Promise(() => {})', true, 'proof_timeout'), /CDP Runtime.evaluate timed out.*purpose=proof_timeout/);

      return { verified: ['sync_value', 'async_value', 'evaluation_error', 'method_timeout'] };
    } finally {
      await browser.close();
    }
  });

  const events = readFileSync(output, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(events.some(e => e.type === 'cdp_liveness' && e.data.responsive === true));
  assert.ok(events.some(e => e.type === 'evaluation_timing' && e.data.purpose === 'proof_slow' && e.data.execution_ms >= 5900));
  assert.ok(events.some(e => e.type === 'cdp_end' && e.data.purpose === 'proof_timeout' && e.data.outcome === 'error'));
  console.log('CDP trace proof passed: values, errors, timing, timeout identity, browser liveness');
} finally {
  rmSync(profile, { recursive: true, force: true });
}
