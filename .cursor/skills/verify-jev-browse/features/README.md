# jev-browse verification map

This directory is the maintained source for verifying the user-facing behavior
of jev-browse. Read the index before driving the app, then use the matching
feature file as the recipe.

## Baseline preconditions

- Run from the repository root with `PATH` including
  `.cursor/skills/verify-jev-browse/bin`.
- `control-jev-browse launch` created this run's disposable
  `VERIFY_HOME=/tmp/jev-browse-verify-$RUN_ID` (profile at
  `$VERIFY_HOME/profile`).
- `control-jev-browse doctor` printed `doctor=ok` and wrote
  `$EVIDENCE_DIR/doctor.txt`.
- Run `eval "$(control-jev-browse env)"` before any recipe line that expands
  `$EVIDENCE_DIR`, `$RUN_ID`, `$JEV_PROFILE`, or `$JEV_BROWSE_ROOT`.
  Re-run it after `cleanup` or a new `launch`. Commands refuse shell values
  that disagree with the active-run state file.
- Never drive a verify home that was not started by this verification run.
- Do not `source` the control state file into your shell.
- Prefer engine `cdp` (default) and headless. Use `--engine agent-browser` only
  when that engine is under test.
- Put evidence under `.cursor/skills/verify-jev-browse/artifacts/$RUN_ID/` via
  `control-jev-browse save`.

## In-band vs out-of-band

**In-band** (no TypeSafe / text-model keys): doctor checks, `file://` refusal
without `--allow-file-urls`, missing-key error shape when keys are unset.

**Out-of-band** (needs `TYPESAFE_API_KEY`; TYPE_TEXT also needs
`TEXT_MODEL_API_KEY` + `TEXT_MODEL_BASE_URL` + `TEXT_MODEL`): fixture `fx-*`
eval tasks, live-site tasks, MCP `jev_browse`. Live sites flake — prefer
fixtures for prove-once. Never count an in-band gate pass as verifying an
out-of-band fixture or live task.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Treat every command as literal. Keep quoted goals and flags unchanged.
- Drive the eval harness through `control-jev-browse eval -- ...`.
- Drive the CLI through `control-jev-browse cli -- ...`.
- Verdicts come from `expect.*` (eval) or explicit error strings (gates) — not
  from the agent's own `DONE`.
- Never remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action (CLI argv or eval task id) and the resulting stdout,
  stderr, and exit code — not only a final success line.
- Eval proof includes the summary `verified` / `unverifiable` / `failed` counts
  and a copy of (or excerpt from) the results JSON under the evidence dir.
- CLI proof includes the command, stdout `RunResult`, stderr step events when
  present, and exit code.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable or out-of-band path with the attempted command and the
  unmet precondition (usually missing `TYPESAFE_API_KEY`).
- Do not report a skipped fixture/live entry as verified through the file-URL gate.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the
user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-jev-browse` starts with `Preconditions:` and uses
   labeled bullets that pair each user action with an exact command and
   observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable
handles, required state, commands, and observable proof.

## Features

- [File URL gate](./file-url-gate.md) covers refusing `file://` without opt-in.
- [Fixture modal](./fixture-modal.md) covers the deterministic modal confirm path.
- [Fixture hover menu](./fixture-hover-menu.md) covers CSS hover-reveal menus.
- [Fixture type and redeem](./fixture-type-redeem.md) covers TYPE_TEXT + enable.
- [CLI missing key](./cli-missing-key.md) covers the unset-`TYPESAFE_API_KEY` error.
- [Model-free drive paths](./model-free-drive.md) covers verifying snapshot/act behavior when the model is unreachable.
