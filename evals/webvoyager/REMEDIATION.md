# General remediation in progress

Scope: address all pilot shortcomings without task/site-specific answer rules.
Baseline: webvoyager-openrouter-current-v1, 3/29 independently verified.

First implementation removes the regex answer gate, permits summaries and
comparisons from retained observations, preserves partial history on agent
errors, bounds text-helper requests, and traces helper output/errors for diagnosis.
New unrelated station-report fixture tasks exercise summary and comparison.

Remaining work, not claimed complete:
- Verify this change on fixture suite and affected live pilot tasks.
- Inspect newly instrumented helper failures; fix their actual cause.
- Diagnose malformed decision responses and action/navigation loops.
- Improve retained evidence for multi-page tasks and unsupported completion claims.
- Repair benchmark evidence capture (active tab, terminal state, temporal coverage).
- Separate timeouts, provider failures, site blocks, and evaluator uncertainty;
  use consistent judging and verify the three baseline successes manually.
- Record actual model configuration, complete usage where available, reliable
  cleanup, resume/rejudge provenance, and stable denominator accounting.
- Run all affected existing tiers, rerun new live failures, and evaluate held-out
  tasks as well as the pilot. Do not use site-specific hints or expected answers.

Site access blocks cannot be eliminated by claiming success; report them
accurately and verify detection without interacting with security challenges.
Credential task remains excluded under the prior approval decision.

## Evidence from first remediation pass

- `evals/results/general-answer-fix-v3-1790705591280.json`: six verified,
  zero unverifiable, zero failed. Earlier v2 failed the summary because the
  independent basis question did not receive the information-request rule;
  both questions now apply that rule. The initial new fixture regex was invalid
  JavaScript and was corrected before this successful suite run.
- `evals/results/webvoyager-answer-fix-v1/report.json`: two verified, two
  failed. Amazon--23 and Apple--28 improved; Google Flights--37 and
  Huggingface--36 still failed. Diagnostic only: bundles were rebuilt during
  the sequential run as fixture completion fixes were made. Do not treat this
  run as a frozen-build performance comparison.
- Huggingface--36 returned literal `{"answer":"..."}` from the text helper;
  this passed nonempty-string validation. The judge correctly rejected it.
  Need general supported-answer validation, not a site-specific correction.
- Google Flights--37 still needs trajectory-wide evidence review to distinguish
  unsupported answers from screenshots omitting earlier observations.
- `npm run typecheck`, `npm run lint`, `npm run check:bundle` all passed.
  Rebuilt bundles are staged so check:bundle compares regeneration to the new
  artifacts; no commit created. Source and fixtures remain unstaged.

No benchmark or fixture processes remain running from this pass. Overall goal
is still active; the remaining items above have not been verified or resolved.

## Answer review pass

The helper's output is now independently reviewed by the decision model against
all requested information and supplied observations. One rewrite is allowed;
unverified required answers result in blocked/answer_unverified, and review
infrastructure errors produce error rather than done. Actions-only goals still
require no answer. This is model-based checking, not a proof of factual accuracy.
Further integration may need to resume browsing when the review finds missing
evidence, rather than ending blocked after the main loop.

Evidence:
- `evals/results/answer-review-v1-1790705820156.json`: six verified, zero
  unverifiable, zero failed (fixture summary, comparison, actions-only, history,
  already-satisfied, and missing-evidence goals).
- `node scripts/check-answer-review.mjs`: real CLI with controlled helper API
  and live independent reviewer. `answer-review-check-1790705871696/report.json`
  proves placeholder regeneration and persistent invented-answer rejection.
  First test fixture mistakenly counted the connection warm-up HEAD request as
  an answer generation; corrected server behavior before the passing run.
- `evals/results/webvoyager-answer-review-v2/report.json`: Huggingface--36
  independently verified, one verified / zero failed / zero unverifiable.
  No source or bundle changes during this single-task run.

The benchmark harness's evidence coverage and categories remain unchanged;
full-pilot, held-out, and broader existing-suite verification remain pending.
No live processes remain from the answer-review pass.

## Trajectory-aware evaluator pass

Protocol v2 supplies chronological DOM evidence plus evenly spaced screenshots,
records sampling/truncation coverage, captures all nonblank tabs with target IDs,
and times out screenshot WebSocket handshakes. Execution errors/timeouts count
as failed attempts, site blocks receive a separate category, exclusions are
separate, and reports expose selected/attempted/unattempted counts. Rejudging
preserves original outputs and source-run metadata in a new timestamped directory.
New live runs record the CLI bundle hash and check it before each task.

Evidence:
- Existing Google Flights--37 evidence rejudged as verified with earlier DOM
  observations supporting both airlines. Original failed verdict is unchanged.
  `webvoyager-answer-fix-v1/judgments/1790706042180/report.json`.
- Existing Allrecipes--18 and Cambridge Dictionary--15 both failed/site_block;
  Amazon--23 failed/execution_error. Three failed, none unverifiable.
  `webvoyager-openrouter-current-v1/judgments/1790706078736/report.json`.
- New full-path Coursera--12 run: one verified, zero failed/unverifiable.
  `webvoyager-evidence-v2-smoke/report.json`. Target IDs, captured evidence,
  bundle hash, and original-verdict preservation were checked directly.
- Local assertions on real flight evidence verify chronological observations
  include airline information; count accounting and timeout/error classification
  also checked. Typecheck, lint, and bundle checks pass.

Still pending: multi-tab and transient terminal capture proofs, reliable
interruption cleanup/resume, full usage accounting, full consistent-protocol
rejudging and manual audit, plus remaining agent navigation/helper reliability
issues and broader regression/held-out testing. The all-tab implementation was
smoked on a single-tab task; that does not prove multi-tab correctness.
No processes remain running from this pass.

## Delegated containers and shared listener discovery

The Wolfram and BBC traces offered entire framework root DIVs as buttons because
of event delegation. The shared snapshot now excludes inferred interactive
containers with interactive descendants unless they expose their own explicit
semantics, focusability, hover, edit, drag, or drop surface. Standalone custom
listener targets remain discoverable. This trades away ambiguous container-wide
clicks without explicit semantics; it does not use framework IDs or site rules.

A new delegated-controls fixture covers a delegated child, standalone custom
listener, and explicit semantic parent. Direct trace inspection confirms the
container is absent and standalone/semantic controls are offered.

- delegated-cdp-v1-1790706304870.json: 5 verified / 0 unverifiable / 0 failed.
- delegated-cdp-regressions-v1-1790706337315.json: 5 / 0 / 0, covering shadow,
  hover, iframe, drag, and context actions.
- delegated-agent-browser-v1-1790706401163.json: 5 / 0 / 3. Shadow and iframe
  are explicitly filtered by the existing engine (unchanged from HEAD).
  Standalone custom controls were invisible because listener instrumentation
  was absent. A baseline using HEAD's snapshot reproduced that failure:
  evals/results/ab-snapshot-baseline/stdout.json.
- Shared listener instrumentation now installs before navigation in both engines.
  Agent-browser uses its installed --init-script option, confirmed in local help;
  its owned temporary script is removed on close, including launch failure.
- shared-listeners-ab-v2-1790706537190.json: 5 / 0 / 0, including the formerly
  failing standalone control and delegated/semantic/hover/context tasks.
- shared-listeners-cdp-v2-1790706515459.json: 2 / 0 / 0 after extracting shared
  instrumentation. Typecheck, lint, and bundle regeneration checks all pass.

All result files above are under evals/results/. No processes remain active.
Remaining scope includes actual repeated-submit/navigation failures, agent-browser
shadow/iframe limitations, and the other previously listed unfinished work.

## Frame/shadow execution and inconsistent review responses

Agent-browser no longer drops frame/shadow actions. It validates targets in their
own document through deep hit testing and uses native mouse/keyboard input for
boundary click/hover/text actions, plus select values and input/change events.
Selectors in this CLI did not find shadow descendants; nested `frame` switching
also failed. Native input avoids relying on those unsupported selector paths.
CLI mouse coordinates must be integers (confirmed by direct parser check).

New fx-nested-frame-form and fx-shadow-form tasks have independent expected final
text and action patterns. Results under evals/results/:
- ab-boundaries-v1-1790706708663.json: iframe passed; shadow selector failed.
- ab-boundaries-v2-1790706811849.json: native coordinate/parser and nested-frame
  selector failures exposed and then fixed.
- ab-boundaries-v3-1790706920436.json: five verified, zero unverifiable/failed.
- ab-boundaries-v4-1790707061478.json: four verified, zero unverifiable/failed
  on the final bundle (shadow click, iframe click, nested form, shadow form).
- boundary-fixtures-cdp-v1-1790706802143.json: nested form passed; shadow form
  completed input but answer-review response violated its probability contract.

Added shared bounded validation retry for completion and answer reviews. A
returned choice inconsistent with its own probabilities remains invalid; one
fresh response is allowed. `node --import tsx scripts/check-choice-retry.mjs`
passed corrected-response acceptance and persistent-invalid-response rejection
through a real SDK/local HTTP boundary, with exactly two calls each.

CDP boundary-review-cdp-v2-1790707071591.json: two verified, two execution-error
failures (native input timed out), zero unverifiable. Existing eval summary calls
these infra rather than failed; they are not successes. Sequential nested-frame
rerun nested-frame-cdp-rerun-1790707119185.json passed (one verified / zero failed),
but latency was 28 seconds. A shadow-form rerun is pending at this checkpoint.
Do not treat the intermittent CDP input behavior as resolved.

Typecheck, lint, and bundle checks passed. Still pending: boundary file-upload
proof/support, additional numeric/date/select/overlay cases, and all other open
agent, harness, held-out, and full-suite work. Documentation updated to reflect
only the boundary capabilities verified so far.

Shadow-form sequential rerun completed: shadow-form-cdp-rerun-1790707155578.json,
one verified, zero failed/unverifiable, 5.3 seconds. Both CDP failures have passing
sequential reruns; this suggests intermittent execution conditions but does not
identify their root cause. No processes remain running from this pass.

## Full pilot and interruption pass (in progress)

Full frozen-bundle pilot started at evals/results/webvoyager-remediated-full-v2.
Active exec session: 35322. Poll this exact handle before starting/restarting any
pilot. It uses the pre-interruption-handler harness loaded at launch; browser
source/bundles have not changed during the run. Allrecipes tasks were site-blocked;
Amazon tasks are underway. Do not infer completion from this note; inspect the
live process and report.

Meanwhile the harness now saves JSON atomically, writes an initial report,
handles SIGINT/SIGTERM, kills its owned CLI and closes Chrome through normal
cleanup, and marks the report interrupted. Independent live interruption proof:
evals/results/webvoyager-interrupt-proof/report.json. It exited 130, retained
valid JSON, removed the owned profile, and both owned PIDs returned ESRCH.
Lint passed. Resume support and interruption during every lifecycle phase still
need work; this test proves interruption after child launch only.

## Resume and reported usage pass

Full pilot still active in exec session 35322, at BBC tasks on the last poll.
Continue polling that handle; do not restart the pilot. It uses the harness
loaded before these resume changes, and source/bundles remain frozen.

Implemented --resume configuration/build/dataset checks, recorded-attempt
preservation, recovery of saved run.json without browser rerun, exclusive lock,
and explicit handling of incomplete traces. New runs hash both CLI and snapshot.
Rejudgments preserve source snapshot identity. Usage sidecars collect actual model
IDs and provider-reported costs, deduplicated by response ID, explicitly excluding
unknown charges. Old pilot runs are not retroactively modified.

Live proof: evals/results/webvoyager-resume-proof/proof.json. A live runner was
rejected; after controlled interruption a resume preserved original run.json
bytes and the interrupted result without calls; changed limits were rejected
without report changes; lock was removed. This proves recorded-attempt behavior;
unattempted-task continuation and abrupt-kill stale-lock recovery still need
broader lifecycle verification. Lint passed.

The running pilot has two Amazon successes and continued Apple/arXiv failures.
Await the complete report before deriving a new score or changing agent behavior.

Resume continuation proof completed at evals/results/webvoyager-resume-continuation/proof.json:
first interrupted attempt preserved byte-for-byte; second unattempted public task
executed on resume; both represented in the final denominator. No retry occurred.

Frozen held-out manifest: evals/webvoyager/heldout.json, third hash-ranked task per
site, 15 tasks disjoint from the 30-task pilot. Raw dataset checksum validated
against the pinned pilot source. Yearless January travel dates resolve to January
2027; historical research and sports-season dates intentionally remain historical.
The harness now accepts --manifest FILE. Held-out tasks have not been run and
must not be used for tuning before the planned validation.

Last full-pilot poll: session 35322 still live, running Booking--38. Completed
Booking--35 grading raises an additional evaluator question: original task asks
for three places, while judge rejected a named attraction as not a separate place.
Audit this against the original text; do not impose a city-only requirement.
Apple--28 currently reaches a tech-spec page but claims a GPU ceiling absent from
its observed text; Apple--12 ends answer_unverified after browsing has stopped.
Next agent work should consider exact evidence support and allowing information
collection to continue when answer review detects missing evidence. Do not change
browser source/bundles until this frozen pilot finishes.

## Scope and date evaluation audit

Full pilot session 35322 remains active on frozen bundles, now past Google
Flights--37 (verified). Booking--35 evidence supports three named places; both
v2 and v3 automatic grades impose additional category restrictions. Rejudgment
1790707839588 remains failed; adjudication.json records the dispute without
overriding the raw verdict. Stop prompt tuning on this case.

GitHub--5 exposed missing clock context: the agent searched using a 2024 cutoff
for a relative-date task, and the judge incorrectly called 2024 future. Protocol
v3 now supplies the original execution timestamp and directs relative-date
interpretation against it. Browser model clock context is still pending until
the frozen run ends. The pilot currently running retains its original v2 judge.

## Multi-tab capture diagnostic

Local HTTP fixture run webvoyager-multitab-proof-v2: one verified / zero failed
/ zero unverifiable, but its proof.json shows only the opener screenshot.
The new help tab uses document.write on about:blank; the nonblank-URL filter
incorrectly excludes populated tabs. Removed that filter from the harness.
Terminal DOM was retained, so the task verdict alone concealed this capture gap.
The capture fix still needs a rerun proving two target IDs. Local server session
2718 was stopped; fixture runner 6635 finished. Lint passed before this one-line
filter edit. Frozen pilot session 35322 remains active at Google Search--7.
Browser bundles remain unchanged; clock context for browser models remains pending.

Capture fix verification: webvoyager-multitab-proof-v3 reports 1 verified / 0
failed / 0 unverifiable. proof.json confirms three captured target IDs (initial
blank, opener, and help tab), no capture errors, and retained terminal DOM.
The fixture server was stopped. Lint passes.

Date-context rejudgment 1790708305022 no longer calls 2024 future, but its reason
is internally inconsistent about a result updated 21 hours ago. This is further
evidence that the automatic grader needs independent calibration, not proof of
accurate temporal grading. Original verdicts remain unchanged.

## Completed frozen pilot and clock context

Session 35322 finished. webvoyager-remediated-full-v2/report.json records
30 selected, 29 attempted, 11 verified, 18 failed, zero unverifiable, one excluded.
This is 37.9% automatic verification under v2, not an audited official score.
Five tasks received site_block. Booking--35 is disputed; GitHub--5 has an invalid
original date rationale and inconsistent rejudgment. Preserve raw results.

After the frozen pilot ended, added current UTC time to decision, field-value,
answer generation, completion, and answer-review model contexts. Relative-date
instructions use that time, preserving explicit historical dates. A new local
fixture validates today's ISO date against the browser clock without exposing it
to the agent beforehand. current-clock-v1-1790708411854.json: 4 verified / 0
unverifiable / 0 failed (current date, summary, comparison, new tab). Typecheck,
lint, and check:bundle all pass. Rebuilt bundles staged; no commit created.

No benchmark, fixture, or server processes remain active from this pass. Overall
goal remains active: answer review still needs evidence repair/resumed browsing,
unsupported claim rejection, navigation-loop diagnosis, unresolved CDP stalls,
boundary capability coverage, broader suite runs and held-out validation, and
independent evaluator calibration. The final pilot used the pre-clock bundle;
do not attribute its score to the clock fix.

## Completion-loop recovery and evidence audit

Answer preparation now runs inside completion verification. Missing evidence
returns to browsing with a repair hint and the existing repeated-completion bound.
Exhausted invalid drafts remain blocked without emitting the rejected answer.
Accepted answers are retained, avoiding a second generation after browsing ends.

Controlled real-browser proof answer-recovery-proof-1790708612214 injected one
premature goal/completion claim and one MISSING_EVIDENCE review; subsequent live
OpenRouter decisions navigated to the full report and returned the requested
information (done, one click). check-answer-review still passes placeholder
rewrite and invented-fact suppression: answer-review-check-1790708533975.

answer-recovery-v1-1790708559957: 5 verified / 0 unverifiable / 1 failed. The
summary verifier wrongly rejected multiline output; regex updated to allow
newlines. Rerun answer-recovery-summary-rerun-1790708570639: 1 / 0 / 0.
Typecheck, lint, and check:bundle pass. Main fixture suite session 8059 remains
active; poll it before assuming completion.

Live Apple--12 rerun webvoyager-answer-recovery-v1 was marked failed, but audit
found its claimed repair labels in observed controls. Previous judge input
omitted those controls. Apple--28 likewise had GPU specifications in controls.
This invalidates the earlier claim that no relevant evidence was observed; it
does not establish that either final answer satisfies every constraint.
Protocol v4 now includes bounded observed controls and their states, frames and
downloads; deduplication includes those facts. controls-evidence-audit.json
proves both repair labels survived extraction. Original verdicts unchanged.
Rejudgments are running; browser source/bundles have no changes during suite.

Protocol v4 rejudgments completed: Apple--12 at judgments/1790708813976
under webvoyager-answer-recovery-v1, and Apple--28 at judgments/1790708819037
under webvoyager-remediated-full-v2 both automatically verified. These are
separate diagnostic verdicts, not an amended pilot score. The GPU negative
claim still deserves audit: seeing a 16-core standard configuration alone
does not establish the absence of a larger configurable option. Do not equate
this automatic flip with independent proof of the absolute ceiling.

Main fixture suite finished: completion-fixtures-v1-1790708854582.json,
34 verified / 0 unverifiable / 0 failed / 0 infrastructure errors. No active
benchmark or fixture sessions remain. Current source/bundles passed typecheck,
lint, and check:bundle. Recovery flow is verified, including a real-browser
controlled premature-completion case; broader live-site/higher-tier and second
engine coverage remain pending. The goal is not complete.

Next priorities: independently audit negative/configuration claims and evaluator
calibration; diagnose navigation loops using preserved arXiv/BBC/ESPN/Wolfram
traces; finish boundary action and CDP stall investigations; run higher-tier and
agent-browser suites, then frozen held-out validation. Preserve heldout.json
unseen for tuning and keep all original evidence and verdicts intact.

## Clipped controls and second-engine regression pass

ESPN--35 original stderr repeatedly reports Target Busca covered by nothing.
Live DOM audit found a visible-sized input inside a zero-width overflow:hidden
ancestor. Shared snapshot visibility now intersects ancestor clipping bounds;
no site names or selectors are used. Local clipping-snapshot-proof.json confirms
the field is absent until revealed and the scroll pane remains discoverable.
Live espn-clipping-proof.json confirms the inaccessible field is removed while
Abrir busca and NBA controls remain. Added fx-clipped-search and fx-clipped-scroll.

Second-engine baseline completion-ab-fixtures-v1-1790709184411.json completed:
31 verified / 0 unverifiable / 3 failed (new-tab, covered-click, below-fold-next).
Agent-browser lacks tab following, rejects covered targets before its existing
DOM fallback, and fails to scroll below-fold targets before hit-testing.
Now scrolls a target into view before hit-testing and executes pane scrolls on
the observed pane rather than always scrolling the page. New-tab and covered
click still need fixes. Baseline source/bundles remained fixed during that run.

Current verification sessions (poll exact handles): 35099 clipping-ab-v1 targeted
6 tasks; 44733 clipping-cdp-fixtures-v1 all 36 main fixtures; 61039 live ESPN--35
at webvoyager-clipping-v1. Bundles are now frozen until these finish. Typecheck,
lint, and check:bundle pass. Bundle artifacts staged, no commit.

Navigation audit additionally found href already captured in ObservedAction but
dropped from model/space.ts elements and choose target criteria; recent_actions
also omits source URLs. arXiv repeatedly follows its current paper citation.
Consider exposing observed navigation facts (with unrelated fixtures), rather
than site-specific planning rules.

Targeted agent-browser clipping-ab-v1-1790709255506.json finished: 6 verified /
0 unverifiable / 0 failed, including the previously failing below-fold task,
clipped search, pane scrolling, shadow, nested frame, and hover. Session 35099
is terminal. Live ESPN rerun session 61039 finished: 0 verified / 0 unverifiable
/ 1 failed. It now opens search, types queries, reaches the Lakers team page,
and finds the next game; fails at finding the cheapest ticket within 30 steps.
No stale-storm termination: original root cause is fixed, overall task still fails.
Evidence: webvoyager-clipping-v1/report.json. The full CDP suite session 44733
remains live on the same frozen bundle; poll that handle next.

Full CDP clipping-cdp-fixtures-v1-1790709432080.json finished: 36 verified /
0 unverifiable / 0 failed / 0 infrastructure errors. Session 44733 is terminal.
Both engines passed the new clipping and pane tasks; below-fold agent-browser
regression is fixed. Typecheck, lint, and bundle checks are clean. No active
benchmark, fixture, or audit browser sessions remain from this pass.

Still open: agent-browser tab following and covered-target behavior (baseline
failures), boundary file/special input support, intermittent CDP input stalls,
model navigation/answer claim issues, consistent evaluator calibration, all
higher tiers and untouched held-out evaluation. Do not claim overall completion.

## Tab handling, field memory, and navigation context

Agent-browser now uses stable CDP target IDs from its tab-list API, adopts new
tabs in its isolated session, exposes focus-tab actions, and rejects vanished
targets. Tab parsing is separated from command-output parsing to retain the
500-line implementation cap. Startup tab discovery remains within cleanup-on-error.
Covered click/hover/context targets use the existing DOM dispatch path after
freshness and target validation, matching CDP behavior. Disabled/gone targets
do not use this fallback.

Initial ab-tabs-v1-1790709698757: 6 verified / 0 unverifiable / 1 failed. New-tab,
covered-click, below-fold, context, shadow form, pane scrolling passed; new
round-trip task failed. CDP round-trip also failed at text generation:
cdp-tabs-roundtrip-v1-1790709659195. Root cause: fieldContext omitted retained
observations, so the helper lost the report code after returning to the form.
Added observed_history to field generation. Navigation decisions now receive
already-observed href values and recent-action URLs previously discarded.

cdp-navigation-v2-1790709801079: 6 verified / 0 unverifiable / 0 failed, including
round-trip tab code transfer and choosing between identical link labels by
destination, plus history/summary/current-date/clipped-search regressions.
Typecheck, lint, and check:bundle pass; rebuilt artifacts staged. No commit.

Frozen-build checks currently active: session 59912, all 38 agent-browser main
fixtures; session 14866, both arXiv pilot tasks at webvoyager-navigation-v2.
Poll these exact sessions; do not restart. No source/bundle modifications during
these runs. Tab lifecycle probe session 39636 needs polling at this checkpoint.

Tab lifecycle proof ab-tab-lifecycle-proof.json passed: newly opened report
tab adopted; a subsequently closed target is rejected as stale; remaining tab
remains observable. Source clock/helper/navigation CDP checks all passed.

ArXiv run session 14866 finished. Blog task still fails. ArXiv--24 was marked
verified despite blocked/no_progress, no returned answer, and the judge reason
explicitly admitting missing first-author affiliation. adjudication.json records
this false-positive evidence without replacing the original raw verdict. Do not
use that automatic result as a success. Evaluator needs task-derived, separately
scored required outcomes with aggregation in code, plus calibration on known
complete/partial/unsupported cases, before a trustworthy score comparison.

Context-menu failure from the full agent-browser suite reproduced at
ab-context-rerun-v2-1790709917123 (0 verified / 1 failed). Trace showed the first
offered below-fold tile lacked contextMenu, so no CONTEXT_CLICK operation was
available. After a normal click scrolled it into view, that capability appeared,
but the model repeated DONE. Added a shared context-capability predicate, used
for both viewport and below-fold candidates (including tracked event listeners).
Source edited only; rebuild and verification pending full suite completion.

Full agent-browser ab-navigation-fixtures-v2-1790710049867 finished: 37 verified
/ 0 unverifiable / 1 failed (context). After the below-fold capability fix,
cdp-context-fix-v3-1790710101148: 3 verified / 0 unverifiable / 0 failed. Final
agent-browser targeted rerun session 59023 is pending at this log append.
All typecheck/lint/bundle gates are clean and bundles staged.

Immediate next priority is evaluator reliability, before another claimed score:
score each explicit required outcome independently and aggregate in code so an
acknowledged missing affiliation cannot coexist with verified. Freeze task-only
rubrics across compared runs, retain original verdicts, calibrate complete,
partial, unsupported, absent-answer, and action-only cases on unrelated evidence.
The report now explicitly says no audited pass rate exists. Navigation facts
improved local fixtures but arXiv live tasks remain incomplete; do not infer
live benchmark improvement from the false-positive automated label.

Session 59023 completed: ab-context-fix-v3-1790710125620.json, 6 verified /
0 unverifiable / 0 failed. This verifies the repaired context task plus covered
click, below-fold navigation, new tab, cross-tab code transfer, and href-based
navigation on the final bundle. No active eval/benchmark/audit sessions remain.
Goal remains active; evaluator calibration and the broader pending work above
are not complete.

## Required-outcome evaluator and calibration

Replaced a single judge verdict with manifest-defined required outcomes. Each
requirement specifies answer delivery or browser state/action. Requirements
contain no expected answers and never enter the agent goal. Pilot requirements
were authored after diagnostic runs; held-out requirements before any held-out
execution, without inspecting outcomes. Both manifests retain original task
selection/instructions/date policy.

V5 calibrated 8/9 exact labels: it conflated an unsupported ceiling with missing
delivery. V6 separates delivery (present/missing/not_required) from evidence
support (supported/contradicted/insufficient). Code rejects omitted/duplicate
checks, missing required answers, contradictions and site blocks; insufficient
evidence yields unverifiable. Prompt and hash, exact requirements and raw checks
are archived; resume checks prompt identity. Rejudging requires rubric wording
matching the saved task, with original results preserved.

Final generic-prompt calibration: judge-calibration-1790710596534, 12/12 matched
predeclared expectations (complete, partial, absent answer, contradiction,
sampled evidence, unsupported ceiling, action-only, dates, ordinary place scope,
explicit maximum, unmet browser state, security block). Earlier candidate
calibrations remain preserved. This finite calibration is not perfect accuracy.
Local full-browser V5 smoke webvoyager-judge-v5-smoke: 1 verified, 0 failed/
unverifiable; V6 saved-evidence regression below exercises the revised validator.

Previously false-positive ArXiv--24 is now failed: webvoyager-navigation-v2/
judgments/1790710682585/report.json. No answer was delivered for either paper
identification or required affiliation. Original false-positive verdict retained.

Consistent full rejudgments are active: session 20814 baseline
webvoyager-openrouter-current-v1; session 37272 remediated
webvoyager-remediated-full-v2. Poll exact handles. Browser code/bundles unchanged
this pass. Lint and syntax checks pass. Fixture HTTP server and all calibration/
single-task judge processes are finished.

## Final evaluator candidate and consistent scoring runs

GPT-4o V6 full-evidence rejudgments completed but exposed malformed check
fields and still accepted a maximum claim unsupported by configuration evidence:
baseline judgments/1790710670833 (3 verified / 24 failed / 2 unverifiable /
1 excluded); remediated judgments/1790710676045 (12 / 15 / 2 / 1). These are
retained candidate outputs, not the final comparison.

Verified current OpenRouter GPT-5.4 availability through the official model page
https://openrouter.ai/openai/gpt-5.4/providers. GPT-5.4 passed the unchanged
12-case calibration at judge-calibration-1790710852136, then classified saved
Apple--28 as unverifiable and Booking--35 as verified at
webvoyager-remediated-full-v2/judgments/1790710860760. No agent hints changed.

Protocol V7 selects openai/gpt-5.4 by default and constrains response fields/enums
with strict JSON Schema, retaining boundary validation for IDs/completeness.
Final schema-enabled calibration judge-calibration-1790710968452: 12/12 exact
expected verdicts. Lint and script syntax checks pass. Browser src/bundles unchanged.

FINAL consistent rejudgments are live: session 52975 baseline
webvoyager-openrouter-current-v1; session 83164 remediated
webvoyager-remediated-full-v2. Poll these exact handles before any restart or
score report. Both use GPT-5.4, V7, and identical task rubrics/prompt. Original
raw evidence, source metadata, and prior verdicts remain intact. No other live
processes remain from this pass. Review all new positives and disputes before
publishing a comparison. Held-out browser tasks remain unrun.

## Current saved-run comparison and rubric scope correction

The first V7 full grades completed at baseline judgments/1790711033989 and
remediated judgments/1790711045519, but a rubric scope audit found an unnecessary
delivery demand: qualifying facts such as course duration/rating need browser
support, not repetition when only course name/instructor were requested. Corrected
those modes/descriptions in both task manifests without changing agent goals.
Added two unrelated calibration cases proving supported-but-unrepeated qualifying
facts pass and unmet qualifying facts fail. judge-calibration-1790711204204:
14/14 exact expected verdicts.

Nine changed pilot rubrics rejudged on both saved runs, preserving all prior
outputs: baseline judgments/1790711348972; remediated judgments/1790711355000.
Both sessions 28626 and 74416 finished. compare-webvoyager.mjs selects latest
compatible judgments per task by original capture identity, exact instruction,
exact rubric, prompt hash, protocol, and judge model; it rejects live judgment
locks and missing compatible rows. No best-score selection. It records source
report paths/hashes and discloses the baseline's missing original bundle hash.

Output evals/results/webvoyager-comparison-v7.json: baseline 2 verified /
27 failed / 0 unverifiable / 1 excluded; intermediate remediated capture
11 verified / 17 failed / 1 unverifiable / 1 excluded. 29 attempted each.
This comparison does not measure later browser fixes or held-out tasks, and
should not be represented as an official or final current-build score.

No active eval, benchmark, judge, calibration, or fixture-server sessions remain
from this pass. Lint and script syntax checks pass; browser code/bundles unchanged.
Next: review comparison positives against evidence, finish affected higher-tier
regression suites (use dummy upload fixtures, not machine-specific files), then
run a frozen current-build pilot and the still-untouched held-out sample.
Remaining agent limitations and root-cause investigations are not complete.

## Current-build regression and held-out execution — September 29, 2026

Replaced machine-specific /etc upload paths with a harmless repository fixture;
the eval runner expands {{UPLOAD_FIXTURE}} to its absolute path. Typecheck,
lint, script syntax, and bundle consistency checks pass.

Active regression session 21378 runs tasks-hard.json with OpenRouter, traces,
and label higher-tier-current-2026-09-29. Early failures: Wikipedia language
navigation (no_progress) and disappearing-elements page (model_claim); rerun
before assigning cause. No source changes made in this pass.

Active held-out session 53367 runs the previously untouched 15-task manifest
into evals/results/webvoyager-heldout-current-2026-09-29. Browser build is frozen
for this run; do not tune using held-out outcomes. It runs concurrently with
the regression suite in isolated profiles, so timings are not a clean latency
benchmark. Poll exact sessions; neither run is complete yet.

Regression session 21378 is terminal: higher-tier-current-2026-09-29-1790712011874.json
has 22 verified / 0 unverifiable / 2 failed. Targeted rerun session 6183 is
terminal: higher-tier-rerun-2026-09-29-1790712012289.json has 0 verified /
0 unverifiable / 2 failed. Both failures reproduced. tin-disappearing reached
/about/ but the server returned Not Found; do not weaken completion to count
that as success. Wikipedia loop persisted (14 steps initial, 30 rerun).
Initial trace trace-c8bda268-4f94-4c8f-aa76-2ed59cdfdad4.jsonl shows no offered
Deutsch/German language link after opening the menu; element count shrinks
from 192 to 37 (sequence 472), then returns. Menu representation/visibility
needs a direct browser/DOM inspection before proposing a generic fix.

Session 70474 now runs tasks-harder.json with label
higher-tier2-current-2026-09-29 on the frozen build. Held-out session 53367
remains live (last output began ESPN--30). Earlier held-out tasks include
access blocks, incomplete answers, and unconfirmed dropdown execution; no
score yet and no held-out-specific tuning. No browser source changed.

## Delayed-menu decision freshness — September 29, 2026

Held-out session 53367 finished: webvoyager-heldout-current-2026-09-29/report.json,
2 verified / 13 failed / 0 unverifiable, all 15 attempted. This measures the
pre-freshness-change build; it is not an official score. All evidence preserved.
The harder suite finished at higher-tier2-current-2026-09-29-1790712323391.json:
25 verified / 0 unverifiable / 1 failed. crates-browse repeated as failed at
crates-rerun-current-1790712385575.json (0 steps); inspect access evidence.

Direct browser inspection found language options absent immediately after the
menu click and present 100ms later. Saved DOM proof language-dom-proof.json and
inspection script inspect-language.mjs live in evals/results/. A generic local
delayed-menu fixture reproduced the loop: delayed-menu-baseline-1790712287040.json,
0 verified / 0 unverifiable / 1 failed. Shared actStep now checks semantic
structure freshness before executing all decisions, extending its existing
DONE/BLOCKED check to actions. Click target freshness alone missed menu changes
while inference ran. No site selectors or task-specific hints added.

After fix: decision-freshness-cdp-1790712421335.json and
decision-freshness-ab-1790712431294.json each have 3 verified / 0 unverifiable /
0 failed. Typecheck, lint, and check:bundle pass; rebuilt bundles staged, no commit.
Wikipedia still fails at decision-freshness-wikipedia-1790712437966.json,
so the local timing defect is fixed but the live loop remains unresolved.

Active full fixture suites: CDP session 7370 (decision-freshness-all-cdp),
agent-browser session 10004 (decision-freshness-all-ab). Poll those exact handles;
all other sessions from this pass are terminal. Next inspect remaining live
Wikipedia loop and suite regressions. Do not claim held-out remediation complete.

## Context overflow retained-action recovery — September 29, 2026

Freshness full suites finished cleanly: decision-freshness-all-cdp-1790712730083.json
and decision-freshness-all-ab-1790712775842.json each have 39 verified /
0 unverifiable / 0 failed. Those captured the pre-shortlist bundle.

The remaining Wikipedia root cause was action truncation on context overflow:
trace-e13ff96f-974b-4492-8ea4-3d2a1383ed8a.jsonl request 312 included 233 elements
and Deutsch; retry 313 kept only the first 40 actions (37 elements), losing all
language menu options. This repeated on each menu opening. Replaced first-N
truncation with bounded group candidate selection, followed by the normal
operation/target decision over shortlisted actions. Every offered node action
is considered in a group; global controls remain available. No goal-specific
selectors or site hints. Additional calls add latency/cost on context overflow;
shortlist responses are traced and included in benchmark usage, and outer
choose latency now includes recovery calls. Completion still uses full state.

Controlled context rejection proof scripts/check-context-fallback.mjs passed
with real OpenRouter and Chrome at context-fallback-proof-1790712650962: the
agent exported using a control after 75 unrelated controls, beyond the old
cutoff. Usage assertion found all three shortlist responses. The new
fx-large-controls task covers ordinary operation on that page.

After rebuild: context-fallback-wikipedia-1790712818602.json has 1 verified /
0 unverifiable / 0 failed (three actions, German article reached).
context-fallback-cdp-1790712839872.json and context-fallback-ab-1790712850750.json
each have 3 verified / 0 unverifiable / 0 failed, covering large controls,
delayed menus, and link destinations. Typecheck, lint, check:bundle clean;
bundles staged without a commit. All sessions from this pass are terminal.

Remaining: audit held-out failures by generic cause (do not retune its tasks),
finish highest-tier regression coverage, investigate incomplete answer support
and navigation/field-input failures, then freeze a final current-build pilot.
Held-out 2/15 still refers to the earlier build; no claim these two fixes
resolve its failures or establish a new benchmark score.

## Native-select overlap investigation — September 29, 2026

Active highest-tier session 35017 runs highest-tier-current, selecting 19 tasks
and explicitly excluding tin-forgot-password (external email submission).
Its bundle remains frozen at the context-fallback build. Existing highest-tier
verifiers need scrutiny: demoqa double/right-click text regex also matches the
button labels, and some tasks only require status done. These do not establish
the requested outcome; strengthen before citing full behavioral coverage.

Held-out Amazon--11 stopped at an observed native select with a styled overlay.
Local fx-styled-select reproduces exactly: styled-select-baseline-1790712999409.json,
error before any action, Dropdown execution was not confirmed. The eval harness
classified this as infra because steps=0 (infra 1, verified 0); this is an
execution defect, not provider infrastructure. Fix that classification separately.

Source changes now skip pointer-hit coverage only for native select operations
in CDP input.ts and agent-browser ab-target.ts. Selection sets an observed native
option rather than clicking a point; connected/enabled/option validation and
freshness still apply. Typecheck and lint pass. Bundles intentionally not yet
rebuilt while session 35017 runs. Direct source proof session 64778 was launched
via evals/results/check-styled-select.mjs. Required real eval suites and bundle
check remain pending; do not call this source change complete yet.

## Selection fix verified and eval accounting corrected

Highest-tier session 35017 finished: highest-tier-current-1790713149765.json
reported 18 verified / 0 unverifiable / 1 failed, but the double-click verifier
was false positive (button label matched; actual confirmation absent). Do not
present that as 18 proven outcomes. The sorting-answer failure reproduced.

Strengthened demoqa click verifiers to actual completion messages; double-click
goal now requires its real event outcome instead of suggesting unsupported Enter
substitution. Right-click passes. Date verifier now requires the observed exact
selected calendar day, because final_state omits text input values. The initial
attempt to match 01/15/1990 failed despite January 15 selected=true in evidence;
that was a verifier error, not an action failure. Corrected subset
highest-tier-corrected-1790713258014.json: 1 verified / 0 unverifiable / 3 failed
includes that known date-verifier false negative. A fresh date-selected-state
run is active; obtain its final count before reporting.

Native-select overlap fix is now bundled and verified through real suite runs:
select-overlap-cdp-1790713215035.json and select-overlap-ab-1790713234992.json each
4 verified / 0 unverifiable / 0 failed (styled select, covered click, nested frame,
shadow form). Typecheck, lint, check:bundle pass; bundles staged without commit.

Eval runner no longer calls every zero-step error infrastructure. Only explicit
known credential/credit errors receive that category; both infrastructure and
behavioral failures now produce exit 1. scripts/check-eval-accounting.mjs tests
the executable runner with controlled CLI responses; both cases pass.

Sorting trace trace-54a1d8b8-bcc7-4009-9dc2-594bd94b339d.jsonl shows raw text flattens
table headers/rows. Helper first returned Frank, then correct Bach; review
rejected both. A generic table representation needs investigation rather than
weakening answer review. Double-click remains unsupported and is now honestly
failing. No higher-tier sessions remain except the final date-selected-state run.

Date verification handle: session 71049. Poll that exact handle if still live.

Session 71049 terminal: date-selected-state-1790713310140.json has 1 verified /
0 unverifiable / 0 failed. All sessions from this pass are now terminal.

## Double-click capability — September 29, 2026

Added DOUBLE_CLICK to the decision operation space, reusing click_target rather
than duplicating a large target question. Agent steps preserve double_click in
history. CDP sends two native down/up pairs with clickCount 1 then 2; covered
fallback dispatches the complete pointer/mouse sequence plus dblclick. Shared
helper uses the target document's event constructors for frame/shadow controls.

Agent-browser's installed native dblclick command was reproduced emitting only
one click event before dblclick(detail=2): trace-fb2f6758-3093-409c-8a32-75610b72d992.jsonl,
first post-action request had clicks=1. Initial AB suite 5/6; targeted rerun
failed again. AB now uses the complete synthetic sequence for all double-clicks,
including frame/shadow/covered targets. This is explicitly documented as
isTrusted=false, not native/trusted parity. CDP ordinary targets remain native.

Four deterministic fixtures require exactly two click events and dblclick with
detail 2 before confirming the preview. Final evidence:
- double-click-cdp-1790713513046.json: 6 verified / 0 unverifiable / 0 failed.
- double-click-ab-fixed-1790713667058.json: 6 verified / 0 unverifiable / 0 failed.
- double-click-live-1790713509753.json: 2 verified / 0 unverifiable / 0 failed
  (DemoQA real double-click and right-click outcome messages).
Typecheck, lint, check:bundle pass; rebuilt bundles staged, no commit.
Verification map now includes fixture-double-click.md with both-engine recipe.

Active full fixture regression: session 6632, label double-click-full-cdp.
Poll that exact handle before any rebuild. All other sessions in this pass are
terminal. Remaining scope includes table evidence/answer reliability, incomplete
answer handling, other benchmark navigation failures, and final frozen pilot.

## Structured table observations — September 29, 2026

Full prior double-click CDP suite completed: double-click-full-cdp-1790713914834.json,
45 verified / 0 unverifiable / 0 failed. No prior sessions remain active.

Added bounded native/ARIA table observations (headers/data cells, ordered rows,
spans, scope, aria-sort, label and document URL) from gathered document/shadow/
same-origin frame roots. Up to 3 tables, 16 rows, 12 cells per row and 6000 text
characters; truncation and omitted tables disclosed. Both engines share the
snapshot. Table changes enter fingerprint and structure freshness. Decision,
answer generation, current review, and retained observations receive tables.
No table answers, site selectors, or task-specific values enter implementation.

The unrelated fx-table-answer fixture was already 3/3 passing before the change
(table-evidence-baseline-1790713818800.json), so it is coverage, not claimed proof
of improvement. scripts/check-table-evidence.mjs confirms literal headers,
initial/sorted row values, sort state, and the independent archive table;
evidence table-shape-proof-1790714002015. New suites:
- table-evidence-cdp-1790713979451.json: 4 verified / 0 unverifiable / 0 failed.
- table-evidence-ab-1790713976521.json: 4 verified / 0 unverifiable / 0 failed.
- table-evidence-live-1790713996390.json: 3 verified / 0 unverifiable / 3 failed;
  email lookup passes 3/3, sorting answer fails 3/3.

The remaining sorting failure is now isolated: helper returns correct Bach;
answer_review_request contains first table headers Last Name, First Name and
first data row Bach, Frank, but Jev chooses REWRITE repeatedly. Table evidence
alone did not resolve the review failure. Next independently calibrate complete/
supported/missing answer decisions, including this class and unrelated negative
controls. Do not weaken expected answer or claim table fix solved the task.

Typecheck, lint, check:bundle passed for source change; new proof script spacing
fixed and lint rerun. Bundles staged, no commit. All sessions from this pass are
terminal. Remaining: answer-review reliability and incomplete answers, final
current-build pilot, and honest handling of unresolved site/model limitations.

## Answer-review model calibration and repair — September 29, 2026

Jev review rejected a correct unrelated table answer under original wording,
review-goal framing, answer-only framing, and separate coverage/support questions.
Saved calibration reports 1790714142902, 1790714188193, 1790714222108 reproduce it;
the other seven cases passed. Separate checks isolated incorrect factual-support
classification, not coverage. Do not keep prompt-tuning toward this one answer.

The configured Mercury reasoning helper passed the table case but failed missing
identification and maximum-configuration evidence in expanded calibration.
GPT-5.4 passed the unchanged 14 cases at answer-calibration-1790714433883.
Runtime now uses a separate structured reasoning review with validated enum/reason,
feedback for one regeneration, and one retry only for transport/malformed output.
Jev classifies whether a written answer is needed before text generation/review,
preserving action-only operation without helper credentials. Disagreement about
whether an answer is required fails closed. Jev still chooses browser actions.

OpenRouter text endpoints default ANSWER_REVIEW_MODEL to openai/gpt-5.4; other
text endpoints retain TEXT_MODEL. Override is explicit and benchmark model_config
records the effective choice. External judge also uses GPT-5.4: separate calls,
not independent model families, disclosed in docs. Review usage comes from actual
text_helper_response (now including response ID); Jev answer_scope_response is
also accounted. Review verdict trace is separate to avoid duplicate charges.
Text helper now validates content presence instead of throwing a raw TypeError
on a provider response without choices. No missing answer is accepted as success.

Evidence:
- reasoning-review-live-1790714641715.json: 6 verified / 0 unverifiable / 0 failed;
  sorting and email lookup each 3/3, against unchanged expectations.
- answer-review-check-1790714589346: placeholder rewrites to supported answer;
  repeated fabricated facts block with no answer. Local generation fixture proxies
  review requests to real configured OpenRouter model; reviews are not mocked.
- answer-recovery-proof-1790714594425: real missing-evidence review sends the
  agent back to browse after controlled premature goal/completion proposals.
- final scope+review calibration answer-calibration-1790714721697: 14/14.
- action-only-no-text-key-1790714729997.json: 1 verified / 0 unverifiable / 0 failed.
- reasoning-review-final-ab-1790714768817.json: 5 verified / 0 unverifiable / 0 failed.
Typecheck, lint, check:bundle pass; bundles staged, no commit. All verification
sessions above are terminal. This repairs the reproduced review defect; finite
calibration does not prove all future judgments correct.

Fresh frozen pilot now launched into
webvoyager-current-review-2026-09-29. Preserve build until it finishes, inspect
remaining failures, and audit positives. Held-out remains the earlier 2/15
capture, not a current-build score. Overall goal remains incomplete.

Active fresh pilot handle: session 90331. Poll this exact handle; do not restart
solely because observing it times out. No other live sessions from this pass.

## Fresh-pilot evidence audit and countdown regression

Pilot session 90331 remains live on its original frozen bundle. Last observed
output began BBC News--8 after ArXiv--24 failed. Do not rebuild bundles until
this run is terminal, and do not restart based on observation timeouts.

Audit found a correlated false positive on Apple--28: runtime GPT-5.4 reviewer
and external GPT-5.4 judge accepted a maximum claim from overview/chip-help
content. Final page explicitly says M5 Pro has 2 options, but those configurations
were not inspected. Saved adjudication.json marks it unverifiable, preserves raw
verdict, and hashes run.json. The automatic pass count is not an audited score.
Apple--12 and ArXiv--38 were inspected against raw page actions/final text and
have supported adjudications. Other positives still require review. This is a
remaining evidence-coverage problem despite finite review calibration passing.

Amazon--23 failed before any action with stale_storm. Trace shows changing
HH:MM:SS countdowns in unrelated product-link labels: five structure mismatches
and four full mismatches. Local countdown-baseline-1790715032122.json reproduces
0 verified / 0 unverifiable / 1 failed with zero actions.

Source-only fix: structure projection normalizes clock-shaped portions of action
labels, and pre-decision observation check uses structure rather than raw full
text. Chosen click/select targets still use exact guards; double_click now gets
that same exact guard in both engines. Price/quantity labels are not normalized.
Delayed control additions/removals still invalidate semantic freshness.

scripts/check-countdown-freshness.mjs uses actual agents on both engines and
checks raw freshness rejects ticks, semantic freshness permits them, changed
clock targets still reject (click and double-click), and a stable report target
remains usable. countdown-proof-1790715142805: both engines done in one action.
Typecheck/lint pass. This is not a replacement for eval suite evidence: the new
fx-countdown-controls task needs a rebuilt-bundle suite run after frozen pilot
finishes, along with delayed-menu/related freshness regression coverage.
Bundles intentionally remain at the pilot build, so check:bundle is pending.
All local diagnostic sessions are terminal; only pilot 90331 remains live.

## Audited reporting and continuing pilot

Added scripts/audit-webvoyager.mjs. Completed runs can produce a separate report
with raw and adjudicated counts, original judgments, hashed review provenance,
and an explicit list of unreviewed passes. Refuses live runner locks, stale
run hashes, excluded-task overrides, and overwrites. CLI verification passes in
scripts/check-webvoyager-audit.mjs; lint passes. No runtime or bundle changes in
this pass. Countdown source fix still requires bundle rebuild and suite evidence
when the frozen pilot terminates.

Pilot session 90331 remains live; last output started ESPN--32. Do not restart
or rebuild its bundles. New passes include Booking--35 and both Coursera tasks.
Coursera--12 audit supports its course/beginner designation. Coursera--23 audit
is unverifiable for the instructor role: captured search-card provider name is
not explicit evidence of course instructor. Raw verdicts remain unchanged.
Booking--35 still needs a saved adjudication. Run the audit report command only
once the pilot finishes, and inspect all other passes before quoting a score.

ArXiv--24 repeats the same current-document link five times despite an observed
HTML full-text link. No context truncation: all 50 controls were offered. Dead
node suppression resets across document reloads, and label-based toggle logic
can misclassify repeated navigations. No change made without a deterministic
reproduction and pagination regression proof; this remains an open deficiency.

## False pagination toggle reproduced and removed

New fx-pagination task advances a five-page inventory. Frozen-build baseline
pagination-baseline-1790715722431.json verifies 1/0/0, but its trace proves the
label heuristic removes Next page after two successful clicks. The agent claims
BLOCKED, incurs a blocked-probe wait, then recovers: five actions, six decisions.
Thus this is an unnecessary blocked/wait cycle, not a claimed baseline failure.

Removed toggleHint and its action filtering from followup.ts, agent.ts, and
steps.ts. Two same-label successful clicks do not establish a reversible toggle;
existing no-progress fuses remain. No website names or pagination-label exceptions
were added. Real source agents on both engines complete in exactly four clicks:
evals/results/pagination-source-1790715784095/{cdp,agent-browser}.json.
Typecheck and lint pass. Source proof does not replace required bundled evals:
run fx-pagination, menu/toggle regression tasks, countdown and delayed-menu tasks
after the frozen pilot finishes. Bundles still intentionally unchanged.

Only live process is pilot session 90331; last poll began Google Flights--6.
Pagination baseline session 93209 and source proof 89410 are terminal. Added
pilot passes GitHub--3, GitHub--5, Google Flights--37 still need saved evidence
adjudications. GitHub--3 storage numbers are not in final_text; inspect earlier
trace observations/control labels before accepting or rejecting its answer.

## Further pass audits

Saved supported adjudications for Booking--35 and GitHub--5, each bound to the
run.json hash. Booking's observed article text supports the three places and
summary; the goal does not restrict places to beaches or cities. GitHub's final
result supports Python, 3.6k stars, and updated 22 hours ago.

GitHub--3 trace has the 500MB/2GB/50GB Packages storage controls; final viewport
text alone omits them. Tier association still needs checking before saving its
adjudication. Google Flights--37 final itinerary supports distinct outbound and
return carrier sets; its dates/year still need full evidence audit. New automated
pass Google Flights--6 also needs review. Corrected README's stale 'independent'
judge wording: separate calls use the same model family.

Pilot session 90331 is confirmed live and last output began Google Map--39.
Do not rebuild bundled/ until terminal. Pending source fixes remain countdown
freshness and removal of the false label-based toggle filter; both require the
actual bundled eval suite after the pilot. No additional live processes.

## Date and table audits

Saved verified adjudications for both Google Flights tasks. Final state and
itinerary support the requested routes/classes/carriers. Decoding the saved URL's
base64url tfs query confirms exact 2026 dates (Oct 29/Nov 2 and Dec 19/Dec 26).
No live search or new page evidence was substituted for execution evidence.

GitHub--3 is supported: trace page.tables includes the header Features/Free/Team/
Enterprise and GitHub Packages row with 2GB under Team and 50GB under Enterprise.
Saved its verified adjudication against run hash. This resolves the earlier
uncertainty from viewport-only text and demonstrates useful table evidence.

Pilot 90331 still live; last output started Google Search--7. Google Map--39 is
raw unverifiable (route summaries without expanded directions); Google Map--1
failed without a returned bus-stop name. Bundles remain frozen. Pending source
verification and remaining shortcomings described above still apply.

## Site-block attribution

Google Search--7 run confirms an unusual-traffic verification page, repeated
verification clicks, and no delivered answer. Saved failed/site_block adjudication
bound to run hash. The failure should not be described merely as answer quality;
repeated unchanged verification actions remain a recovery deficiency.

Pilot 90331 is live; latest poll began Huggingface--28 after Huggingface--36
raw verified. Still no bundle rebuild. Planned targeted suite after terminal:
fx-countdown-controls,fx-pagination,fx-delayed-menu,fx-hover-menu on both engines,
then broader fixture coverage if changes/failures warrant. All new source changes
still require bundled suite evidence and check:bundle before completion.

## Pilot terminal; pending bundle fixes verified

Pilot session 90331 exited 1 normally after all selected tasks: raw counts
13 verified / 15 failed / 1 unverifiable / 1 excluded, 29 attempted. All automated
passes now have saved evidence reviews; two downgraded. Separate immutable report:
evals/results/webvoyager-current-review-audited-2026-09-29.json gives 11 verified /
15 failed / 3 unverifiable / 1 excluded; unreviewed_verified is empty. Fourteen
results reviewed total (all 13 passes plus Google Search site-block attribution).
This remains a custom pilot score for the frozen pre-countdown/pre-pagination-fix
build, not the latest worktree or an official leaderboard score.

Rebuilt and staged bundled/ after terminal; no commit. Required check:bundle
passes. Typecheck/lint passed after source edits. Actual bundled suite evidence:
- freshness-pagination-cdp-1790716121643.json: 4 verified / 0 unverifiable / 0 failed.
- freshness-pagination-ab-1790716133096.json: 4 verified / 0 unverifiable / 0 failed.
Both cover fx-hover-menu, fx-delayed-menu, fx-pagination, fx-countdown-controls.
Pagination is four clicks and countdown is one click on both engines. These close
the pending bundle verification for those two fixes; do not claim they resolve
other pilot failures. Sessions 66087 and 30469 are terminal; no live processes.

Remaining work includes exhaustive/role-specific answer coverage false positives,
repeated navigation/verification recovery, failed live task causes, and a current
build benchmark after further changes. Overall goal remains incomplete.

## Reproduced evidence-review false positives

Exact saved answer_review_request inputs replayed through current GPT-5.4 reviewer:
evals/results/coverage-review-replay-1790716232721/{Apple--28,Coursera--23}.json.
Both again SUPPORTED. Reviewer explicitly treats no observed higher option as
proof of a ceiling, and offered-by identity as instructor identity. This confirms
repeatable review defects, not just one stochastic pilot judgment.

Extended check-answer-calibration.mjs with unrelated battery-option and workshop
role cases, retaining all previous cases. Baseline answer-calibration-1790716204690:
17/18 pass, ambiguous-role fails (SUPPORTED vs MISSING_EVIDENCE). Explicit distinct
provider/instructor is correctly rewritten; complete option list is correctly
accepted; unopened battery options correctly require evidence. This separates
role ambiguity from outright contradiction and shows simple maximum calibration
alone misses the realistic failure. Lint passes. No runtime changes this turn.

Replay session 23342 and calibration 27695 are terminal. No live processes.
Next work: repair review proof requirements generally, rerun all calibration plus
exact saved contexts, then exercise evidence gathering through real fixture suite
and both engines before calling the runtime behavior fixed. Existing bundled
countdown/pagination verification remains valid.

## Role ambiguity fixed; realistic maximum claim still open

Updated reviewer rules to require evidence of the requested relationship rather
than treating provider/publisher/nearby identity as instructor/author/other role.
Added general proof requirements for negative and exhaustive claims. No site or
benchmark identity is present in runtime rules. Replay coverage-review-replay-
1790716307418 rejects Coursera--23 as MISSING_EVIDENCE; Apple--28 still incorrectly
SUPPORTED. Do not claim the maximum-configurations defect fixed.

Expanded calibration answer-calibration-1790716302330 passes 18/18. The generic
battery example already passed before the change; this is not evidence of a
maximum-claim improvement. A phrase referring to chip help was generalized to
summaries before the bundled browser tests, avoiding product-specific rules.

Added evidence-coverage.html and fx-evidence-role / fx-evidence-options with actual
answer and observed-detail expectations. Bundled suites:
- coverage-review-cdp-1790716417640.json: 3 verified / 0 unverifiable / 0 failed.
- coverage-review-ab-1790716438083.json: 3 verified / 0 unverifiable / 0 failed.
Each includes table-answer regression. CDP role trace proves MISSING_EVIDENCE on
ambiguous name, then detail click, then SUPPORTED explicit Kai Reed instructor.
Both engines finish each new fixture in one click. Typecheck, lint, check:bundle
pass; bundles rebuilt/staged, no commit. Sessions 21533,96575,3028,24376 terminal;
no active processes.

Next evidence avenue for remaining maximum failure: review context labels viewport
text and truncated history without explicit coverage metadata. Current history
cuts text at 1500 and actions at 20, current text at 6000/actions at 60. Distinguish
observed absence from unobserved material; investigate before another prompt-only
iteration. All other unresolved pilot shortcomings remain in scope.

## Observation scope disclosed; acceptance bias experiment

Runtime observations now carry text_scope describing viewport-only text, local
excerpt/control-state truncation, and count of omitted available actions. History
compaction updates those flags/counts rather than silently truncating. Decision,
field generation, and answer generation also identify viewport text scope.
No claim that this makes missing evidence impossible or solves maximum review.

Controlled coverage-experiment-1790716509551: baseline low reasoning and medium
reasoning both wrongly SUPPORTED the saved maximum claim; scope disclosure once
returned MISSING_EVIDENCE. Repeated scope replay coverage-scope-replay-1790716598230
returned SUPPORTED 3/3, so the apparent improvement was not stable. Keep the
truthful metadata but do not count the maximum defect as fixed.

Calibration answer-calibration-1790716593065:18/18. Bundled suites:
- observation-scope-cdp-1790716692072.json:6 verified/0 unverifiable/0 failed.
- observation-scope-ab-1790716701509.json:6 verified/0 unverifiable/0 failed.
Each covers summary, comparison, missing-evidence recovery, table answer, role,
and configuration detail gathering. Typecheck/lint/check:bundle/diff check clean;
bundles staged, no commit. All calibration/replay/eval processes terminal.

Diagnostic answerability-probe-1790716712247.json removes proposed_answer and
asks only whether evidence answers the goal. GPT-5.4 correctly returns insufficient,
explicitly noting the unobserved second configuration. This is one diagnostic,
not yet a runtime fix or stability proof. Next: repeat this answer-blind assessment
on exact saved failure and supported/unrelated cases before adding an extra gate.
Probe session74894 terminal; no live processes. Full objective remains incomplete.

## Evidence-only gate prototype and alternate reviewer experiment

Added model/evidence-review.ts and check-evidence-review.mjs as an UNWIRED
prototype. It constructs its request from explicit evidence fields, excluding
proposed_answer, and validates factual lists and sufficiency consistency.
No runtime call or default model changed. Typecheck/lint/diff check pass.

Evidence-only calibration evidence-review-1790716823750: all 17 informational
contexts plus three exact maximum replays pass (20/20). Broader saved-pilot test
evidence-review-1790716875501 has three disagreements: over-narrows Booking
places to beaches, rejects pricing summary coverage, rejects language tag scope.
General example-scope clarification fixes Booking in evidence-review-1790716946278
but still disagrees on pricing and wrongly accepts the Coursera instructor role.
Do not wire this gate into runtime: it trades false approvals for other errors.

OpenRouter /api/v1/models confirms anthropic/claude-opus-5.5 available as of this
run date. Existing reviewAnswer with that override was tested in
review-model-comparison-1790717032522. It catches both maximum and instructor
false positives, accepts most other answers, requests extra evidence for Apple
repair methods, and rewrites the flight comparison and pricing summary. Those
are behavior differences, not a proved improvement. Google Flights--6 returned
NOT_REQUESTED correctly (action-only goal); the saved comparison's expected
SUPPORTED was too broad because it derived expectations from external task
verdicts, which include browser-only success. Do not count that as a reviewer bug.

Two CURRENT LIVE processes, confirmed by handles:
- 36474: ANSWER_REVIEW_MODEL=anthropic/claude-opus-5.5 JEV_PROVIDER=openrouter
  node scripts/webvoyager.mjs --tasks Apple--28,Apple--12,Coursera--23,Google Flights--37,Huggingface--36,Huggingface--28
  --out evals/results/webvoyager-opus-review-2026-09-29
  Last output running Apple--28. Frozen current bundle; do not rebuild while live.
- 88448: ANSWER_REVIEW_MODEL=anthropic/claude-opus-5.5
  node --import tsx scripts/check-answer-calibration.mjs
  Last observed through table-wrong-column, all passing so far.
All earlier sessions (13509,67989,5241,88260) terminal. Poll exact live handles;
do not restart on observation timeout. Default reviewer remains GPT-5.4 and the
prototype is not adopted. Next action is inspect completed calibration and live
comparison, including whether stricter review gathers evidence or merely blocks.

Follow-up before handoff: calibration 88448 terminal, answer-calibration-
1790717130231 passes 18/18 with Opus override. Pilot 36474 still live, last output
began Coursera--23 after two automated passes. Apple--28 independently audited
verified: final technical specs text explicitly shows configurable 20-core GPU,
answer yes correctly cites it. It reached those specs after 25 actions. This is
stronger evidence than the unsupported no from the prior pilot, though differing
live navigation means improvement cannot be attributed solely to reviewer choice.
Apple--12 raw verified; still needs saved audit in this comparison. Only active
handle now 36474. Preserve bundle until six-task comparison finishes. Default
reviewer still unchanged; full goal remains incomplete.

## Reviewer comparison, table compaction, and viewport bounds

Six-task Opus comparison terminal (36474):4 verified/2 failed. Coursera--23 audit
is verified: reviewer rejected offered-by identity, agent opened course page,
explicit Instructor label established role. Apple--12 saved audit supports the
named repair links. Google Flights--37 raw verified still needs saved audit.
Huggingface--28 failed in a repeated Model card click loop without reaching answer
review. Huggingface--36 errored on completion max_tokens_exceeded.

The latter repeats the same ~17K-character table payload across seven observations.
Added compactObservations transport projection: keeps distinct table versions and
references exact repeated copies in current/history; does not mutate stored history.
Used consistently by decisions, completion, answer review, and text helpers.
completion-compaction-1790717485741 reproduces original provider rejection, then
accepts identical evidence with references:140351 to34840 serialized JSON characters.
Jev returns a valid INCOMPLETE assessment; this proves transport recovery, not task
completion. Direct contrasting table versions check preserves old18/current12 and
reference positions without mutating history.

Default OpenRouter answer reviewer now anthropic/claude-opus-5.5; source/harness/
check script/docs agree. External judge remains GPT-5.4. The failed extra gate was
moved to scripts/lib/evidence-review.ts (diagnostic only, never wired into runtime).
No task/site-specific runtime condition added. Preliminary bundled suites:
compact-opus-cdp-1790717619910 and compact-opus-ab-1790717630097:6/0/0 each;
compact-opus-action-only-1790717616935:1/0/0 with TEXT_MODEL_API_KEY empty.

Two-task rerun webvoyager-compact-opus-2026-09-29 terminal (66068):1 verified/1 failed.
Model search passes with a different model. Pricing fails before answer review:
Mercury generation twice returns finish_reason=stop, content=null (not token cap;
usage513 and455 completion tokens). This is a new reproducible response-content
failure to address; output blocked safely, no fabricated answer. No trace yet
supports an automatic fallback implementation.

Controlled generation check answer-review-check-1790717669497 exposed false
rejection of a complete station report: scope warning did not include document
extent. Added actual viewport top/height/document_height to observations, decision,
and text contexts. Retest answer-review-check-1790717783875 passes placeholder
rewrite->supported and fabricated facts->blocked. Typecheck/lint/check:bundle pass;
rebuilt bundles staged, no commit.

CURRENT LIVE final verification handles:
-9948: six answer fixtures CDP, label viewport-opus-cdp.
-69869: same agent-browser, label viewport-opus-ab.
-39009:18-case answer calibration, now with explicit full-document viewport bounds.
Poll exact handles; all earlier processes terminal. These verify the final viewport
metadata after preliminary suites, so do not call their results complete yet.
Known open work: empty text-provider response recovery, repeated navigation loops,
other pilot failures, and fresh current-build benchmark after repairs.

Final verification now terminal:
- viewport-opus-cdp-1790717923910.json:6 verified/0 unverifiable/0 failed.
- viewport-opus-ab-1790717934859.json:6 verified/0 unverifiable/0 failed.
- answer-calibration-1790717870998:18/18 with viewport bounds, including explicit
  unopened alternatives despite the whole rendered document fitting in view.
Sessions9948,69869,39009 all exited0; no active processes. Default reviewer and
compaction/viewport changes meet required checks, but overall goal is not complete.

Next actionable provider issue: distinguish malformed/empty model messages from
legitimate null answers. A bounded alternate-model generation attempt may recover
empty content without inventing missing evidence; reproduce with controlled empty
responses and real fallback generation before adopting. Keep actual model usage
traceable. Do not retry arbitrary unsupported answers through multiple models to
get an approval. Repeated navigation loops and broader live failures remain open.

## Malformed answer-response recovery verified

Baseline answer-review-check-1790718082770 reproduces empty provider content:
bundled CLI blocks although station evidence is complete. Added typed malformed
response/refusal distinction and strict answer-object validation. An invalid
message, invalid JSON, or invalid answer object can use the existing second
generation attempt on ANSWER_REVIEW_MODEL. This does not add attempts and does
not switch models for a valid null answer, an unsupported claim, or a refusal.
Normal review still gates all delivered answers; fallback model/reason and usage
are traced. README documents this behavior.

Expanded check-answer-review.mjs with --case selection and seven contrasting cases.
answer-review-check-1790718129356 passes all seven: placeholder rewritten; fabricated
facts blocked; empty/invalid JSON/invalid-schema responses each recover with one
fallback call; valid null blocked with no fallback; refusal blocked immediately
with no fallback. Saved recovered answers also checked for 18,12,Tuesday,14:00,
16:00,UTC (the complete requested facts). Session60238 terminal.

Required bundled suites:
- answer-fallback-cdp-1790718219518.json:6 verified/0 unverifiable/0 failed.
- answer-fallback-ab-1790718223648.json:6 verified/0 unverifiable/0 failed.
Typecheck/lint/check:bundle pass; rebuilt bundles staged, no commit. All test
processes terminal (81980,9106,42790 included).

Live pricing rerun webvoyager-answer-fallback-2026-09-29 terminal (96074):0 verified/
0 unverifiable/1 failed. It blocks completion after11steps; no text-helper call or
fallback occurred, so this is not evidence of fallback success or failure. Request
history has rolled off the initial pricing-plan observations after scrolling;
Jev completion returns INCOMPLETE, then NONE basis. Investigate retained evidence
and repeated DONE recovery rather than assume the provider fix solves this task.

Huggingface prior Model card loop has one changed click then four unchanged clicks
while pending_requests remains1. Cross-document dead-target reset and repeated-link
recovery remain actionable. No live processes at this handoff. Full goal incomplete.

## Reload recovery and answer-scope validation — 2026-09-29

Repeated identical document reloads previously reset ineffective-target counters.
Counters now follow the observed fingerprint, retaining failures across identical
reloads and resetting when observable content changes. The controlled baseline
reload-recovery-1790718519446 failed after four repeats; fixed evidence in
reload-recovery-1790718559922 passes on both engines after two ineffective clicks.
Added fx-reload-recovery with a runnable answer and destination expectation.

Full fixture suites before the subsequent scope correction:
- evals/results/reload-full-cdp-1790718899285.json:50 verified/0 unverifiable/1 failed.
- evals/results/reload-full-ab-1790719017071.json:49 verified/0 unverifiable/2 failed.
Failures were answer-scope disagreement after successful browser actions:
fx-clipped-scroll on both engines and fx-tab-roundtrip on agent-browser.
The clipped-scroll rerun reproduced the failure in
reload-scroll-rerun-1790718936271.json (0/0/1).

The independent answer reviewer already classifies action-only requests with
NOT_REQUESTED. Runtime now honors this verdict after separate action-completion
verification, discarding the unnecessary answer instead of declaring failure.
Expanded calibration distinguishes action confirmation from informational
confirmation; answer-calibration-1790718979402 passes all20 cases, including
missing evidence, incorrect answers, relationship ambiguity and unopened options.
Required actual suites after correction:
- evals/results/scope-cdp-1790719069627.json:5 verified/0 unverifiable/0 failed.
- evals/results/scope-agent-browser-1790719077561.json:5 verified/0 unverifiable/0 failed.
Both include the two previously failing actions, summary, comparison and reload
recovery. Typecheck/lint/check:bundle pass. Rebuilt bundles staged; no commit.

Live targeted run webvoyager-reload-recovery-2026-09-29 is terminal:1 verified/
0 unverifiable/1 failed. Huggingface--28 passed. ArXiv--24 failed field generation
(invalid response followed by valid nulls), before exercising reload recovery.
This is not a fresh full benchmark score. Evidence retention on long pages,
field-helper failures and remaining live benchmark failures are still unresolved.
All processes launched for this section are terminal.

## Field-generation diagnosis — 2026-09-29

Inspected the ArXiv--24 failure from webvoyager-reload-recovery-2026-09-29.
The agent reached paper2609.35703 and selected the valid Search arXiv textbox
while the first author's affiliation remained unknown. The text helper received
original goal, field, current page and retained history, but no explicit query
intent for the newly selected search. One malformed response was followed by two
valid {"text":null} responses. steps.ts currently retries all these as identical
errors and then terminates the entire task; no text was entered.

Reconstructed the final field context from captured page/model-request/history,
expanding compacted table references before rebuilding fieldContext. The replay
uses the current clock rather than the original request timestamp, so it is not
byte-identical. Evidence: evals/results/field-replay-1790719238211/context.json and
report.json. Two additional mercury-2.5 calls both return {"text":null}. An Opus
probe using the field helper's reasoning-disabled setting returned HTTP400 and
provides no fallback-quality evidence. Replay process14389 is terminal.

Next change should distinguish a valid unavailable field value from malformed
provider output, and return unavailable-value feedback to action planning with
bounded retries. It must not fabricate missing values, endlessly retry the same
field, or suppress a field after new evidence makes its value available. Validate
with a controlled real-browser recovery case, contrasting an actually required
missing value, plus actual fixture suites. No runtime change made in this section.
