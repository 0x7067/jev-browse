#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const path = process.argv[2];

if (!path) throw new Error('Usage: node scripts/trace-summary.mjs TRACE.jsonl');

const lines = readFileSync(path, 'utf8').trimEnd().split('\n');

const events = [];

for (const [index, line] of lines.entries()) {
  try {
    events.push(JSON.parse(line));
  } catch (error) {
    if (index !== lines.length - 1) throw error;
    process.stderr.write('Ignoring an incomplete last trace record\n');
  }
}

const summary = {
  trace_file: path,
  events: events.length,
  slow_calls: events.flatMap(e => e.type === 'cdp_end' && e.data.elapsed_ms >= 1000 ? [e.data] : []),
  evaluations: events.flatMap(e => e.type === 'evaluation_timing' && e.data.elapsed_ms >= 1000 ? [e.data] : []),
  liveness: events.flatMap(e => e.type === 'cdp_liveness' ? [e.data] : []),
  attempts: events.flatMap(e => e.type === 'action_attempt' || e.type === 'fallback_attempt' ? [{ type: e.type, ...e.data }] : []),
  completions: events.flatMap(e => e.type === 'completion_evidence' ? [{ complete: e.data.complete, checks: e.data.checks, url: e.data.page.url }] : []),
  errors: events.flatMap(e => e.type === 'run_error' || e.type === 'fatal_snapshot' || e.type === 'fallback_error' ? [{ type: e.type, data: e.data }] : []),
  result: events.findLast(e => e.type === 'run_result')?.data ?? null,
};

process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
