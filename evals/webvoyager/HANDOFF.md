# Handoff — paused September 29, 2026

The user explicitly requested: “pause and write a handoff.” The active goal is
**paused**, not complete: “fix these issues, without overfitting / address all
shortcomings.” Resume only when requested. Initial task was benchmarking
jev-browse against https://github.com/steel-dev/leaderboard, using OpenRouter and
current dates. The clock during work was September 29, 2026.

## Workspace and constraints

Repository: `/Users/pedro/Development/jev-browse`. Numerous source, harness,
fixture and documentation changes are uncommitted. Rebuilt `bundled/` files are
staged; other changes are mostly unstaged/untracked. No commit was made. Preserve
this work; inspect `git status` before editing. Never commit `dist/`.

Read repository AGENTS instructions. Implementation code comments are banned.
Source changes require `npm run typecheck`, `npm run lint`, and
`npm run check:bundle`. The latter compares rebuilt bundles with the index, so
build and stage `bundled/` before checking. Behavioral fixes require actual
`scripts/eval.mjs` runs with runnable expectations, beyond controlled tests.
Results under `evals/results/` are gitignored evidence, not committed artifacts.

Use OpenRouter (`JEV_PROVIDER=openrouter`). Local `.env` supplies credentials;
never print their values. Decision model `jev-latest` resolved to
`typesafe/jev-1.13-20260917`; text helper is `inception/mercury-2.5`. Runtime answer
review defaults to `anthropic/claude-opus-5.5` for OpenRouter, configurable through
`ANSWER_REVIEW_MODEL`. External benchmark judge is `openai/gpt-5.4`. TypeSafe direct
credits were exhausted; do not switch providers to bypass this.

Browser/network/model calls and staging have required sandbox escalation and
were approved. Do not run Google Search--15 (credential task previously rejected)
or tin-forgot-password (external email submission). No subagents are authorized.

## Exact stopping point: unavailable field recovery

No runtime fix for this issue has been implemented yet. The last turn added:

- `evals/fixtures/field-recovery.html`: an inspection code is available by clicking
  “Read sealed report”; verification requires LARCH-73. `?missing` removes the
  report button and explicitly says no code can be retrieved.
- `scripts/check-field-recovery.mjs`: controlled real-browser regression. It
  forces TYPE_TEXT on “Inspection code” while the report is unopened, but uses
  real OpenRouter responses for text generation and subsequent decisions. It
  intends to run both engines and asserts eventual verified inspection, one
  actual fill and one premature fill decision.

Baseline process **8226 is terminal**, exit1. It failed its desired-success
assertion on CDP before starting agent-browser, as expected for the current bug.
Evidence: `evals/results/field-recovery-1790719332161/cdp.json` and `cdp.jsonl`.
Observed result: status=error, steps=0, forced unavailable field decisions=1.
The script's finally block closed the browser and removed its temporary profile.
The stop request found the process already finished. No known benchmark or test
process remains running.

These two new files have not yet passed lint or other checks. The fixture has not
been added to tasks.json. The missing-code variant has not been exercised.

### Root cause and next implementation

`src/model/text.ts:fieldText` treats the valid schema `{ "text": null }` as an
invalid field response. `src/agent/steps.ts` retries the same context up to three
times and then aborts the entire run. No browser input is executed.

ArXiv--24 in `webvoyager-reload-recovery-2026-09-29` reached paper2609.35703 but had
not found the first author's affiliation. It selected the valid “Search arXiv”
textbox again without a new query intent. The helper returned one malformed array
then two valid null values. Reconstructed-context replay
`evals/results/field-replay-1790719238211/{context,report}.json` produced null twice
more with Mercury. An Opus probe with reasoning disabled returned HTTP400, so it
provides no evidence of alternate-model recovery. The reconstruction expanded
compacted table references correctly but uses a fresh clock timestamp.

Proposed next change, not yet implemented:

1. Distinguish valid unavailable values from malformed provider output.
2. Return unavailable-value feedback to planning; do not type guessed text or
   terminate merely because another action could supply the missing evidence.
3. Bound repeated selection of the same unavailable field in unchanged state.
   Re-enable it after new evidence/state changes. Existing dead-click filtering
   only filters `kind === "click"`; do not silently reuse it for fills without
   checking that distinction. `domFingerprint` reset is in decideStep.
4. Preserve refusal/configuration failures and avoid retrying a valid null just
   to obtain a different answer.
5. Run the new controlled check against both engines. Add actual eval tasks for
   report recovery and a genuinely unavailable required value, with runnable
   expectations. Test that new evidence restores field eligibility and that
   unavailable values cannot create an unbounded decision loop.
6. Run affected fixture suites, typecheck, lint, rebuild/stage/check bundles, then
   rerun ArXiv--24. Do not claim the fixture fixes all arXiv behavior.

## Latest verified runtime changes

### Reload loop recovery

`src/agent.ts` and `src/agent/steps.ts`: ineffective target counters now follow the
observed fingerprint rather than resetting on every new document time origin.
Identical reloads retain failures; changed observable content clears counters.
This fixes repeated self-link clicks without site-specific rules.

Controlled baseline `reload-recovery-1790718519446` failed after four repeats;
fixed proof `reload-recovery-1790718559922` passes on both engines after two
ineffective clicks, then opens the report. New fixture/task fx-reload-recovery
has answer and destination expectations.

Full fixture suites before the next scope correction:

- `reload-full-cdp-1790718899285.json`: 50 verified / 0 unverifiable / 1 failed.
- `reload-full-ab-1790719017071.json`: 49 verified / 0 unverifiable / 2 failed.

### Action-only answer review

Full-suite failures were fx-clipped-scroll on both engines and fx-tab-roundtrip
on agent-browser. Browser actions succeeded. The initial Jev classifier said an
answer was required; the independent reviewer correctly returned NOT_REQUESTED;
runtime incorrectly treated disagreement as terminal failure. A clipped-scroll
rerun reproduced it: `reload-scroll-rerun-1790718936271.json` (0/0/1).

`src/agent/answer.ts` now honors NOT_REQUESTED after the separate browser action
completion check, discarding unnecessary answer text. Calibration adds action
confirmation versus informational confirmation.

- `answer-calibration-1790718979402/report.json`: 20/20 passed.
- `scope-cdp-1790719069627.json`: 5 verified / 0 unverifiable / 0 failed.
- `scope-agent-browser-1790719077561.json`: same.

Both targeted suites cover clipped-scroll, tab-roundtrip, answer summary, answer
comparison and reload recovery. Typecheck, lint and check:bundle passed afterward.
These checks precede the two new field-recovery files described above.

### Other implemented work

See REMEDIATION.md for chronological evidence and exact earlier result paths.
Major changes include shared snapshot visibility/candidacy, delegated controls,
frames/shadow inputs, focus/scroll/tabs, native/ARIA table evidence, observed hrefs,
context-overflow shortlisting, freshness contracts, countdown normalization,
pagination, double-click execution, structured completion and answer review,
current-time context, answer evidence calibration and benchmark audit provenance.

Table-history compaction preserves distinct versions and references exact duplicate
payloads. Viewport/truncation metadata prevents treating a visible sample as an
exhaustive domain. A captured completion request shrank from140351 to34840 JSON
characters and recovered from a provider context error.

Malformed answer generation has a bounded alternate-model attempt only for
malformed responses, not valid nulls, unsupported claims or refusals. Seven
controlled cases and six-task suites on each engine passed. This fallback does
not apply to fieldText. `scripts/lib/evidence-review.ts` is an experimental helper
that is NOT wired into runtime; broader tests showed false rejections and false
acceptance, so do not assume it is part of the shipped solution.

## Benchmark evidence and remaining scope

The last full audited pilot predates the latest fixes:

- Raw `webvoyager-current-review-2026-09-29/report.json`:
  13 verified /15 failed /1 unverifiable /1 excluded.
- Audited `webvoyager-current-review-audited-2026-09-29.json`:
  **11 verified /15 failed /3 unverifiable /1 excluded**.

Apple--28 and Coursera--23 raw passes were downgraded for unsupported maximum and
instructor claims. Later Opus-review reruns obtained actual supporting evidence
and passed saved audits. Do not combine best results from different builds into
a score. Runtime/external judge agreement is not proof by itself.

Six-task `webvoyager-opus-review-2026-09-29` was4verified/2failed. A later targeted
`webvoyager-reload-recovery-2026-09-29` was1verified/1failed: Huggingface--28 passed;
ArXiv--24 failed field generation. It is not a fresh full benchmark.

Open issues beyond field generation:

- **Evidence retention**: rememberObservation keeps first+last7 states, with
  1500-character excerpts. Initial useful pricing observations can roll off while
  the original homepage remains. Huggingface--36 pricing then fails completion
  after scrolling. Need a principled evidence-retention design and a deterministic
  multi-step counterexample; simply increasing caps is insufficient evidence.
- **Repeated completion recovery and navigation loops** remain in live tasks.
  Dead-target retention solves identical reloads, not arbitrary cycles.
- **Remaining live failures** across the original suite need current-build
  re-evaluation and diagnosis. Held-out15 tasks were previously inspected and
  are no longer untouched holdouts.
- Agent-browser double-click uses a synthetic full sequence because the installed
  native command emitted one click; isTrusted=false remains a documented limit.
- Invalid top-level provider envelopes may still cause generic errors before
  message validation. Current malformed-answer handling is not universal.

After actionable fixes, run a fresh full benchmark against a frozen build and
manually audit outputs with trace/screenshot evidence. The audit script records
run hashes and keeps automated versus adjudicated counts separate; the comparison
script uses raw judgments. Keep excluded tasks excluded. Do not claim completion
until the original broad goal is supported, rather than only the newest fixtures.

## Useful commands when resumed

```bash
JEV_PROVIDER=openrouter node --import tsx scripts/check-field-recovery.mjs
JEV_PROVIDER=openrouter node scripts/eval.mjs --tasks <affected-ids> --engine cdp --label <label> --trace
JEV_PROVIDER=openrouter node scripts/eval.mjs --tasks <affected-ids> --engine agent-browser --label <label> --trace
npm run typecheck
npm run lint
npm run build:bundle
git add bundled/
npm run check:bundle
JEV_PROVIDER=openrouter node scripts/webvoyager.mjs --tasks ArXiv--24 --out evals/results/<new-dated-run>
```

No work should continue until the user resumes the paused goal.
