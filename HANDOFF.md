# Browser task replay handoff

Date: 2026-09-29

## Objective

Compare real tasks previously attempted with `agent-browser` against `jev-browse`. Continue this work in this repository. The user explicitly skipped the authenticated AI Hero task.

## Setup and scope

- Reference host: `Pedro-Guimaraes-Ravn-GFV73Y4047`.
- Replays used `node bundled/cli.mjs` with the default Chrome CDP engine and `JEV_PROVIDER=openrouter`. The TypeSafe provider returned HTTP 402, reporting no available credits.
- The replay goals avoided votes, answers, account changes, and downloads. Do not retry AI Hero as part of this comparison.
- A prior summary is at `/Users/pedro/.agents/reports/browser-tool-replay-2026-09-29.md` (commit `e42a1c7`).

## Results

| Prior task and source session | `agent-browser` evidence | `jev-browse` replay | Conclusion |
| --- | --- | --- | --- |
| CertSafari three exam question sets, Pi `01a0a05a-c1e3-737e-a196-bfbe1e44a3ae` | Public sample pages exposed 35 questions per exam; protected quiz pilot stalled on Turnstile. | All three public practice-question pages returned `done`, their expected final URLs, and visible first questions. Foundations and Developer explicitly reported 35 free samples. | Public reading worked for all three distinct sets. No protected bank was extracted. |
| CertSafari Architect Foundations protected quiz, same session | Clicking “Start quiz” led to repeated verification challenges; no protected question was reached. | Clicked “Start quiz,” waited twice, then ended with `CDP call timed out` before any question was visible. | Incomplete. The timeout does not establish that Turnstile was the cause. |
| Ravn design gallery production check, Claude `51ff4c36-289f-4639-8e12-606b11c75db3` | After a shared-profile collision, an isolated session reported `loaded:["true","true"]` for `.live-stage` and two warm iframes. | Returned `done` on the production URL; final text showed the A and B comparison panels, each labeled “Interactive.” It scrolled but did not expose iframe load state. | Page and panels were visible. Embedded preview readiness was not verified to the old standard. No vote was cast. |
| Claude certification guide section links, Claude `b0e4c894-6c80-483c-9e5d-ecb136a0d3de` | Used `agent-browser` to inspect guide navigation and shareable anchors. | Broad goal clicked heading anchors and produced fragment URLs, but continued navigating until `step_budget`. A tighter goal clicked one `#` anchor and returned `done` after one step at `#claude-certified-architect-foundations-certification`. | The anchor interaction worked. Stopping depended strongly on an explicit one-click completion condition. |

## Reproduction

Run from this repository with an existing OpenRouter credential in the environment. Do not print or copy credentials.

```sh
JEV_PROVIDER=openrouter node bundled/cli.mjs --url https://www.certsafari.com/anthropic/claude-certified-architect-foundations/practice-questions --goal 'Stop when a public sample question is visible or a blocking page is clear. Do not start a quiz.' --max-steps 6
JEV_PROVIDER=openrouter node bundled/cli.mjs --url https://gallery-production-e6fd.up.railway.app/ --goal 'Verify both comparison panels are visible. Do not vote, skip, or advance.' --max-steps 8
JEV_PROVIDER=openrouter node bundled/cli.mjs --url https://ravnhq.github.io/claude-certified-architect/guides/en.html --goal 'Click exactly one visible # anchor beside a heading. The task is DONE immediately when the URL gains any # fragment. Stop there without clicking another link.' --max-steps 4
```

The other CertSafari public sample URLs are:

- `https://www.certsafari.com/anthropic/claude-architect-professional/practice-questions`
- `https://www.certsafari.com/anthropic/claude-developer-foundations/practice-questions`

## Next work

1. Reproduce the CertSafari CDP timeout with diagnostics that distinguish page/challenge delay from a browser transport failure. Keep the flow limited to the public start action; do not bypass verification.
2. Give gallery replays an observable iframe readiness result equivalent to the historical `.live-stage` check. The current `final_text` only proves the outer panels rendered.
3. Check why the broad guide goal continued after reaching a URL fragment while the precise goal stopped. Preserve the successful one-click behavior.
4. If changing `src/`, follow this repository's `AGENTS.md` checks and run the affected behavioral eval tier. Record verified, unverifiable, and failed counts and the result path. No code was changed in this handoff.

## Evidence limits

These are live-site replays from September 29 against older sessions, so site changes and browser profiles differ. The `done` label alone was not treated as proof: successful cases were checked against `final_url` and visible page text. The gallery result needs stronger evidence, and the quiz result is a failure to finish. The AI Hero comparison was deliberately skipped; its OpenRouter retry had previously been rejected by automatic approval review because it could expose authenticated page content.

## Follow-up investigation (2026-09-29)

Evidence: `.cursor/skills/verify-jev-browse/artifacts/20260929-124602-20579/`.

- Verification doctor passed, including the file URL denial gate. No source or bundle changes were made, and no behavioral eval suite was run.
- Gallery: `gallery-readiness.jsonl` records two `.live-stage` elements changing from `loaded:false` to `loaded:true`, with one iframe each. This matches the historical DOM readiness check. The cross-origin iframe documents were inaccessible (`ready:null`); this does not prove their internal functionality. `gallery-probe.mjs` preserves the observation method. Run with native Node TypeScript support, not `--import tsx` (tsx is unavailable locally).
- Quiz from the sample URL: `quiz.json` reports done after navigating to the overview, without clicking Start quiz. This is a premature completion, not proof that the requested flow succeeded.
- Quiz from the overview: `quiz-start.stderr` records Start quiz and slow Runtime.evaluate responses while Browser.getVersion still replied. However, a gallery probe accidentally overlapped on the same profile and closed the shared browser. Discard the terminal connection-closed error as contaminated evidence; it does not reproduce the original timeout. Run future probes strictly sequentially or on separately created profiles.
- An uncontaminated retry was rejected by automatic approval review: entering the quiz might send non-public question content to OpenRouter without specific authorization for that payload and destination. Do not retry that flow through another route. User approval is needed before sending potentially non-public quiz observations to OpenRouter.
- Static guide investigation: `src/questions.ts` requires visible evidence for all goal requirements; it does not treat any URL fragment as universal completion. `evals/README.md` already documents wandering on unbounded goals and recommends explicit end states. The broad-vs-precise historical result is consistent with goal ambiguity, but this is an inference, not a reproduced root cause. No prompt change is justified yet. The precise anchor replay remains to be rerun, followed by a comparison using the exact historical broad goal.

Remaining: obtain approval for the quiz/OpenRouter boundary before retrying; preserve method timing and Browser.getVersion liveness probes (`protocol-probe.mjs`). Recover the exact broad guide goal before claiming an A/B comparison. Gallery DOM readiness evidence is now available independently of the agent's final text; exposing it in product output remains a separate implementation decision.

## Approved isolated retry (2026-09-29)

The user explicitly approved sending potentially non-public quiz observations to OpenRouter. Evidence: `.cursor/skills/verify-jev-browse/artifacts/20260929-125010-88080/`. Doctor passed; both replays ran sequentially with no other browser probe.

- `quiz.json`: returned done at the quiz setup dialog, not a question or challenge. One Start quiz click only opens setup; the earlier goal was insufficiently explicit.
- `quiz-setup.json`: the revised goal explicitly required submitting setup and stopping at a question or challenge. The final status was blocked, with visible text `Verifying with Cloudflare... (max 5 seconds)` and `Please complete verification to continue.` No question was visible. History includes two Start quiz clicks and an unnamed `button` click; the evidence does not identify that button, so do not claim perfect adherence to the instruction to avoid verification interaction.
- `quiz-setup.stderr`: Runtime.evaluate took 7,626 ms, 7,567 ms, and 20,327 ms, while interleaved Browser.getVersion probes replied promptly. The socket closed normally with no pending calls. The original 30-second timeout did not reproduce. This run demonstrates page-evaluation delays with a responsive browser transport; it does not establish why the historical timeout occurred or prove Cloudflare caused those delays.
- No source/bundle changes or behavioral suite runs. These are diagnostic CLI replays, not eval verified counts. The gallery and guide follow-up status above remains unchanged. Do not expand quiz retries into answering questions or bypassing verification.

## Implementation completed

See `evals/replay-findings.md` for changes, verified suite counts, result paths,
and remaining model-only completion limits. The guide's transient copied class
was identified in freshness traces and excluded from completion stability only.
The strict quiz replay now supplies persistent explicit completion evidence and
stops at visible verification. New local diagnostic traces replace the temporary
WebSocket probe. Source and committed bundles are updated together.

## Release and follow-up

Published v0.14.4 from 2c567e3:
https://github.com/0x7067/jev-browse/releases/tag/v0.14.4

Subsequent investigation and the retained host-clock settling fix are documented
in `evals/unresolved-findings.md`. Experimental model-only completion changes were
discarded after regressions. General model-only completion and the historical
intermittent CDP timeout remain open; do not describe them as solved.
