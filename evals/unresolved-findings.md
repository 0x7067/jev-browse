# Follow-up after v0.14.4

The GitHub release v0.14.4 points at commit 2c567e3. The settling change described
here is subsequent work and is not included in that tag.

## Retained fix: settling depends on the host clock

A browser settling wait with a 150 ms budget took 2,106 ms when the page's timers
were delayed by two seconds. The old implementation awaited a Promise resolved
by the page's own setTimeout, so the requested budget did not control that wait.
The new implementation polls the existing mutation revision and measures the
quiet interval using Node's monotonic clock. The same reproduction took 120 ms.
The unused page-side quiet timer and listener collection were removed.

Reproduce both quiet and continuously mutating cases with:

```bash
node scripts/check-settle-budget.mjs
```

This bounds the scheduled quiet wait independently of page timers. A stalled CDP
request can still exceed the settling budget and reach the protocol timeout.
The original historical timeout is not established as fixed.

## Timeout investigation

The guarded live quiz trace recorded an 11,014 ms Input.dispatchMouseEvent call.
Other evaluations spent only milliseconds executing page JavaScript while taking
substantially longer end to end. Browser liveness probes continued responding.
This excludes snapshot execution cost as a complete explanation.

Four controlled runs compared default Chrome scheduling with disabled background
throttling on the public exam overview. All observation/freshness/settle cycles
were fast (268–562 ms); the flags did not improve them consistently. No scheduling
flags were added. The intermittent historical timeout did not reproduce.

Evidence: `evals/results/scheduling-experiment.json`, `scheduling-*.jsonl`,
`settle-timer-before.json`, and `settle-timer-after.json`.

## Completion experiments rejected

The released completion classifier accepted the saved incomplete quiz setup
screen in three of three trials. Adding available-action evidence also accepted
it in three of three trials. An evidence-selection question rejected setup in
three of three trials and accepted the saved one-click anchor in three of three.
However, its integrated suite rejected a valid question screen and the live run
still stopped without reaching verification. Those source changes were discarded.

A separate configured text-model experiment returned invalid objects. A small
alternative-model comparison returned paraphrases and one invented success
claim. Neither was incorporated into the product.

The unsuccessful integrated suite recorded 9 verified, 0 unverifiable, 1 failed
in `evals/results/unresolved-fixes-1790699991746.json`. The live experiment recorded
1 verified, 0 unverifiable, 1 failed in
`evals/results/model-completion-live-1790700007561.json`. These are research
results, not validation of the retained implementation.

Explicit `--expect` conditions remain the reliable way to enforce strict
completion. General model-only completion remains unresolved.

## Retained-change validation

- `evals/results/settling-final-1790700148052.json`: 8 verified, 0 unverifiable,
  0 failed. Includes delayed content, modal, iframe, quiz setup, anchor, frame
  readiness, and explicit-completion cases.
- `scripts/check-settle-budget.mjs`: quiet wait 103 ms; continuously mutating
  wait 201 ms; both passed despite page timers delayed by 2,000 ms.
- Typecheck and lint passed; rebuilt bundles accompany the source change.
