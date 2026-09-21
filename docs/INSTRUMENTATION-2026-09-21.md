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

**Element state at the terminal page** (`src/agent.ts`, `scripts/eval.mjs`).
`RunResult` carried `final_text` but nothing about element state, so a
checkbox or tab task could only be verified by the clicks it made. A new
`final_state` field renders one line per element carrying `checked`,
`selected`, `expanded` or `value`, and a new `expect.state_match` clause
asserts against it.

## Finding 1: the suite tests mechanism, not outcome — FIXED

Three failures looked like the agent going wrong. Two were the harness
asserting *how* instead of *what*. The third was worse: a task that could
not fail.

- `tin-checkboxes` wanted two `CLICK:checkbox` ops. The page ships
  `<input type="checkbox" checked>` on checkbox 2, so checking both takes
  exactly one click. The agent clicked once and was right. The outcome was
  not assertable at all — page text for that page is just
  `Checkboxes / checkbox 1 / checkbox 2`, identical checked or not.
- `tin-infinite-scroll` wanted `SCROLL_DOWN` twice. The agent pressed
  PageDown twice and loaded the content. Same outcome, different op name.
- `apg-tabs` existed twice under one id — `tabs-automatic` in the hard
  tier, `tabs-manual` in the hardest tier. The hardest copy asserted
  `text_match: "Maria|Ahlefeldt"`, which the page's own prose satisfies on
  load. It passed 3/3 while the ops were only `WAIT` and `SCROLL_DOWN` —
  the agent never touched the tablist. A false pass, not a disagreement
  between tiers.

**What was done.** `final_state` and `expect.state_match` were added, then:

| task | was | now |
|---|---|---|
| `tin-checkboxes` | `action_match: CLICK:checkbox ×2` | `state_match: checked=true ×2` |
| `tin-infinite-scroll` | `action_match: SCROLL_DOWN ×2` | op family — `SCROLL_DOWN\|PRESS_PAGEDOWN\|PRESS_END` ×2 |
| `apg-tabs` (hard) | `action_match: Ahlefeldt` | id `apg-tabs-auto`, `state_match: Ida da Fonseca selected=true` |
| `apg-tabs` (hardest) | `text_match: Maria\|Ahlefeldt` | id `apg-tabs-manual`, same `state_match` |

Both tabs tasks also changed target. "Maria Ahlefeldt" is the first tab and
is selected on load, so even a correct state assertion passed without the
agent doing anything. "Ida da Fonseca" is the third tab and requires a real
click.

Where the action genuinely *is* the behavior — a drag must drag, a download
must download — `action_match` stays. Where an op family matters rather than
one op name, match the family.

**Evidence.** All four pass 3/3 with the intended ops:
`fix1-base-1790007458581.json` (6/6, `tin-checkboxes` one click and both
boxes `checked=true`; `tin-infinite-scroll` two PageDowns),
`fix1-hard2-1790007575425.json` and `fix1-hardest2-1790007607274.json`
(3/3 each, ops end `CLICK:Ida da Fonseca`, state flips to
`Ida da Fonseca selected=true`).

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

1. ~~Fix the three mechanism-asserting expectations (Finding 1).~~ Done —
   see Finding 1. Also added the `state_match` clause they needed.
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
