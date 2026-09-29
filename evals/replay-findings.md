# Replay implementation evidence

Implemented local traces, method/purpose timing and liveness, attempted-target details,
completion verification and explicit regex conditions, visible challenge stopping,
frame readiness evidence, and Chrome process cleanup. Bundles rebuilt.

The guide trace proved that removal of its transient `copied` class invalidated
completion. Completion now ignores CSS class hints; action freshness retains them.
The precise live goal still takes one click. The broad goal finished in two clicks.

Model-only completion still accepted the live quiz setup dialog. Explicit conditions
are therefore used for the strict quiz replay and remain in every decision prompt.
That replay reached visible verification and stopped without unrelated clicks.
This is not a verification bypass. The historical timeout remains unproven; new
traces distinguish pending calls, renderer execution time, and browser responsiveness.

## Suite results

Rows are separate runs, not unique-task totals. The guarded live run includes a quiz
failure before persistent conditions were added; the final CertSafari row supersedes it.

| Result file | Verified | Unverifiable | Failed |
| --- | ---: | ---: | ---: |
| `evals/results/replay-final-1790698704936.json` | 19 | 0 | 0 |
| `evals/results/replay-stability-final-1790699181237.json` | 8 | 0 | 0 |
| `evals/results/replay-ab-final-1790699002974.json` | 2 | 0 | 0 |
| `evals/results/replay-ab-stability-1790699187256.json` | 1 | 0 | 0 |
| `evals/results/certsafari-evidence-final-1790699318199.json` | 1 | 0 | 0 |
| `evals/results/completion-evidence-final-1790699343639.json` | 2 | 0 | 0 |
| `evals/results/replay-live-guarded-1790699186795.json` | 2 | 0 | 1 |

The full 19-case fixture pass preceded the final completion-stability change;
the eight-case stability run and subsequent explicit-condition checks cover those
changes. Agent-browser checks cover shared frame and completion semantics. Its
initial frame assertion depended on JSON key order; the corrected check passed.

The real-CDP diagnostic proof passed evaluation values/errors, slow-call timing,
method-specific timeout reporting, liveness, and profile cleanup. MCP tools/list
exposed the new arguments. Typecheck and lint passed. Evidence and traces are copied
to `.cursor/skills/verify-jev-browse/artifacts/20260929-131924-30730/`.
