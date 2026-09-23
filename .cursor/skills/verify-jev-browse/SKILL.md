---
name: verify-jev-browse
description: >
  Drive and prove jev-browse (CLI browser agent + eval harness) the way a user
  would: isolated Chrome profile, bundled CLI, and scripts/eval.mjs fixture /
  live tasks. Use for /verify-jev-browse, verifying file:// gating, fixture
  interactions, TYPE_TEXT flows, Jev provider selection (TypeSafe or
  OpenRouter), or eval expect.* verdicts after changing src/, bundled/, or
  evals/.
---

# Verify jev-browse

jev-browse is a short-lived CLI (and MCP tool) that drives a real Chrome tab
toward one natural-language goal. Users run `jev-browse` / `node bundled/cli.mjs`
or the eval harness `node scripts/eval.mjs`. There is no long-lived app server.
This skill isolates each verification run under a disposable profile so it never
shares `~/.jev-browse/profile` with a live session.

Maintain the feature map under `features/` as the app changes when the CLI,
snapshot, or eval tasks drift.

## What this skill proves here

**In-band (proved by this skill's own launch → doctor → drive → cleanup loop
without live model calls):**

- Node ≥ 22, Chrome present, `bundled/cli.mjs`, `scripts/eval.mjs`, and
  `fixture-interactions.html` present
- Disposable verify home + profile created by `control-jev-browse launch`
- `file://` start URLs are refused unless `--allow-file-urls` /
  `JEV_ALLOW_FILE_URLS=1` (CLI exits `1` with the http(s)-only error)

**Out-of-band (needs a Jev provider key: `TYPESAFE_API_KEY`, or
`OPENROUTER_API_KEY` with `JEV_PROVIDER=openrouter` or no TypeSafe key;
TYPE_TEXT also needs `TEXT_MODEL_*`):**

- Fixture `file_url` tasks in `evals/tasks.json` (`fx-*`) that call Jev and
  verify via `expect.*`
- Live-site eval tasks (flaky; prefer fixtures for prove-once)
- MCP `jev_browse` over stdio

Do not report an out-of-band fixture/live pass as verified because the in-band
file-URL gate passed. Feature files mark key-required entries clearly.

## Launch

There is no long-lived server. Launch means: create a disposable verify home
with a fresh Chrome profile, and record a run id. Ready when
`control-jev-browse doctor` exits 0.

```bash
export PATH="$PWD/.cursor/skills/verify-jev-browse/bin:$PATH"
# Load keys from the environment or repo .env before out-of-band drives
control-jev-browse launch
# prints run_id=... home=/tmp/jev-browse-verify-... evidence_dir=... ready=1
# force a specific id with JEV_BROWSE_VERIFY_RUN_ID=... (must match [A-Za-z0-9._-]+,
# no `..`). A second launch without --reuse refuses while an active run exists.
# It does not remove the previous home. Run cleanup, or pass launch --reuse.
eval "$(control-jev-browse env)"
```

`launch` without `--reuse` refuses when the active-run state file already
exists. It does not auto-clean and does not mint a new `RUN_ID` over that
file. Run `control-jev-browse cleanup`, or `control-jev-browse launch --reuse`,
before starting another home.

Teardown is `control-jev-browse cleanup` (see Cleanup). Never drive an instance
whose verify home was not created by `control-jev-browse launch` for this run.

Isolation: each run uses `VERIFY_HOME=/tmp/jev-browse-verify-$RUN_ID` with
`JEV_PROFILE` / `JEV_AB_PROFILE` under `$VERIFY_HOME/profile`. Active-run state
lives under `$XDG_RUNTIME_DIR/jev-browse-verify-control` when set, otherwise
`/tmp/jev-browse-verify-control-<uid>` (mode 0700). The state file is a
validated `RUN_ID=` line only (never `source`d). Prefer
`eval "$(control-jev-browse env)"`. `env` reads that state file. Shell values
of `RUN_ID`, `VERIFY_HOME`, and `EVIDENCE_DIR` are accepted only when they
match it. After `cleanup` or a new `launch`, eval `env` again before
`doctor`, `cli`, or `cleanup`. Those commands refuse a stale export instead
of acting on the previous home. When no run is active, `env` unsets those
variables. Do not point two drives at the same verify home or the shared
default `~/.jev-browse/profile`.

Safest local defaults when a choice is needed: engine `cdp` (default), headless
(no `--headed`), and a deterministic `file_url` fixture task for behavioral
proofs.

## Doctor

Read-only check that the active run is worth driving:

```bash
control-jev-browse doctor
```

Requires: Node ≥ 22; a Chrome binary on `PATH`; `bundled/cli.mjs`,
`scripts/eval.mjs`, and `fixture-interactions.html` present; disposable verify
home + profile exist; a no-allow `file://` CLI call exits `1` with the
http(s)-only error. Writes `$EVIDENCE_DIR/doctor.txt`. Fail the run if
`doctor=fail`.

Provider keys and `TEXT_MODEL_API_KEY` may be unset. Doctor reports
`jev_provider`, `typesafe_api_key`, `openrouter_api_key`, and
`text_model_api_key` from the shell environment and still passes — in-band
gates do not need keys. Fixture and live drives that call Jev are out-of-band;
see feature files.

Doctor does not create, replace, or clean the active run. If `launch` refused
because an active run exists, run `cleanup` or `launch --reuse` before doctor
on a new home.

## Drive

Harness: `control-jev-browse` (shell). Prefer it over raw `node` so the verify
profile and evidence paths stay consistent.

Before any recipe that expands `$EVIDENCE_DIR`, `$RUN_ID`, `$JEV_PROFILE`, or
`$JEV_BROWSE_ROOT`, load the exportable assignments:

```bash
eval "$(control-jev-browse env)"
```

```bash
# In-band file:// gate (no API key)
control-jev-browse cli -- \
  --url "file://$JEV_BROWSE_ROOT/fixture-interactions.html" \
  --goal "stop"
# expect exit 1 and stdout JSON error containing "only drives http(s) pages"

# Out-of-band fixture drive via the eval harness (needs a provider key)
control-jev-browse eval -- --tasks fx-modal --label verify
# expect verified:1 failed:0; results under evals/results/ (gitignored)

# Same fixture via CLI (needs key + --allow-file-urls)
control-jev-browse cli -- \
  --allow-file-urls \
  --url "file://$JEV_BROWSE_ROOT/fixture-interactions.html" \
  --goal 'Open the modal dialog and confirm deleting the draft. Stop when DONE is shown.'
```

Stable handles: task ids in `evals/tasks.json`, CLI flags (`--url`, `--goal`,
`--allow-file-urls`, `--engine`), and `expect.*` fields documented in
`evals/README.md`. Prefer those over scraping page CSS.

Feature recipes live in `features/`. Start from the baseline in
`features/README.md`, then follow one feature file end to end.

## Evidence

Proof root for a run (named location; survives cleanup):

`.cursor/skills/verify-jev-browse/artifacts/<RUN_ID>/`

Override with `JEV_BROWSE_VERIFY_EVIDENCE` if needed. Capture:

- Command, stdout, stderr, and exit code for every drive step.
- For CLI: the argv and the stdout `RunResult` JSON (status, error, final_url,
  final_text when present).
- For eval: the harness summary line (`verified` / `unverifiable` / `failed`)
  plus a copy of the written `evals/results/*.json` (or a trimmed excerpt) under
  the evidence dir — do not rely on `evals/results/` alone; it is gitignored.
- Record the feature ID and entry point with every artifact.

```bash
control-jev-browse evidence doctor.txt
control-jev-browse save file-url-gate/denied.json -
```

Standards: exercise the real bundled CLI / eval entry users run — not internal
agent setters. Capture the action and the resulting state. `DONE` is a claim;
eval `expect.*` (or an explicit error string for in-band gates) is the proof.
Mocks only at the production boundary already used by the product (missing
provider key → error result; unknown `JEV_PROVIDER` → error result; missing `--allow-file-urls` → http(s)-only
refusal).

## Cleanup

```bash
control-jev-browse cleanup
```

Removes only `/tmp/jev-browse-verify-$RUN_ID` for the active run and clears the
control state file. Does **not** delete
`.cursor/skills/verify-jev-browse/artifacts/<RUN_ID>/`. `launch` without
`--reuse` refuses while that state file exists; cleanup is what allows a new
run id. Launch never deletes the previous home by itself. After cleanup, confirm
evidence still exists:

```bash
test -d .cursor/skills/verify-jev-browse/artifacts/<RUN_ID>
ls .cursor/skills/verify-jev-browse/artifacts/<RUN_ID>
```

Never `pkill` Chrome by name. Never remove another run's home. Eval's own
`mkdtemp` profiles under the system temp dir are process-local scratch; the
verify home profile is what this skill owns.

## Helpers

Executable: `.cursor/skills/verify-jev-browse/bin/control-jev-browse`

```bash
control-jev-browse launch|doctor|env|cleanup|status
control-jev-browse eval -- <scripts/eval.mjs args...>
control-jev-browse cli -- <bundled/cli.mjs args...>
control-jev-browse evidence <relpath>
control-jev-browse save <relpath> -
control-jev-browse help
```

Put `bin/` on `PATH` for the session, or invoke it by absolute path from the
repo root.

## Feature map

See [features/README.md](features/README.md). Drive one mapped feature per
proof unless the task asks for coverage.
