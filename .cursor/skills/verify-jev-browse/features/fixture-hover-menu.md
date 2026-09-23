# Fixture hover menu

On `fixture-interactions.html`, the Destinations menu reveals items only on
hover. The user picks **Alpine stays**; the page shows `DONE: alpine picked`.
Eval task `fx-hover-menu` covers this interaction.

## Sub-features

- `fx-hover-menu-eval` verifies `DONE: alpine picked` via `expect.text_match`.
- `fx-hover-reveal` requires a real `HOVER` (or equivalent) before the pick is
  visible to the action space.

## How to get to it (user POV)

- Hover **Destinations menu (hover)**, then click **Alpine stays**.
- Run eval task id `fx-hover-menu`.

## Driving it with control-jev-browse

Preconditions:

- `control-jev-browse doctor` reports `doctor=ok` for this run.
- A Jev provider key (`TYPESAFE_API_KEY` or `OPENROUTER_API_KEY`) is set (out-of-band).
- `eval "$(control-jev-browse env)"`.

- **Eval path.** Run
  `control-jev-browse eval -- --tasks fx-hover-menu --label verify-hover`.
  Require `verified:1` / `failed:0`. Save results under
  `fixture-hover-menu/eval-result.json` in the evidence dir.
- **Proof.** Results detail must show terminal text matching
  `DONE: alpine picked` (or `verified: true` for the task).

## Gotchas

- CSS `:hover` reveals are invisible to a plain DOM dump until hover runs —
  if the agent blocks early, check whether HOVER was offered.
- Live sites are not a substitute for this fixture when proving hover-reveal.
- Missing API key → unreachable; do not substitute the file-URL gate.
