# Replay diagnostics, completion, verification, and frame readiness

Feature ID: replay-diagnostics

Follow launch/doctor and isolated profile requirements in the parent SKILL.md.
These evals require a configured provider. Do not use the public CertSafari task
without authorization to send its potentially non-public observations to that
provider. No task answers questions or requests a verification bypass.

```bash
control-jev-browse eval -- --tasks fx-quiz-setup,fx-quiz-explicit,fx-completion-missing,fx-quiz-challenge,fx-hidden-challenge,fx-guide-anchor,fx-frame-readiness --trace --label replay
```

Expected: all tasks verified, zero unverifiable/failed. The challenge and missing
completion tasks intentionally return blocked. Inspect `trace_file` in each
result detail and copy the result, traces, and sidecars into the run's evidence
directory before cleanup.

```bash
node scripts/trace-summary.mjs <trace_file>
node scripts/check-cdp-trace.mjs "$EVIDENCE_DIR/cdp-proof.jsonl"
```

The diagnostic check uses its own temporary profile, closes Chrome, and verifies
sync/async evaluation results, error propagation, a 30-second timeout naming the
method and purpose, and browser-level responsiveness during slow calls.

`fx-guide-anchor` requires exactly one click. `fx-quiz-challenge` requires visible
challenge evidence and rejects clicks outside Start quiz. `fx-hidden-challenge`
proves hidden verification markup does not block a readable page.
`fx-frame-readiness` checks both delayed page-provided signals and preserves the
sandboxed frame's inaccessible status. Run those shared-observation cases with
`--engine agent-browser` when changing marker or frame semantics.

Optional live comparison: `guide-anchor-broad,guide-anchor-precise` from
`tasks-hard.json`. Both preserve the historical goals. Inspect the broad trace's
final URL and matching visible heading; a URL regex alone does not prove it.

## Open-ended goal tracking

Run `--tasks fx-goal-open-ended,fx-goal-already-satisfied,fx-goal-history,fx-goal-action-only,fx-goal-unobservable --trace`.
These cover a broad quiz goal without answering, zero-action completion, multiple
requirements, an action-only stopping boundary, and unavailable approval evidence.
Inspect `goal_assessment` trace events and the `goal_progress` decision head.
No task supplies agent completion regexes; eval expectations remain independent.
