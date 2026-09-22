# evals

Real-world task suite for jev-browse. `npm run eval` (or `node scripts/eval.mjs`)
runs each task in `tasks.json` through `bundled/cli.mjs` — the same entrypoint
installed users get via `jev-browse` — parses the `RunResult`, and verifies the
outcome — `DONE` is a claim, not proof, so tasks carry expectations where the
outcome is checkable:

- `expect.url_match` / `expect.url_not_match` — regexes on the final URL
- `expect.text_match` — regex on `RunResult.final_text` (terminal page text)
- `expect.state_match` — regex on `RunResult.final_state`, one line per
  element carrying `checked` / `selected` / `expanded` / `value` at the
  terminal page. Use it when the outcome is element state the page text
  cannot show — a checked box, an active tab, a chosen option.
- `expect.action_match` — regex on the run's executed ops, joined with spaces
- `expect.status` — an expected non-done outcome (e.g. `"blocked"`)

A task with no runnable expectation reports `unverifiable` — distinct from
`verified: yes/NO` — and is excluded from the verified count; the summary
line prints verified / unverifiable / failed separately.

```bash
npm run eval                                # all tasks in tasks.json, one run each
npm run eval:all                            # all four tier files (tasks*.json)
node scripts/eval.mjs --repeat 3            # median-of-N per task
node scripts/eval.mjs --tasks fx-range,tin-hovers
node scripts/eval.mjs --label baseline      # tags the results file
node scripts/eval.mjs --file tasks-hard.json
node scripts/eval.mjs --engine agent-browser  # cdp (default) or agent-browser
node scripts/eval.mjs --compare a.json b.json
```

Failed verifications exit non-zero — suitable as an evidence gate in CI or
before merging behavioral changes.

Results land in `evals/results/` with per-step latency breakdowns
(`latency_ms` per Jev call, `text_latency_ms` per helper call) and the stderr
step-event trail — which survives on errors, where the result's history is
empty. That directory is gitignored: results are local run evidence, not
repo artifacts. Compare runs with `--compare a.json b.json` using files
from your own eval output.

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
| clicks land but nothing happens (saucedemo) | canceled provisional navigation leaves the renderer input pipeline dead — all `Input.dispatch*` no-op in the same document | `domClick` fallback: one in-page event-synthesis retry when an executed click/hover produces zero change |
| six identical "Add to cart" buttons (saucedemo) | list controls share labels | duplicates are disambiguated with item-scope headings: `Add to cart — Sauce Labs Backpack` |
| nested-frames invisible | `<frame>` elements aren't `iframe`s; frameset docs have no `<body>` text | `iframe,frame` recursion for actions AND visible text |
| detail↔list wandering (saucedemo) | alternation isn't always period-2 — polluted SPA history breaks fingerprint cycles | revisit fuse: same fingerprint seen 4× in 14 distinct observations → blocked |
| model clicks "Focus X" instead of Enter (todomvc) | editable companion click labeled "Open X" read like an item to open | renamed to "Focus {label}" |
| model can't identify "the green button" (challenging_dom) | control color lives in CSS classes, invisible to labels | `cls` exposed in choice criteria (`button success` ≈ green) |
| container hovers swallow the target (jquery-menu) | menu root and its items both offered `Hover` | container hover offers dropped when an offered descendant exists |
| premature BLOCKED on below-fold content (hn-paginate, jquery-menu) | goals name elements not yet visible | `NEXT_ACTION` teaches: hidden content sits behind HOVER/scroll — try revealing before BLOCKED |
| extra decision per autocomplete pick | type→suggestion chains are predictable | `follow_up` question head: CLICK_MATCH_TYPED / PRESS_ENTER / DONE_AFTER resolved on the post-action state |
| stale Chrome holds the profile (open fails) | crashed runs leave a live instance; SingletonLock defers new launches to it | `reapProfileChrome` kills profile-bound strays and retries the launch once |
| model repeats itself until budget (hn-paginate, others) | a fuse ended the run without telling the model it was stuck | repair consult: one extra decide with an explicit "try a different approach" hint; each recovered episode re-arms it |
| 24–36s stalls observed once (flights) | SDK retry policy (10s × 3 attempts) on a flaky endpoint | bounded by design — no fix needed |
| parabank-transfer blocked at login; earlier cross-run weirdness | the shared profile persists cookies/SPA sessions — a logged-in page has no login form; carts and todos leak between runs | fresh `mkdtemp` profile per eval run (`JEV_PROFILE`) |
| saucedemo checkout forms fail on empty fields | `TYPE_TEXT` relies on `Input.insertText` — dead on the same canceled-nav pipeline that kills clicks | dom-fill fallback: prototype-setter value + input/change events |
| todomvc burns 120 model calls, zero progress | opacity:0 todo checkbox: indexed via hit-test rescue but `act()`'s checkVisibility bail staled every attempt | `act()` drops the visibility gate — the covered check (`elementFromPoint`) is the real arbiter; sibling-label naming gives it a real label |
| flights loops to 60-step budget on done claims | Google Flights holds perpetual connections — `pending_requests>0` never cleared, so every DONE wait hit the deadline→StalePage loop | deadline falls through to fingerprint stability; requests widen the window instead of vetoing |
| premature done on multi-step goals (tin-key-press, tin-dynamic-controls) | model speculates DONE_AFTER after one action on a two-part goal | done claims on imperative goals with <2 executed actions earn one confirmation consult |
| tin-file-upload blocked | file inputs were textboxes with a Focus click (native chooser) | fill-only surface, role 'file', TYPE_TEXT → `DOM.setFileInputFiles` |
| parabank-transfer blocked (intermittent) | the site's transfer page 500s — final_text shows "internal error has occurred" | environmental flake; agent reaches the page and reports honestly |
| invisible elements were uniformly dropped | `checkVisibility` misses opacity:0 custom controls (iOS toggles, styled checkboxes, material switches) | hit-test rescue in `gather()` — element wins its own center point → indexed |
| conduit (realworld) unreachable | demo backends are dead — shell renders, no forms | environmental; dropped |
| opencart blocked post-nav | Cloudflare interstitial | environmental; dropped |
| tin-shifting-content unverifiable | its Gallery link is a designed 404 — blocked, done, and retreat are all defensible; it verifies nothing | dropped in 3dc4750 |

## Known limits (not bugs)

- `DONE` remains a claim — the model can declare success on a page that
  doesn't show it (measured on Enter-only palettes). The eval's URL
  expectations exist because of this.
- A genuinely stuck page and a slow client-side timer are the same
  observation; the 10s idle fuse is the compromise.
- Helper-model flakiness: an empty `fieldText` answer retries once; a
  double-empty still fails the run (seen once on algolia-search).
- sauce-checkout and todomvc-add verified in bench-v9 after the
  generalization pass; earlier runs reached the end state but missed
  final verification (validation-error loop / completion checkbox).
  Decision-quality limits, not machinery.
- JS-bound interactivity with no DOM or CSS signal (tablesorter headers)
  is fundamentally invisible; `blocked` is the honest answer.
- DRAG target selection is model-variable — the mechanism (real mouse drag
  + HTML5 synthesis fallback) works, but the model can pick wrong ends.
- No right-click *menu reading*: CONTEXT_CLICK fires the context event,
  but OS-native menus are outside the DOM and can't be observed.
