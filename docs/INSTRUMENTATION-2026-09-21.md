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

## Finding 2: the answer channel returns nothing on compound goals — FIXED

The original reading was wrong on the cause. Extraction was not skipped for
compound goals; `goalAsksForAnswer` matches both `todomvc-count-answer` and
`sauce-cart-count`. The helper ran, read the page, and declined — and the
harness recorded that as an empty string, identical to never having asked.

`sauce-cart-count` shows why it declined. The agent logs in, adds two
products, and ends on the right page. The goal asks for "the number shown on
the cart badge". The badge is a control labeled `2`; the text walk flattens
it into `Swag Labs 2 Products`, where it is indistinguishable from the
product count. The extractor only ever saw that text.

**What was done.**

- `RunResult.answer_note` records why an answer is absent — the run never
  reached done, the goal asked for nothing, the helper declined, or the
  helper failed and how. The eval runner prints it in place of the empty
  string on an `answer_match` failure.
- `extractAnswer` now also receives the indexed element list — labels with
  their values, checked and selected state — so a named control keeps its
  own value instead of dissolving into prose.
- `ANSWER_VALUE` makes the split explicit: text is authoritative for wording
  and for reading order, elements resolve a named control, and `first` /
  `last` never resolve against elements.
- `extractAnswer` retries once on a malformed helper reply, the allowance
  `fieldText` already had.

That last one came straight from the new note. A `todomvc-count-answer` run
failed with `helper failed: SyntaxError: Unexpected non-whitespace character
after JSON` — a provider hiccup that had previously been invisible.

**Measured in stages**, because the first attempt was a wash. Adding the
element list alone fixed `sauce-cart-count` but broke two text-reading
tasks: `sortable-resort-extract` answered `Smith` instead of `Bach`, and
`todomvc-count-answer` answered `1` instead of `1 item left`. Net zero,
16/21. The element list had introduced a second ordering that competed with
reading order. Making text authoritative in the prompt resolved it — 19/20
at `--repeat 5`, the single failure being the JSON hiccup above.

| | before | after |
|---|---|---|
| all 9 answer tasks, 3 runs each | 22/27 | 24/27 |
| `sauce-cart-count` | 1/3 | 3/3 |
| `sortable-resort-extract` | 3/3 | 3/3 |
| `todomvc-count-answer` | 3/3 | 3/3 |

Every `answer_match` clause now passes. The 3 remaining failures are all
`books-page3-price`, which blocks on `no_progress` before it can answer —
Finding 7, not this one.

Evidence: `ansbase-hardest-1790008031800.json` (before),
`ansfix-hardest-1790008254222.json` (element list only, the wash),
`ansfix2-1790008475727.json` (`--repeat 5`),
`ansfinal-hardest-1790008660393.json`, `ansfinal-hard-1790008683000.json`,
`ansfinal-harder-1790008708784.json` (after).

## Finding 3: a follow-up can undo the action it follows — FIXED

`demoqa-autocomplete` typed `re`, clicked `Red`, then fired a
`CLICK_MATCH_TYPED` follow-up that landed on `Remove Red`. Final page text:
`option Red, deselected`.

The resolver picks the element that appeared in response to typing. After a
successful pick, the thing that appears is the chip's remove affordance —
and it matches the typed token `re` at least as well as the suggestion did.

**What was done.** `CLICK_MATCH_TYPED` no longer considers a newcomer whose
label opens with a removal verb: `remove`, `delete`, `clear`, `deselect`,
`unselect`, `undo`, or a close glyph. Anchored at the start, so `Red` is
untouched and `Remove Red` is excluded.

**Evidence.** `undofix-1790008734848.json`, 3/3. Ops are now
`["TYPE_TEXT:combobox \"re\"", "CLICK:Red"]` with no follow-up, and the page
reads `option Red, selected` every run.

## Base-tier regression check

`regress-base-1790009208994.json` — 55 tasks, 1 run each, 49 verified.
Against the baseline `tasks-1790003125238.json` (3 runs each), three tasks
moved from 0/3 to passing — `tin-checkboxes`, `tin-infinite-scroll`,
`demoqa-autocomplete` — and nothing regressed.

Two tasks needed a recheck before that could be claimed
(`recheck-1790009396135.json`, 3 runs each):

- `mdn-search` errored once with `Cannot read properties of null (reading
  'text')` at 0 ms, before any decision. It passes 3/3 on recheck. Not
  caused by these changes — the crash is in the first-observation settle
  path, and it is worth tracking separately.
- `flights-zurich-london` blocked once on `no_progress`. It passed on
  recheck. Its baseline was 2/3; the historical record has it at 28/39.

## Blocked: TypeSafe credits exhausted

The recheck ended on `402 Your organization has no available TypeSafe API
credits`. No further eval evidence can be gathered until the account is
topped up. Findings 4 to 7 are unstarted for that reason, not because they
were judged not worth doing.

## Finding 4: PRESS_ESCAPE is the reflex for modals that ignore it — FIXED

`tin-entry-ad` and `tin-entry-ad-close` both pressed Escape once and stopped.
The modal was still open in the final text.

No dismiss fallback was needed. The fix was Finding 6: Escape was offered on
every page whether or not anything could receive it, so it read as the
generic "close this" move. Once the key list is gated, the modal's own
`Close` control is the obvious choice.

Both tasks now pass, with ops `["CLICK:Close"]` — `gate-base-1790010803974.json`
and `gate-hardest-1790011384574.json`.

## Finding 5: the drag executes and changes nothing

`tin-drag-drop` issues `DRAG:A` twice. The list order never changes —
final text stays `Drag and Drop A B`. The driver reports success; the page
disagrees. HTML5 drag-and-drop on that page is not responding to the
synthesised sequence.

**Proposed tooling change.** A drag that leaves the fingerprint unchanged
should report as a no-op to the loop, the way a dead click does, instead
of being recorded as a completed action.

## Finding 6: the action space is mostly fixed overhead — FIXED

Measured across 50 instrumented runs before the change:

| | min | median | max |
|---|---|---|---|
| fixed controls offered | 17 | 18 | 19 |
| real page elements | 2 | 14 | 96 |

Scroll was already gated on scroll position. The overhead was the other 17:
`wait`, `go_back`, `go_forward`, and all fourteen `PRESS_*` keys, offered on
every page unconditionally.

**What was done** (`src/snapshot.js`). PRESS_* sends a key to whatever holds
focus, so with nothing focused the key is lost — the prompt already says so.
The key list now matches that:

- `tab` and `escape` always. Tab is how focus is acquired; Escape closes
  native pickers that expose no element of their own.
- `enter`, `space`, and the four arrows only when something is focused.
- `backspace`, `delete`, `home`, `end` only when focus is in a text entry.
- `pageup`, `pagedown`, `home`, `end` only when the document scrolls.
- `go_back` only when `history.length > 1`.

**Result**, across all four tiers (n=121 runs), min / median / max:

| | controls | elements |
|---|---|---|
| before (base tier, n=55) | 17 / 18 / 19 | 0 / 22 / 158 |
| after (all tiers, n=121) | 5 / 11 / 19 | 0 / 24 / 158 |

Median fixed overhead fell from 18 to 11, and the floor from 17 to 5.

It also raised the pass rate rather than merely trimming tokens. Base tier
went 49/55 to 52/55: `tin-entry-ad`, `mdn-search` and `flights-zurich-london`
all started passing, and `tin-entry-ad-close` went 0/3 to passing in the
hardest tier. A smaller space is a more answerable question.

Two hardest-tier tasks showed 0/1 on the sweep and passed 3/3 on recheck
(`gate-recheck-1790011460492.json`): `demoqa-right-click` and
`todomvc-count-answer`. No task regressed.

Evidence: `gate-base-1790010803974.json` (52/55),
`gate-hard-1790011007622.json` (19/20), `gate-harder-1790011231635.json`
(26/26), `gate-hardest-1790011384574.json` (16/20), plus the recheck.

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
2. ~~Answer extraction on compound goals (Finding 2).~~ Done — the cause
   was the extractor's input, not a skipped call.
3. ~~Destructive-newcomer exclusion in `CLICK_MATCH_TYPED` (Finding 3).~~
   Done.
4. ~~Precondition-gated action space (Finding 6).~~ Done.
5. ~~Modal dismiss fallback (Finding 4)~~ — fell out of Finding 6, no
   fallback needed. Drag no-op detection (Finding 5) is still open.
6. Investigate the `no_progress` cluster (Finding 7) with the
   `decision` event trail.

## Reproducing

```
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  node scripts/eval.mjs --file tasks.json --tasks tin-checkboxes
```

Results carry `why`, `blocked_cause`, `space` and `done_consults` per run.
`evals/results/` is gitignored — these are run evidence, not artifacts.
