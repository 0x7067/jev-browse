# Agent workflow

## Eval bar

Every behavioral change ships with eval evidence — a fixture run or a
"works on my machine" claim is not sufficient.

- `node scripts/eval.mjs` runs the real-task suite through `src/cli.ts`
  against live sites and the `file_url` fixture; verdicts are verifier-
  checked (`expect.*`), not DONE claims. See `evals/README.md`.
- Before merging a change to snapshot candidacy, action execution,
  freshness, prompts, or the decision loop: run the affected tier(s)
  (`--file tasks*.json`, `--tasks <ids>` for targeted checks) and report
  the verified/unverifiable/failed counts with the result file path.
  `evals/results/` is gitignored — results are run evidence, not
  committed artifacts.
- New capability → new eval task(s) in the appropriate tier with a
  runnable `expect` (url_match / text_match / action_match /
  answer_match / download_match). A task with no expectation reports
  `unverifiable` — it does not count as coverage.
- Regressions already in the suite are the floor: a merged change must
  not turn a previously verified task into a failure without an explicit
  documented reason (site flake is common on live tasks — rerun to
  confirm before blaming the diff).

## Checks

- `npm run typecheck` / `npm run lint` — must be clean.
- `npm run check:bundle` — rebuilds `bundled/` and fails on drift;
  `bundled/` is committed and is what installed copies execute. Always
  run after touching `src/`.
- `dist/` is gitignored build output; never commit it.

## Conventions

- `src/snapshot.js` is a plain JS file injected into the page by
  `src/snapshot-loader.ts` — not a TS module, no imports.
- Both engines (cdp, agent-browser) share the same snapshot and the
  `markerMatches` freshness contract in `src/json.ts` — a freshness or
  marker change must keep both engines coherent.
