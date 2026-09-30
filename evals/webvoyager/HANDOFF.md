# Handoff — paused September 29, 2026 (updated 20:52 -03:00)

## Update 2: runs after credit top-up (key limit raised to $120)

- Targeted rerun of the 7 tasks that got 402s, plus field/retention tasks:
  `targeted-cdp-1790722817759.json` 8/0/2, `targeted-agent-browser-1790722960242.json`
  9/0/1. None of the former 402 tasks fail on either engine.
- Full fixture suites with the field and retention changes:
  `retention-full-cdp-1790724313816.json` 91/0/7 and
  `retention-full-agent-browser-1790725197791.json` 91/0/7. CDP-only
  failures, rerun 3x (`rerun-cdp-1790725269020.json`): fx-disabled-redeem 3/3
  pass (flake); fx-iframe 2/3; jqueryui-datepicker 0/3. The datepicker also
  fails 0/3 at pre-change commit 6f15cb3 (`base-datepicker-1790725315112.json`),
  so it is a live-site change, not a regression from this work.
- fx-iframe is flaky on CDP before and after: pre-retention worktree
  (06f1e25) was 1/3, current build 1/3 then 2/3. agent-browser 3/3. The
  button sits at page y≈418. After CDP's 624px scroll it is above the viewport
  (624..1404), so dropping it is correct candidacy, not a bug. The flake is the
  planner scrolling past the section and not scrolling back to click.
- fx-evidence-retention A/B (3x per engine): pre-retention build 0/3 CDP and
  0/3 agent-browser (step budget, never answers). Current build: agent-browser
  3/3. CDP answered 14 in all 3 runs, but GO_BACK after the final scroll broke
  the old terminal-text expectation. The expectation now checks the executed
  path (`CLICK:Pricing` + 11 scrolls) plus the answer. Recorded runs pass it
  on both engines.
- Live `webvoyager-field-retention-2026-09-29`: Huggingface--28 verified;
  Huggingface--36 unverifiable (plans correct, extra pay-as-you-go items
  flagged by the judge); ArXiv--24 failed (blocked/no_progress).
- ArXiv--24: the field fix works (no helper failure). The remaining failure is
  planning. The affiliation is not on the abstract page. "View PDF" and "HTML
  (experimental)" are offered, but the planner oscillates on the self-link /
  Search. Two generic fixes were tried and reverted, each with 2 live reruns
  and no gain: (a) naming repeated actions in the fuse hint
  (`webvoyager-arxiv-hint-{1,2}`), (b) hiding click targets whose identical
  transition repeated twice (`webvoyager-arxiv-transition-{1,2}`); the loop just
  moved to other targets. Treat this as a decision-model limit on choosing an
  unexplored evidence source.
- **Fresh full pilot on frozen clean build 7e337e5**
  (`webvoyager-fresh-full-2026-09-29`): raw 12 verified / 17 failed /
  0 unverifiable / 1 excluded. Earlier raw baseline
  `webvoyager-current-review-2026-09-29` was 13/15/1/1. Comparison:
  `compare-fresh-vs-current-review.json`. Flips: gained Amazon--23 and Google
  Map--39; lost ArXiv--38, Booking--35 and Huggingface--36. 2x reruns
  (`webvoyager-regress-check-{1,2}`): Booking--35 2/2 verified and ArXiv--38 1/2,
  so both are variance. Huggingface--36 is 0/4 on this build: the runtime Opus
  reviewer wants pay-as-you-go pricing covered, and the external judge calls
  that extra claim unverifiable. It is a reviewer/judge scope conflict on "all
  payment plans", not an evidence-loss bug. The earlier raw baseline verified
  it once, but the pre-work handoff already listed it as an open failure. Net:
  no regression shown beyond this unresolved scope conflict, and no benchmark
  gain shown. Single live runs are too noisy (±2 tasks) to rank builds;
  use 3x repeats per task for any future comparison.
- Loop-closing A/B, same final expectations, 2x per engine:
  HEAD 3333eff `close-loop-{cdp,agent-browser}-*.json` 12/12 verified;
  pre-session 846d4a0 `pre-fix-{cdp,agent-browser}-*.json` 7/12.
  - Retention: fx-evidence-retention 4/4 on HEAD vs 0/4 before (step
    budget, never answers). Across all runs: 10/10 vs 0/10.
  - Field: fx-field-recovery and fx-field-unavailable also pass on the old
    build (3/4 and 4/4; its one failure was a 120s harness timeout). The live
    planner rarely picks the field early, so these tasks cannot tell builds
    apart. The only discriminating evidence is the controlled check, which
    forces the premature fill: old build status=error at 0 steps; HEAD 4/4
    on both engines. The live effect is that ArXiv--24 no longer ends on a
    field-helper error.
- Not yet done: manual adjudicated audit of the fresh run
  (`scripts/audit-webvoyager.mjs`); Allrecipes access-issue pages; ESPN--35 judge
  `fetch failed` (infra, rerun judge with `--judge-only`).

## Update: field recovery implemented, blocked on OpenRouter credit

All prior work was committed (`6f15cb3`). The unavailable-field fix below is
implemented and committed in the follow-up commit.

- `fieldText` returns `text: null` for the valid `{ "text": null }` schema;
  malformed output still throws and retries as before.
- `actStep` records the field in `Agent.unavailableFields` (node, fingerprint,
  step), types nothing, sets a repair hint (obtain the value or claim BLOCKED)
  and returns to decide. `decideStep` hides that fill target while the
  fingerprint is unchanged and no action has executed since; new evidence
  restores eligibility.
- `check-field-recovery.mjs` now covers recovery and `?missing` on both engines:
  `evals/results/field-recovery-1790719886563/` all 4 pass (missing variant:
  blocked, zero fills, field offered once).
- New tasks `fx-field-recovery`, `fx-field-unavailable`: 2/0/0 on both engines
  (`field-cdp-1790719846096.json`, `field-agent-browser-1790719869884.json`).
- Full `tasks.json` CDP `field-full-cdp-1790720961928.json`: 91/0/6. The failures
  are live-site ones (tin-hovers, tin-infinite-scroll, demoqa-autocomplete,
  europa-consent, mdn-search) plus fx-iframe. fx-iframe passed in the prior
  baseline, never hit the new code path and wandered before clicking the frame
  button. Rerun before calling it a regression.
- Full agent-browser `field-full-agent-browser-1790722104895.json`: 82/0/15.
  7 are HTTP 402 errors: the OpenRouter key hit its $80 limit (about $0.008
  left) mid-run. Those results are invalid and do not show behavior.

**Blocker:** OpenRouter credit is exhausted. Next, once the user adds credit:
rerun fx-iframe on both engines, rerun the agent-browser full suite, then rerun
ArXiv--24. After that, continue with the open issues below.

### Evidence retention (implemented, NOT yet eval-verified)

`rememberObservation` now evicts the observation with the least unique evidence
(normalized text lines, tables and URL not present in any other retained one).
The first and newest observations are always kept. Before, it dropped the oldest
middle entries. `scripts/check-evidence-retention.mjs` is a deterministic
counterexample: unique pricing evidence followed by 12 low-novelty doc scrolls,
plus a 3-page cycle. The old policy fails it (pricing lost); the new one passes.
This is a synthetic check only. AGENTS requires a suite run: once credit
returns, run the full fixture suites on both engines and Huggingface--36 before
treating it as shipped, and revert if verified tasks regress.

Real-browser check, no model calls: `scripts/check-evidence-retention-browser.mjs`
opens `evals/fixtures/evidence-retention.html` on both engines, clicks Pricing,
then runs 14 real page scrolls, feeding each real `PageState` to
`rememberObservation`. With `RETENTION_BASELINE=<copy of HEAD~1 progress.ts>`, the
old policy lost the pricing evidence on both engines (kept 0,9..15). The new
policy kept it (cdp kept 0,1,7,10,11,12,14,15; agent-browser 0,1,7,9,10,11,14,15).
Evidence: `evals/results/evidence-retention-browser-1790722484808/`. New eval task
`fx-evidence-retention` (answer 14 after scrolling to chapter 12) has not run
yet (credit). This covers the observation layer only. Whether decision,
completion and answer models make use of the retained evidence is still
unproven.

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

## 2026-09-30 Challenge grace (2 actions) landed

Commit 330ed63: the decision loop no longer blocks at the first sight of a
challenge. A clearing challenge (checkbox, press-and-hold) gets up to two
actions; a third action while the challenge is still active blocks with
`verification_required`. The fixture `action_not_match` regex was tightened to
the exact checkbox label.

Evidence:
- `evals/results/challenge-after2-*.json` (cdp) and
  `evals/results/challenge-after-ab-*.json` (agent-browser): fx-persistent-challenge
  blocked with zero challenge clicks, fx-clearing-challenge cleared and finished,
  4/4 verified per engine.
- Full suites post-change: cdp 94 verified / 6 failed, agent-browser 92/8. Compared
  with the pre-change retention baselines (91/7 each): no task regressed on cdp.
  On agent-browser the only new failure was jqueryui-datepicker. It already
  failed on cdp in the baseline and passed 2/2 on a rerun
  (`datepicker-recheck-1790772524981.json`), so it is live-site flake.
- Live WebVoyager Google Search--7 now blocks with `verification_required` on the
  recaptcha interstitial (previously it burned steps clicking the checkbox).

## 2026-09-30 Control-label evidence and uncertain-answer arbitration (977b6c1)

Diagnosis from the fresh pilot: in Amazon--10, the reviewer rejected "$42.99" as
unsupported. The price existed only in a button label ("New (2) from $42.99"), and
the reviewer saw page text plus the first 60 action labels, while the generator
saw a 2000-char element list. Fix: the reviewer now gets the same `elements`
list. Also, when the completion model says UNCERTAIN on a goal with no explicit
checks, the strict answer reviewer arbitrates instead of blocking outright.

Evidence:
- New task `fx-control-label-answer`: cdp 0/3 before (`ctl-before-1790773179514`),
  3/3 after (`ctl-after2-1790773286525`), agent-browser 3/3.
- Answer calibration 20/20 (`answer-calibration-1790773296706`).
- Full suites: cdp 94/7 (`uncertain-full-cdp-1790774257892`), agent-browser 92/9
  (`uncertain-full-agent-browser-1790775634095`). New failures versus the last run:
  fx-iframe and tin-infinite-scroll. Both fail 0/3 on the pre-change build too
  (`uncertain-pre-cdp-1790775812144`), so the change did not cause them.
  tin-entry-ad passed 3/3 on rerun.
- Live (`webvoyager-uncertain-2026-09-30`): both tasks still fail, now for
  legitimate evidence reasons. On Amazon--10 the reviewer now sees tier prices
  but the agent opened the wrong tier and nothing ties a PS4 to one. On Google
  Map--1 no distance evidence is shown. The next target is navigation/strategy,
  not the review plumbing.

Still open: fx-iframe and tin-infinite-scroll fail consistently on cdp, and are
worth their own investigation. Adjudicated audit of the fresh run is still not done.

## 2026-09-30 Freshness and goal-confidence gate (7177365)

- Untargeted SCROLL/WAIT decisions now survive page drift between decide and act.
  Before, an infinite scroll or live region made every scroll decision "stale",
  so the agent never scrolled twice.
- The decider's SATISFIED goal_progress overrides the chosen action only at
  confidence >= 0.6.
- tin-infinite-scroll cdp: 0/3 before (`uncertain-pre-cdp-1790775812144`), 3/3 after
  (`goalconf-cdp-1790776376815`). On agent-browser it waits once and then scrolls once,
  so the two-scroll check still fails 0/3 there.
- Full suites: cdp 95/6 (`goalconf-full-cdp-1790777395604`), agent-browser 94/7
  (`goalconf-full-agent-browser-1790779257909`), the best so far on both engines.
  fx-new-tab's one suite failure passed 3/3 on rerun (`newtab-recheck-1790779350704`).
- Live, 7 prior failures (`webvoyager-7177365-2026-09-30` plus
  `webvoyager-7177365-infra-rerun-2026-09-30`): 2/7 now verified. Amazon--10
  passed for the first time ($42.99 tier, with the control-label evidence fix).
  Booking--35 verified. Still failing: ArXiv--24, BBC News--8 (time budget),
  ESPN--32, Google Map--1 (no distance evidence), Huggingface--36 (reviewer/judge
  scope conflict).
- Infra warning: the disk hit ENOSPC mid-run, with 22 GB free (95% used).
  `~/.jcode/scratch` is 14 GB, mostly from other projects. Check free space before
  a full benchmark run.
