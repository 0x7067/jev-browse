# Fixture type and redeem

On `fixture-interactions.html`, the Redeem button stays disabled until the
invite code field has text. The user types a code, clicks Redeem, and sees
`DONE: code redeemed`. Eval task `fx-disabled-redeem` covers TYPE_TEXT plus
the enablement gate.

## Sub-features

- `fx-disabled-redeem-eval` verifies `DONE: code redeemed` via `expect.text_match`.
- `type-text-helper` requires `TEXT_MODEL_API_KEY`, `TEXT_MODEL_BASE_URL`, and
  `TEXT_MODEL` in addition to `TYPESAFE_API_KEY`.

## How to get to it (user POV)

- Type into **Invite code**, click **Redeem** when it enables.
- Run eval task id `fx-disabled-redeem`.

## Driving it with control-jev-browse

Preconditions:

- `control-jev-browse doctor` reports `doctor=ok` for this run.
- `TYPESAFE_API_KEY` is set.
- `TEXT_MODEL_API_KEY`, `TEXT_MODEL_BASE_URL`, and `TEXT_MODEL` are set
  (out-of-band TYPE_TEXT).
- `eval "$(control-jev-browse env)"`.

- **Eval path.** Run
  `control-jev-browse eval -- --tasks fx-disabled-redeem --label verify-redeem`.
  Require `verified:1` / `failed:0`. Save results as
  `fixture-type-redeem/eval-result.json`.
- **Proof.** Task detail shows `verified: true` and final text matching
  `DONE: code redeemed`.

## Gotchas

- Click-only fixtures can pass with only `TYPESAFE_API_KEY`; this one cannot —
  missing text-model keys fail TYPE_TEXT mid-run.
- Do not hardcode a typed string through an internal setter; the helper model
  must supply the field value on the real CLI path.
- If doctor shows `text_model_api_key=unset`, stop and report unreachable.
