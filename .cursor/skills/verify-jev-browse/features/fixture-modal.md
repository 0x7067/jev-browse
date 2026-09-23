# Fixture modal

On the local `fixture-interactions.html` page, the user opens a modal with
"Delete draft" and confirms. The page shows `DONE: draft deleted`. The eval
task `fx-modal` drives this through `bundled/cli.mjs` with `file_url` opt-in
and checks `expect.text_match`.

## Sub-features

- `fx-modal-eval` runs `scripts/eval.mjs --tasks fx-modal` and verifies the text.
- `fx-modal-cli` (same goal) runs the CLI directly with `--allow-file-urls`.

## How to get to it (user POV)

- Open `fixture-interactions.html`, click **Delete draft**, then **Confirm delete**.
- Ask jev-browse to do that goal from the fixture file URL (tests/fixtures only).
- Run the eval task id `fx-modal` from `evals/tasks.json`.

## Driving it with control-jev-browse

Preconditions:

- `control-jev-browse doctor` reports `doctor=ok` for this run.
- A Jev provider key (`TYPESAFE_API_KEY` or `OPENROUTER_API_KEY`) is set (out-of-band). TEXT_MODEL keys are not required.
- `eval "$(control-jev-browse env)"`.

- **Eval path.** Run
  `control-jev-browse eval -- --tasks fx-modal --label verify-modal`.
  Require `verified:1` / `failed:0` (per-run detail shows `verified: true`).
  Copy the
  written `evals/results/verify-modal-*.json` into evidence as
  `fixture-modal/eval-result.json` (or save a trimmed excerpt with status,
  verified, final_text).
- **CLI path.** Run
  `control-jev-browse cli -- --allow-file-urls --url "file://$JEV_BROWSE_ROOT/fixture-interactions.html" --goal 'Open the modal dialog and confirm deleting the draft. Stop when DONE is shown.'`.
  Exit `0`. Stdout `status` is `done` and `final_text` matches
  `DONE: draft deleted`. Save stdout as `fixture-modal/cli-result.json`.
- **Proof.** Prefer the eval path: `expect.text_match` is the verifier, not
  the agent's `DONE` alone.

## Gotchas

- Without a provider key this feature is unreachable — report
  the unset keys from `doctor` and stop; do not count the file-URL gate as proof.
- `evals/results/` is gitignored; always copy proof into `$EVIDENCE_DIR`.
- Do not use `--headed` unless debugging a failure.
