# Instrumentation and failure research, 2026-09-21

First full eval run on this branch: 121 tasks, 363 runs, 316 verified,
47 failed, 0 unverifiable. 21 tasks account for every failure.

The run exposed a gap in the harness itself. A rejected run printed
`verified:NO` and nothing else, so a wrong expectation and a real agent
bug were indistinguishable. This document covers the instrumentation
added to tell them apart, and what it found.

## What was added

**Rejecting clause** (`scripts/eval.mjs`). `verify()` returned a bare
boolean. It now returns the clause that rejected the run, the pattern,
and the actual value. Recorded per run as `why`, printed under the run
line, and summarised as a `failures by clause` digest.

```
tin-checkboxes  run 1/1  done  verified:NO  1997ms  steps:1 decisions:3
  ↳ action_match want:"CLICK:checkbox[\s\S]*CLICK:checkbox" got:"CLICK:checkbox"
```

**Blocked cause** (`src/agent.ts`). `blocked` carried no reason unless the
page was dead on arrival. Each exit is now tagged — `model_claim`,
`no_progress`, `stale_storm`, `decision_budget`, `step_budget`,
`dead_page` — surfaced on `RunResult.blocked_cause` and folded into the
status clause as `blocked/no_progress`.

**Action space offered** (`src/agent.ts`). A `decision` event reports the
element, control and operation counts the model was actually given, plus
whether a repair hint was attached. A `done_consult` event fires when the
premature-done guard challenges a claim. The eval runner aggregates both
per run as `space` and `done_consults`.

## Finding 1: the suite tests mechanism, not outcome

Three of the 21 failures are the agent succeeding by a different route
than the expectation names.

- `tin-checkboxes` wants two `CLICK:checkbox` ops. The page ships
  `<input type="checkbox" checked>` on checkbox 2, so checking both takes
  exactly one click. The agent clicked once and was right.
- `tin-infinite-scroll` wants `SCROLL_DOWN` twice. The agent pressed
  PageDown twice and loaded the content. Same outcome, different op name.
- `apg-tabs` fails 3/3 in the hard tier and passes 3/3 in the harder
  tier. Same page, two expectations, one of them wrong.

All three are `action_match` patterns asserting how the goal was reached.
That contradicts the repo's own principle — test behavior, not
implementation — and it is the harness, not the agent, that needs the fix.

**Proposed tooling change.** Keep `action_match` for cases where the
action *is* the behavior (a drag must drag, a download must download).
Everywhere else assert the end state the user would see, via `text_match`
or `answer_match`. Where an op family genuinely matters, match the family
rather than the literal: a `scrolled` predicate covering SCROLL_DOWN and
PRESS_PAGEDOWN, rather than one op name.

## Finding 2: the answer channel returns nothing on compound goals

`todomvc-count-answer` and `sauce-cart-count` both finish `done`, both
reach the correct page state, and both return `answer: undefined`.

TodoMVC ends showing `1 item left` in the page text — exactly what
`answer_match` asks for. The verifier compares against `result.answer ?? ""`,
so an absent answer can never match, however correct the page is.

These are do-then-report goals: act, then state a value. Answer extraction
appears to run for interrogative goals only. This is a real capability
gap, and it is worth more than the two tasks it costs here — a browsing
agent that cannot report what it just did is much less useful.

**Proposed tooling change.** Extract an answer whenever the goal contains
a reportable clause, not only when the whole goal is a question. Failing
that, record in the result why extraction was skipped, so the next run
does not have to guess.

## Finding 3: a follow-up can undo the action it follows

`demoqa-autocomplete` types `re`, clicks `Red`, and then fires a
`CLICK_MATCH_TYPED` follow-up that lands on `Remove Red`. Final page text:
`option Red, deselected`.

The resolver picks the element that appeared in response to typing. After
a successful selection the thing that appears is the chip's *remove*
affordance. The heuristic is correctly implemented and structurally wrong:
it cannot distinguish a suggestion from an undo.

**Proposed tooling change.** Exclude newcomers whose label or role marks
them as destructive (`Remove`, `Delete`, `Clear`, `aria-label` beginning
with a removal verb) from `CLICK_MATCH_TYPED` resolution. Better: only
resolve a newcomer that sits inside the listbox/menu the combobox owns,
which the snapshot can see via `aria-controls` and `aria-owns`.

## Finding 4: PRESS_ESCAPE is the reflex for modals that ignore it

`tin-entry-ad` and `tin-entry-ad-close` both press Escape once and stop.
The modal is still open in the final text — `This is a modal window` and
its `Close` control are both present. This one is a real agent failure,
not a bad expectation.

**Proposed tooling change.** Escape is a speculation like any other. When
a modal is still detected after it, the modal's own dismiss control
should win the next decision rather than the run ending.

## Finding 5: the drag executes and changes nothing

`tin-drag-drop` issues `DRAG:A` twice. The list order never changes —
final text stays `Drag and Drop A B`. The driver reports success; the page
disagrees. HTML5 drag-and-drop on that page is not responding to the
synthesised sequence.

**Proposed tooling change.** A drag that leaves the fingerprint unchanged
should report as a no-op to the loop, the way a dead click does, instead
of being recorded as a completed action.

## Finding 6: the action space is mostly fixed overhead

Measured across 50 instrumented runs:

| | min | median | max |
|---|---|---|---|
| fixed controls offered | 17 | 18 | 19 |
| real page elements | 2 | 14 | 96 |

Every decision carries 17–19 controls regardless of the page. On
`tin-slow`, 17 controls accompany 2 real elements — 89% of the offered
space cannot do anything useful there. The handoff flagged this
qualitatively; it is now a number that can be tracked.

**Proposed tooling change.** Gate controls on observable preconditions.
Offer scroll operations only when the page scrolls, `back` only with
history, `PRESS_ENTER` only with focus in a text field. This is a change
to `actionSpace` in `src/model/space.ts`, and the `space` metric now in
every result file measures whether it worked.

## Finding 7: blocked is mostly stalemate, not budget

Blocked causes across the failing tasks:

- `no_progress` — `flights-zurich-london`, `books-page3-price`,
  `github-search-repo`, `github-repo-search`
- `model_claim` — `tin-iframe`, `tin-slow`

No run hit `decision_budget` or `step_budget`. The loop is giving up on
its own stalemate detector, not running out of room. `github-search-repo`
gets as far as typing the query and clicking a suggestion before stalling,
which points at the search-suggestion interaction rather than the site.

`tin-iframe` is expected — the handoff records the TinyMCE demo as
read-only.

## Suggested order

1. Fix the three mechanism-asserting expectations (Finding 1). Cheapest,
   and it removes noise from every later measurement.
2. Answer extraction on compound goals (Finding 2). Largest capability
   gain per unit of work.
3. Destructive-newcomer exclusion in `CLICK_MATCH_TYPED` (Finding 3).
   Narrow, well understood, has a reproducible task.
4. Precondition-gated action space (Finding 6). The instrumentation to
   judge it is already in place.
5. Modal dismiss fallback (Finding 4) and drag no-op detection (Finding 5).
6. Investigate the `no_progress` cluster (Finding 7) with the
   `decision` event trail.

## Reproducing

```
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node scripts/eval.mjs --file tasks.json --tasks tin-checkboxes
```

Results carry `why`, `blocked_cause`, `space` and `done_consults` per run.
`evals/results/` is gitignored — these are run evidence, not artifacts.
