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
empty.

Task classes covered: navigation, search+autocomplete, multi-field forms,
native select, iframes, shadow roots, hover-reveal menus, file upload,
key presses, AJAX waits, disabled-until-input controls, modals, new tabs,
range sliders, and a full Google Flights flow. `fixture-interactions.html`
runs through `file_url` tasks for deterministic coverage.

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

**Since then, all 16 carry expectations.** Each formerly-empty `expect` was
grounded in the page's real end state (page text probed through `observe()`,
or the URL the site actually navigates to): `action_match` for the
interaction-only goals (dropdown SELECT, checkbox clicks, scrolls,
CONTEXT_CLICK, DRAG, calendar day click), `text_match` for pages that render
a result string (slider value, autocomplete chip, closed entry ad, dismissed
consent banner, swapped drag columns), and `url_match` for the navigating
ones (dynamic_content's static link, MDN search). Two goals were sharpened so
they name a checkable end state (`tin-dynamic-content`, `tin-large-dom`);
nothing was removed. Because of this, verified / unverifiable counts from
runs before this change are **not comparable** with runs after it — 16 tasks
moved out of the unverifiable bucket and now report verified or failed on
their own merits.

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

## live-v11 (2026-09-20)

Four consecutive full runs against the live TypeSafe model (`jev-latest`)
with `inception/mercury-2.5` on OpenRouter as the text helper, from a
headless Linux container behind an egress proxy. Runs 1 and 2 carry the
driver fixes below; run 3 adds the two loop changes; run 4 adds the modal
and shadow-text changes at the end of the table.

| | bench-v10 | live-v11 run 1 | run 2 | run 3 | run 4 |
| --- | --- | --- | --- | --- | --- |
| verified | 36 | 35 | 35 | 35 | 35 |
| unverifiable | 16 | 16 | 16 | 16 | 16 |
| failed | 3 | 4 | 4 | 4 | 4 |
| median total | 388.9 s | 238.9 s | 253.0 s | 192.8 s | 182.2 s |

Verdicts were identical across all four runs. The one unverifiable task
that changed outcome is `mdn-search`: blocked in runs 1–3 (reproducibly),
done in run 4 after the modal fix.

The four failures are this container's network, not the agent, and were
confirmed by tracing each one (`final_text` is now kept in results):

- `github-issues` — github.com answers with the proxy's "access not
  enabled" JSON; the page has no controls.
- `parabank-login`, `parabank-transfer` — the proxy rejects the site's
  `;jsessionid=` URLs ("path contains matrix parameter separator").
- `flights-zurich-london` — the Flights frontend bundle from gstatic fails
  with `ERR_BLOCKED_BY_ORB` on every load, so the ticket-type combobox
  never initializes: trusted click, in-page click, and focus+Enter all leave
  `aria-expanded=false`. Typing into the destination field still works.

Fixes in this version, each confirmed by a live re-run of the affected task:

| Symptom (task) | Root cause | Fix |
| --- | --- | --- |
| Chrome never exposes CDP as root (containers, CI) | Chrome refuses uid 0 without `--no-sandbox` | flag added for uid 0; `JEV_CHROME_ARGS` for operator flags such as `--proxy-server` |
| delegation containers offered as targets | `ul.onclick`/`div.onclick` wrappers precede their children and take their text as a name; the click lands between the real targets | containers with an offered interactive descendant are not offered themselves |
| shadow-in-shadow controls read as covered | `elementFromPoint` stops at the outer host | the hit test descends open shadow roots; e's own host chain is uncovered |
| DONE/BLOCKED on pages with a clock or re-render stale-stormed into `blocked` | claims compared the full marker, text and node ids included | claims use `structure` freshness (identity, URL, title, controls, form state); page key and click guard drop node ids and ambient text; a swapped node is re-resolved once by root, role, name |
| scroll cost ~1 s per step, first wheel dropped | headless Chrome acks `mouseWheel` late and drops the first | programmatic `scrollBy` on the inner scroller or window; `--disable-smooth-scrolling` |
| WAIT burned a decision per 100 ms | fixed sleep | WAIT polls up to 1.5 s for a marker change or network idle (tin-dynamic-loading: 6 decisions) |
| repeated BLOCKED paid a second 10 s probe | probe re-armed after the repair consult | one probe per stuck episode |
| one-click tasks cost 3.7–3.9 s (example-link, books-toscrape) | the premature-done consult ran after the 1.5 s stability window, so the window was paid twice | consult first, window once: 2.1 s and 1.2 s |
| a BLOCKED claim on an idle page cost 10 s (hn-paginate 13.1 s, nested-frames 11.2 s) | probe deadline fixed at 10 s | 4 s when no request is in flight, 10 s otherwise: 6.0 s and 4.6 s |
| mdn-search: 9 stale cycles then blocked, every run | the model clicked the header Search button behind MDN's open modal; the snapshot offered it because inertness under `:modal` has no attribute to match | controls outside an open modal dialog are not offered; dialog text inside shadow roots is now read (the text walk pierces open shadow roots) |
| nested-shadow ancestors invisible to the covered check | the composed ancestor walk jumped to the host before the ancestors inside the shadow tree | parents first, host last; a target clipped by its own scroll container is scrolled into view once before it counts as covered |
| stale storms were opaque | events carried no reason | stale events name the target and the failed precondition |

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
