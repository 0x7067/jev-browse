# Agent workflow

## Checks

Run these before you call a change to `src/` done. All must be clean.

- `npm run typecheck`
- `npm run lint` — oxlint plus `check:comments` (code comments are banned)
- `npm run check:bundle` — rebuilds `bundled/` and fails if the committed
  bundles drifted. `bundled/` is committed and is what installed copies
  execute, so commit the rebuilt bundles with the source change.

Never commit `dist/`; it is gitignored build output.

## Code comments banned

Implementation source (`.ts` / `.js` / `.mjs` / `.cjs` and siblings under the
repo, including `src/`, `scripts/`, `integrations/`, and `tools/`) must not
contain line, block, or JSDoc comments. Shebang lines and `LICENSE` files are
allowed. Markdown docs and skill `SKILL.md` prose are not code comments — leave
them alone. String literals that look like comments are fine.

Enforcement:

- oxlint rule `anti-slop/no-comments` (via `npm run lint`)
- `npm run check:comments` — TypeScript-scanner gate over implementation files
  (covers paths oxlint ignores, such as `tools/oxlint/**`)

Do not reintroduce `SAFETY:` or other justification comments for type
assertions; prefer clearer types or decoding helpers instead.

## Eval evidence

A behavioral change needs a suite run. A fixture check or a local
"it worked for me" does not establish the change works.

`node scripts/eval.mjs` drives real tasks through `src/cli.ts` against live
sites plus the `file_url` fixture. Verdicts come from the `expect.*`
verifiers, not from the agent's own `DONE`. Read [evals/README.md](evals/README.md)
for the flags, the expectation types, and the result format.

- Changing snapshot candidacy, action execution, freshness, prompts, or the
  decision loop: run the affected tiers (`--file tasks*.json`, or `--tasks
  <ids>` for a targeted check) and report verified / unverifiable / failed
  counts with the path of the result file. `evals/results/` is gitignored —
  results are run evidence, not committed artifacts.
- New capability: add task(s) to the right tier with a runnable `expect`.
  A task with no expectation reports `unverifiable` and is not coverage.
- A previously verified task must not start failing. Live sites flake, so
  rerun a new failure before blaming the diff; if it holds, either fix it or
  say in the change why the regression is acceptable.

## Conventions

- `src/snapshot.js` is plain JS injected into the page by
  `src/snapshot-loader.ts`. It is not a TS module and takes no imports.
- The `cdp` and `agent-browser` engines share one snapshot and the
  `markerMatches` freshness contract in `src/json.ts`. Any freshness or
  marker change must keep both engines coherent.

## Verify

For a scripted launch → doctor → drive → evidence → cleanup loop (isolated
Chrome profile, feature map under
`.cursor/skills/verify-jev-browse/features/`), use the project-local Cursor
skill:

```bash
export PATH="$PWD/.cursor/skills/verify-jev-browse/bin:$PATH"
control-jev-browse launch
control-jev-browse doctor
eval "$(control-jev-browse env)"
# then follow one feature file under features/
control-jev-browse cleanup
```

See `.cursor/skills/verify-jev-browse/SKILL.md`. Prefer deterministic
`file_url` fixture tasks for behavioral proofs; live-site evals flake.
`evals/results/` stays gitignored — copy proof into the skill
`artifacts/<RUN_ID>/` tree.
