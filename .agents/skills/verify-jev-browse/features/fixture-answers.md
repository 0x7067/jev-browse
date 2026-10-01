# Fixture answers

When the goal asks a question instead of demanding an action, jev-browse
answers from observed page content and returns the text in
`RunResult.answer` (plus `answer_note` when it cannot support an answer).
The eval harness verifies answers with `expect.answer_match`, a regex on
`RunResult.answer` — independent of the agent's `DONE` claim.

## Sub-features

- `fx-answer-summary` answers a multi-fact question over one fixture page.
- `fx-answer-comparison` answers a comparison ("are they the same?").
- `fx-table-answer` extracts one cell (`expect.answer_match` `^Quinn$`).
- `fx-control-label-answer` answers from control-label evidence
  (`37\.49`).
- `fx-evidence-role` / `fx-evidence-options` pair the answer with visible
  page evidence via combined `answer_match` + `text_match`.
- `fx-reload-recovery` / `fx-answer-recovery` prove the answer survives a
  mid-run reload/navigation to the evidence page.
- `fx-clearing-challenge` answers after an interstitial clears.

## How to get to it (user POV)

- Run `jev-browse --url <page> --goal "What ...?"`; read `answer` in the
  RunResult JSON.
- Run the eval task ids, e.g. `fx-answer-summary` from `evals/tasks.json`.

## Driving it with control-jev-browse

Preconditions:

- `control-jev-browse doctor` reports `doctor=ok` for this run.
- A Jev provider key (`TYPESAFE_API_KEY` or `OPENROUTER_API_KEY`) and
  `TEXT_MODEL_API_KEY` are set (out-of-band) — answer extraction and review
  both run through the text helper, which throws `Text helper is not
  configured.` without the key. `TEXT_MODEL_BASE_URL` and `TEXT_MODEL`
  fall back to the DeepSeek endpoint and `deepseek-chat` when unset.
- `eval "$(control-jev-browse env)"`.

- **Eval path.** Run
  `control-jev-browse eval -- --tasks fx-answer-summary,fx-answer-comparison,fx-table-answer,fx-control-label-answer --trace --label verify-answers`.
  Require `verified:4` / `unverifiable:0` / `failed:0`. Copy the written
  `evals/results/verify-answers-*.json` into evidence as
  `fixture-answers/eval-result.json`; each detail's `answer` field must
  satisfy its `answer_match` regex.
- **CLI path.** Run
  `control-jev-browse cli -- --allow-file-urls --url "file://$JEV_BROWSE_ROOT/evals/fixtures/table-evidence.html" --goal 'Sort Current staff by given name ascending, then report only the family name of its first data row.'`.
  Exit `0`; stdout `status` is `done` and `answer` is `Quinn`.

## Gotchas

- `answer_match` checks `RunResult.answer`, not `final_text` — a task
  can end `done` with correct page text but fail the answer clause.
- A question the page cannot support ends with `answer_note` explaining
  why; that is honest output, not a pass — only `answer_match` verifies.
- With `TEXT_MODEL_API_KEY` unset the run ends `blocked` with
  `blocked_cause` `answer_unverified` and `answer_note`
  `Text helper is not configured.` — evals fail on `status` before
  `answer_match` is checked.
- Without a provider key this feature is unreachable; do not substitute
  the file-URL gate.
