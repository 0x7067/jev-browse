# Jev provider

The user picks which service answers Jev decisions: TypeSafe directly or
OpenRouter. `JEV_PROVIDER` names it. When `JEV_PROVIDER` is unset or empty,
jev-browse uses TypeSafe if `TYPESAFE_API_KEY` is set, otherwise OpenRouter if
`OPENROUTER_API_KEY` is set. A drive through OpenRouter behaves like a drive
through TypeSafe; only the key and the billing account change.

## Sub-features

- `provider-openrouter` drives a fixture task with `JEV_PROVIDER=openrouter`.
- `provider-auto-openrouter` drives with no provider named and only the OpenRouter key present.
- `provider-typesafe` drives with `JEV_PROVIDER=typesafe`.
- `provider-unknown` refuses an unknown `JEV_PROVIDER` value before any browser work.
- `provider-missing-key` names the selected provider's key variable when it is empty.

## How to get to it (user POV)

- Set `JEV_PROVIDER=openrouter` and `OPENROUTER_API_KEY` in the shell or `.env`, then run `jev-browse` or the MCP `jev_browse` tool.
- Set only `OPENROUTER_API_KEY` and leave `JEV_PROVIDER` unset.
- Set `JEV_PROVIDER=typesafe` with `TYPESAFE_API_KEY`.

## Driving it with control-jev-browse

Preconditions:

- `control-jev-browse doctor` reports `doctor=ok` for this run.
- `eval "$(control-jev-browse env)"`.
- `provider-openrouter` and `provider-auto-openrouter` need `OPENROUTER_API_KEY` (out-of-band).
- `provider-typesafe` needs `TYPESAFE_API_KEY` with TypeSafe credits (out-of-band).
- `provider-unknown` and `provider-missing-key` need no key (in-band).

- **OpenRouter named.** Run
  `JEV_PROVIDER=openrouter control-jev-browse eval -- --tasks fx-modal --label verify-provider-openrouter`.
  Require `verified:1` / `failed:0`. Copy the written
  `evals/results/verify-provider-openrouter-*.json` to
  `jev-provider/openrouter-eval.json`, and save the summary line as
  `jev-provider/openrouter-summary.txt`.
- **OpenRouter picked automatically.** Run
  `TYPESAFE_API_KEY= control-jev-browse eval -- --tasks fx-modal --label verify-provider-auto`.
  Require `verified:1` / `failed:0`. Save the summary line as
  `jev-provider/auto-summary.txt`.
- **TypeSafe named.** Run
  `JEV_PROVIDER=typesafe control-jev-browse eval -- --tasks fx-modal --label verify-provider-typesafe`.
  Require `verified:1` / `failed:0`. A result whose error starts with `402`
  means the TypeSafe account has no credits: report `provider-typesafe` as
  unreachable with that error, not as verified.
- **Unknown provider.** Run
  `JEV_PROVIDER=bogus control-jev-browse cli -- --url https://example.com --goal stop`.
  Exit `1`. Stdout `status` is `error` and `error` is
  `JEV_PROVIDER must be one of typesafe, openrouter; got bogus`. Save stdout as
  `jev-provider/unknown.json`.
- **Selected key missing.** Run
  `JEV_PROVIDER=openrouter OPENROUTER_API_KEY= control-jev-browse cli -- --url https://example.com --goal stop`.
  Exit `1`. Stdout `error` contains `OPENROUTER_API_KEY is not set`. Save
  stdout as `jev-provider/missing-openrouter-key.json`.
- **Proof.** Eval `expect.*` verdicts prove the drives. The error strings prove
  the refusals. Each artifact name records which sub-feature it covers.

## Gotchas

- The CLI reloads the repo `.env`. `env -u NAME` does not hide a key that
  `.env` also sets; assign it empty (`NAME=`) instead.
- `doctor` reports only keys in the shell environment. A key that only `.env`
  sets shows as `unset` there but still reaches the CLI.
- The eval summary does not name the provider. Save the exact command, with
  its env assignment, next to each summary.
- A TypeSafe `402` is an account state, not a jev-browse regression.
