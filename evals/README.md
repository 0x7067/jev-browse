# evals

Real-world task suite for jev-browse. `node scripts/eval.mjs` runs each task
in `tasks.json` through `src/cli.ts`, parses the `RunResult`, and verifies the
outcome — `DONE` is a claim, not proof, so tasks carry URL expectations where
the destination is checkable (`expect.url_match` / `url_not_match`).

```bash
node scripts/eval.mjs                       # all tasks, one run each
node scripts/eval.mjs --repeat 3            # median-of-N per task
node scripts/eval.mjs --tasks fx-range,tin-hovers
node scripts/eval.mjs --label baseline      # tags the results file
node scripts/eval.mjs --compare a.json b.json
```

Results land in `evals/results/` with per-step latency breakdowns
(`latency_ms` per Jev call, `text_latency_ms` per helper call) and the stderr
step-event trail — which survives on errors, where the result's history is
empty.

Task classes covered: navigation, search+autocomplete, multi-field forms,
native select, iframes, shadow roots, hover-reveal menus, file upload,
key presses, AJAX waits, disabled-until-input controls, modals, new tabs,
range sliders, and a full Google Flights flow. `fixture-interactions.html`
runs through `file_url` tasks for deterministic coverage.

## Diagnosed issues and their fixes

| Symptom (task) | Root cause | Fix |
| --- | --- | --- |
| `Document is navigating` startup errors (example, ddg) | 200ms observe retry budget vs. real redirect chains | 4s settle budget in `observe()` |
| `max_tokens_exceeded` (wikipedia) | `name()` swallowed inline `<script>` text → 30k-char labels | skip `SCRIPT/STYLE/NOSCRIPT/TEMPLATE` in names + 240-char label cap + progressive state shrink in `choose()` |
| `Invalid TypeSafe response` | malformed model answer was fatal | one retry in `choose()` |
| `Text helper returned no valid field value` | empty helper answer was fatal | one retry before typing |
| A→B→A→B ping-pong loops (fixture, iana) | every step "changed", so no-change rules never fired | fingerprint cycle detection (period-2/3 → blocked) |
| Wait loops to ~92s (ddg) | waits didn't count toward stalemate | idle no-change streaks fuse at 10s — reset while `pending_requests > 0` |
| `BLOCKED` during legit AJAX (tin-dynamic-*) | give-up probe only fired on all-wait histories | any `BLOCKED` claim gets up to 3 wait+re-observe probes |
| `DONE` verified on pre-navigation URL (github) | done check landed before the nav it triggered | `DONE` must survive a 400ms stability window |
| `tin-dynamic-loading` blocked | a JS `setTimeout` is indistinguishable from a stuck page | time-based fuse (10s) — network tracking via CDP Network domain feeds `PageState.pending_requests` |
| `tin-hovers` blocked | CSS `:hover` reveals are invisible to DOM inspection | hidden interactive elements offer their visible ancestor as a `HOVER` target (`hoverZones`) |
| `fx-range` blocked | `PRESS_*` goes to the focused element; model pressed arrows into nothing | `NEXT_ACTION` teaches focus: CLICK the slider first, then arrows |
| DDG search blocked | `50x-tq.html` bot-detection interstitial — environmental | task class moved to `hn.algolia.com` |
| example-link / github wandering | unbounded goals invite link-following | goals name an explicit end state |

## Known limits (not bugs)

- `DONE` remains a claim — the model can declare success on a page that
  doesn't show it (measured on Enter-only palettes). The eval's URL
  expectations exist because of this.
- A genuinely stuck page and a slow client-side timer are the same
  observation; the 10s idle fuse is the compromise.
- Helper-model flakiness: an empty `fieldText` answer retries once; a
  double-empty still fails the run (seen once on algolia-search).
