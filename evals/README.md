# evals

Real-world task suite for jev-browse. `node scripts/eval.mjs` runs each task
in `tasks.json` through `src/cli.ts`, parses the `RunResult`, and verifies the
outcome — `DONE` is a claim, not proof, so tasks carry expectations where the
outcome is checkable:

- `expect.url_match` / `expect.url_not_match` — regexes on the final URL
- `expect.text_match` — regex on `RunResult.final_text` (terminal page text)
- `expect.action_match` — regex on the run's executed ops, joined with spaces
- `expect.status` — an expected non-done outcome (e.g. `"blocked"`)

A task with no runnable expectation reports `unverifiable` — distinct from
`verified: yes/NO` — and is excluded from the verified count; the summary
line prints verified / unverifiable / failed separately.

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

## Machinery stress suite (no API keys)

`node scripts/stress.mjs` runs `stress.json` through the real CLI against a
local site (`scripts/stress/site.mjs`) and a scripted stand-in for both model
endpoints (`scripts/stress/mock-model.mjs`). The decision path in `src/` is
untouched; only `TYPESAFE_BASE_URL` and `TEXT_MODEL_BASE_URL` point at the
mock. Every task carries a step script the mock resolves statelessly against
the observed state, so what the suite measures is the browser driver, the
snapshot extractor, the freshness guards, the fuses, and the loop — not the
model. `--latency 800` adds a simulated model round-trip so stale windows
open the way they do in production.

```bash
npm run stress                                # 43 tasks, one run each
node scripts/stress.mjs --latency 800         # with simulated model latency
node scripts/stress.mjs --repeat 3 --parallel 4
node scripts/stress.mjs --tasks big-dom,rerender --label probe
node scripts/stress.mjs --cli bundled         # exercise the committed bundle
node scripts/stress/probe.mjs URL "label regex" "field regex:text" @scroll_down
```

Task classes: every `fixture-interactions.html` section, a 4000-control grid,
slow XHR, timer-only late render, hash-router SPA, three-deep same-origin
iframes, shadow-in-shadow forms, a 150 ms text ticker, a 300 ms virtual-DOM
re-render that recreates every node, a full-screen consent overlay (dismiss,
and click-through must report `blocked`), a nine-field server-side form,
infinite scroll, native `confirm`/`alert`, arrow-key listbox, a real-URL
new tab, CJK/RTL labels, a 4000-clause page, a button that enables after a
server check, a 302 chain, a cookie-session login flow, a 4 s server-held
navigation, history back, a cross-origin iframe (must report `blocked`
fast), a 600 ms debounced search, file upload, and a sticky header.

### Results

Run `2026-09-20`, headless Chromium 1194, 43 tasks. "Before" is the same
harness on the previous `src/`; six of its eleven failures were harness
scripts, not the agent, and are marked so.

| | before | after, 0 ms | after, 800 ms latency | 3× repeat, 4 parallel |
| --- | --- | --- | --- | --- |
| verified | 28 / 39 | 43 / 43 | 43 / 43 | 129 / 129 |
| median total | 110.7 s | 67.4 s | 211.0 s | — |
| suite wall (3 workers) | 49.6 s | 39.0 s | 84.1 s | 85.0 s |

Results: `baseline-1789872308343.json`, `final0-1789873404443.json`,
`final800-1789873492724.json`, `repeat3-1789873631813.json`.

### What the suite found and what changed

| Symptom (task) | Root cause | Fix |
| --- | --- | --- |
| Chrome never exposes CDP as root (every task, containers/CI) | Chrome refuses to start as uid 0 without `--no-sandbox` | flag added when `getuid()===0`; `JEV_CHROME_ARGS` for operator flags |
| clicks on the autocomplete suggestion did nothing (fx-autocomplete) | the `#sugg` container had an `onclick` delegation handler, so it was indexed as a button named "Lisbon" ahead of the real button; the click landed beside it | delegation containers with offered interactive descendants are no longer offered themselves |
| TYPE_TEXT and CLICK stale forever in shadow-in-shadow (shadow-nested) | `document.elementFromPoint` stops at the outer host; the covered check saw a stranger | hit test descends open shadow roots; e's own host chain counts as uncovered |
| DONE claim → 8 stale cycles → `blocked` on a page with a clock (mutating) | claim freshness compared the full marker, text included | DONE/BLOCKED use `structure` freshness: identity, URL, title, controls, form state — never text |
| same on a 300 ms virtual-DOM re-render (rerender) | node ids churn; the page key and marker embed them; the fill path re-checked the full marker | page key and structure compare by meaning, not node id; `cache.node()` re-resolves a swapped node by root+role+name once; pre-fill check is page-level |
| click guard fails after ~150 ms next to a ticker | guard included the scope's `innerText` | guard is identity, semantics, rounded rect |
| scroll steps cost ~1 s each; the first wheel after launch is dropped (big-dom, infinite-scroll) | headless Chrome acks a `mouseWheel` only after ~1 s; smooth scrolling added ~750 ms | programmatic `scrollBy` on the inner scroller under the probe points (overflow panes, same-origin iframes), else the window; `--disable-smooth-scrolling` |
| 30 model calls per 3.5 s XHR (slow-ajax), 40 per 4.5 s timer (late-render) | WAIT slept 100 ms and returned | WAIT polls up to 1.5 s and returns on marker change or network idle: 6 and 5 decisions |
| honest BLOCKED took 21 s on a static page (xorigin) | two 10 s probes per stuck episode | one full probe; a claim repeated after the repair consult is accepted |
| confirmation at the DOM tail invisible on long pages (huge-text) | text budget kept the first 6000 chars | over budget: 4500 head + 1500 tail |
| verifier could not see the tail | `RunResult.final_text` was capped at 2000 chars | full page text |

Mock-script failures in the "before" column (fixed in `stress.json`, not in
`src/`): fx-hover-menu, form-multi, delayed-enable, login-flow, huge-text's
verifier, and big-dom's off-screen confirmation.

### Machinery costs measured (0 ms mock latency)

- Chrome launch to first observation: ~600 ms on a small page, ~1.2 s on
  the 4000-control grid.
- One decision cycle (observe, guard, act, settle): 60–120 ms typical;
  ~250 ms on 4000 controls (snapshot dominates).
- The `DONE` stability window: 400 ms, 1500 ms with requests in flight.
- The premature-done consult costs one extra decision on every one-action
  imperative goal (`fx-select`: 1 step, 3 decisions). At production latency
  that is ~1 s per short task; it exists because the model claims DONE
  early on two-part goals.

### Still open

- The 250-control cap is positional: on a dense grid the 251st visible
  control cannot be reached. A token-budget cap would help.
- `PRESS_END`/`PRESS_HOME` scroll only while focus is on the document.
- A `BLOCKED` on a static page still costs one 10 s probe.
- This suite cannot judge decision quality. The live `tasks.json` suite
  needs `TYPESAFE_API_KEY` and `TEXT_MODEL_API_KEY`; run it after every
  change to `src/questions.ts` or `src/model/`.

## bench-v9 vs full-v7

`bench-v9-1789795504888.json` vs baseline `full-v7-1789789722092.json`
(55 tasks, 1 run each). The verifier now reports `unverifiable` for tasks
with no runnable expectation — an honest non-failure, excluded from the
verified count rather than silently passed.

| | full-v7 | bench-v9 |
| --- | --- | --- |
| verified | 54 | 36 |
| unverifiable | 0 | 16 |
| failed | 1 | 3 |
| median per-task | 2583ms | 2373ms |
| median total | 181715ms | 247005ms |

The 16 unverifiable verdicts are tasks whose `expect` is empty — the old
verifier counted them as passes; the new one declines to claim a check.

**Fixed vs baseline:** github-issues (done/NO → done/yes).

**New failures:**

- `tin-file-upload` — done → **blocked**: the model clicked `Focus textbox`
  four times and never triggered the upload.
- `tin-dynamic-controls` — done/**NO**: clicked `Enable` once and declared
  DONE ~850ms later, before the async enable produced "It's enabled".
- `tin-key-press` — done/**NO**: clicked `Focus textbox` and declared DONE
  without ever pressing the key (expected "You entered: TAB").

All three are premature-DONE / wrong-action decision failures on text-input
tasks; the machinery ran fine.

**Notable timing deltas** (median elapsed): the typical task got faster
(median −34ms; 12 tasks improved ≥500ms, led by wikipedia-search-nav −2.3s,
parabank-login −2.2s), but a long tail pushed the total +36%:
tin-nested-frames +19.1s and tin-sortable +11.3s (both blocked-expected —
the repair consult extends how long a stuck run persists), tin-slow +16.4s
(28 steps), hn-paginate +9.8s, demoqa-autocomplete +8.5s, europa-consent
+7.0s, tin-dynamic-loading +4.9s, fx-disabled-redeem +3.3s.

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
