# WebVoyager pilot

Run `JEV_PROVIDER=openrouter node scripts/webvoyager.mjs --out evals/results/webvoyager-RUN`.
Use a new output directory for each run. `--tasks ID,ID` selects a subset;
`--max-steps` defaults to 30 and `--timeout-ms` to 180000 per task.
The runner uses the committed bundled CLI and loads local `.env` credentials.

The pinned pilot contains two tasks per website, selected by sorting the SHA256
of `jev-webvoyager-pilot-v1:` plus the task ID. The source revision and full
dataset checksum are recorded in pilot.json. Original dataset: Apache-2.0,
https://github.com/MinorJerry/WebVoyager.

Dates are frozen as of September 29, 2026. Past travel dates become October 29
through November 2, 2026; yearless December dates become December 2026.
Original instructions are retained alongside edited instructions. Booking--38
originally specified four nights with inconsistent dates; the replacement
preserves four nights. Relative words such as yesterday retain their meaning
at execution time. Google Search--15 is excluded because it requests credential
use. Thus there are 30 selected tasks and at most 29 attempted tasks.

Each task gets a fresh Chrome profile, trace, raw CLI output, screenshot series,
and judge response. The separate custom vision judge uses trajectory
evidence and the returned answer (see protocols below). OPENROUTER_API_KEY is required for judging;
WEBVOYAGER_JUDGE_MODEL defaults to openai/gpt-5.4. No benchmark reference answers
are given to the agent. This is not the upstream evaluator or an official
WebVoyager score. Review judge verdicts before publication. Screenshot sampling is every two seconds across all page tabs.
Traces provide additional diagnostic evidence.

Execution errors and timeouts are failed attempts with distinct categories.
Authentication/credit errors stop the run. Reports retain the full selected
manifest and explicit selected/attempted/unattempted/excluded counts.
No retries are performed. Raw per-action usage is retained, but total cost is
null because complete usage and pricing are not available. `--judge-only --out
DIR` re-evaluates saved runs into a new judgments/TIMESTAMP directory; use the
same task selection as the source run.

Results stay in gitignored evals/results/. Do not publish raw traces without
review. TypeSafe preflight returned HTTP 402 (no available credits). The pilot uses
OpenRouter with jev-latest and inception/mercury-2.5 as its text helper.

## Protocol v2

Protocol `webvoyager-pilot-custom-judge-v2` introduced trajectory evidence. Unlike the original
pilot protocol, it supplies up to 20 evenly spaced distinct DOM observations
and 12 evenly spaced screenshots across the trajectory, including endpoints.
DOM text is capped at 6000 characters per observation; coverage and truncation
are disclosed in judge-evidence.json. Sampling is a limitation, not proof that
an omitted outcome did not occur. Captures record every page tab (including populated about:blank tabs) and
its target ID. The terminal browser tab can close before its screenshot is
captured, so terminal DOM observations remain important evidence.

Timeouts and execution errors count as failed attempts with explicit categories.
Site access blocks count as failed tasks, with category site_block. Judge errors
and insufficient captured evidence are unverifiable. Excluded tasks are separate;
selected, attempted, unattempted, and excluded counts preserve the denominator.
These semantics supersede the earlier pilot's unverifiable classification.

Rejudging writes to DIR/judgments/TIMESTAMP, keeps source-run provenance and uses
saved task instructions. It does not overwrite original verdicts or agent output.
The full original report is retained as source_run. New runs record the CLI
bundle SHA256 and refuse to start another task if the bundle changed.
Protocol v1 and v2 scores must not be compared without rejudging common evidence.

## Interrupt and resume

SIGINT/SIGTERM stops the active CLI, waits for owned Chrome cleanup, preserves
available task evidence, and writes an interrupted report. JSON reports are
written atomically. Each invocation holds an exclusive runner.lock; normal exit
releases it. An abrupt process kill may leave that lock. Verify its recorded PID
is no longer running before removing a stale lock; never remove a live run's lock.

`--resume --out DIR` continues tasks absent from the recorded result list. Supply
the original task selection and limits. Resume verifies the original bundle and
snapshot hashes, dataset, model configuration, and judge settings. Recorded
attempts, including interrupted attempts and failures, are not retried. Saved
run.json without a verdict can be judged without another browser run. A trace
without a final result is preserved as an interrupted attempt, not overwritten.
Use a new output directory for intentional reruns. Older reports without process
identity and snapshot hashes cannot resume.

Each newly judged task also has usage.json with actual model IDs and reported
usage from decision, completion, answer-review, and text-helper response traces,
plus judge usage. Response IDs are deduplicated. Reported cost is a lower-bound
accounting record; charges for failed/unreported requests are unknown. No price
is guessed, and total cost remains unavailable.

`--manifest evals/webvoyager/heldout.json` selects the frozen 15-task held-out
sample. It uses the next hash-ranked task per website, disjoint from the pilot.
Keep it out of tuning runs. Its yearless January travel dates are fixed to 2027;
explicit historical research/sports dates remain unchanged.

## Protocol v3

Protocol `webvoyager-pilot-custom-judge-v3` additionally tells
the judge to assess explicit task constraints without inventing narrower
requirements, and supplies the original execution timestamp for relative dates.
New task runs record started_at; older runs fall back to their report start time.
Rejudging uses the source run date, never the rejudging date.

These changes do not establish judge accuracy. A saved Booking--35 judgment
remained disputed after the scope clarification: the judge required a travel
destination where the task asked for a place. Raw verdicts remain unchanged;
adjudication is required before presenting an audited score. Scores from
different protocols must not be compared without consistent rejudging.

## Protocol v4

Protocol `webvoyager-pilot-custom-judge-v4` It includes observed
control labels and values, checked/selected state, frame facts, and downloads
alongside viewport text. A maximum of 100 controls per observation is disclosed
with controls_truncated. Observation deduplication includes control state.
The judge must distinguish observing a link from visiting its destination.

This repairs an evidence gap: offscreen labels are available to the agent but
were absent from previous judge inputs. Preserve previous verdicts and rejudge
consistently before comparing scores. See REMEDIATION.md for audit evidence.

## Protocol v6: explicit required outcomes

Protocol `webvoyager-pilot-custom-judge-v6` introduced explicit required outcomes. Each manifest task
requires a nonempty requirements array with unique id, description, and delivery
(`answer` or `browser`). Requirements restate the task, contain no reference
answers, and are never supplied to the browser agent. Pilot requirements were
authored after the diagnostic runs; held-out requirements were authored before
any held-out execution. Task selection and instructions are unchanged.

The evaluator separately checks delivery of each requested answer and evidence
support for each required outcome. Code aggregates those checks: missing answers,
contradictions, or site blocks fail; insufficient evidence is unverifiable; all
required outcomes must pass to be verified. Empty returned answers cannot pass
answer requirements even if the judge says they do. Missing, duplicate, or unknown
check IDs invalidate the response. Browser-only tasks need no written answer.

Reports archive the exact judge prompt and hash, scoring requirements, and raw
checks. Rejudging uses the selected manifest rubric only when its task wording
exactly matches the saved instruction, preserving original outputs and verdicts.
Resume additionally checks the judge prompt hash. V5 was a calibration-only
intermediate version that conflated missing delivery with unsupported evidence.

`node scripts/check-webvoyager-judge.mjs` exercises controlled, unrelated cases
through OpenRouter and tests aggregation at the response boundary. Calibration
is finite evidence, not proof of perfect grading. Review disputed outcomes;
do not compare scores produced with different prompts, rubrics, or evidence.

## Protocol v7: constrained response and judge selection

The current runner uses `webvoyager-pilot-custom-judge-v7` with
`openai/gpt-5.4` through OpenRouter by default. It requires a judge supporting
JSON Schema structured output. `WEBVOYAGER_JUDGE_MODEL` remains configurable.
Response fields and enums are constrained at generation and checked again at
the parser boundary. Each run records the actual requested model and prompt.

The previous GPT-4o judge passed the small calibration but produced malformed
checks and accepted an unsupported maximum claim on full evidence. GPT-5.4
passed the same calibration and classified that claim as unverifiable while
accepting a correctly supported three-place summary. This is evidence for the
selection, not a guarantee that every future judgment is correct. Original and
candidate-model outputs are preserved. Never combine model-specific counts.

Current browser builds use a separate answer-review model (default Claude Opus 5.5
when the text endpoint is OpenRouter), recorded as `ANSWER_REVIEW_MODEL`.
The external evaluator uses GPT-5.4. These are separate models; agreement still
does not establish correctness. Earlier builds used GPT-5.4 for both calls. Source-run configuration and bundle hashes must
be retained when comparing older builds that used Jev for answer review.

## Evidence review reports

After a run finishes, use `node scripts/audit-webvoyager.mjs --run DIR --out FILE`
to report automated and adjudicated counts separately. Each reviewed task has
an `adjudication.json` alongside `run.json`, with `verdict`, `category`, `reason`,
`source`, `original_verdict_preserved: true`, and the exact `run_sha256`.
The command refuses active runs, mismatched evidence hashes, and existing output
files. It retains each original judgment, lists unreviewed passes, and preserves
excluded and unattempted counts. Reviews are local evidence assessments, not a
second independent evaluator. `node scripts/check-webvoyager-audit.mjs` verifies
these accounting and provenance rules through the CLI.
