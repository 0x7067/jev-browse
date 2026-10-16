# CLI missing key

Without a Jev provider key, jev-browse cannot call Jev. The CLI returns a
`RunResult` with `status` `error` and an `error` message that tells the
user to set the key, and exits `1`. With no provider named and no key at
all, auto-selection picks OpenRouter (TypeSafe is the automatic choice
only when it is the sole configured key), so the message names
`OPENROUTER_API_KEY`.
Pinning `JEV_PROVIDER=typesafe` makes the message name `TYPESAFE_API_KEY`
instead.

## Sub-features

- `cli-missing-key` exits `1` with `OPENROUTER_API_KEY is not set` on an
  http(s) URL when neither provider key is set and `JEV_PROVIDER` is unset.
- `cli-missing-key-typesafe` exits `1` with `TYPESAFE_API_KEY is not set`
  when `JEV_PROVIDER=typesafe` is named and that key is empty.
- `cli-missing-key-after-file-allow` is the same missing-key error after
  `--allow-file-urls` passes the scheme check (see also file-url-gate).

## How to get to it (user POV)

- Run `jev-browse --url https://example.com --goal "..."` with neither
  `TYPESAFE_API_KEY` nor `OPENROUTER_API_KEY` set.
- Run the same via `node bundled/cli.mjs`.

## Driving it with control-jev-browse

Preconditions:

- `control-jev-browse doctor` reports `doctor=ok` for this run.
- Both provider keys are empty for these drives (in-band); each recipe sets
  `JEV_PROVIDER` itself — empty for the auto-selection drive, `typesafe` for
  the named drive.
- `eval "$(control-jev-browse env)"`.

- **Missing key.** Run
  `TYPESAFE_API_KEY= OPENROUTER_API_KEY= JEV_PROVIDER= control-jev-browse cli -- --url https://example.com --goal "stop"`.
  Exit code `1`. Stdout JSON `status` is `error` and `error` contains
  `OPENROUTER_API_KEY is not set`. Save as `cli-missing-key/result.json`.
- **Missing key, TypeSafe named.** Run
  `TYPESAFE_API_KEY= OPENROUTER_API_KEY= JEV_PROVIDER=typesafe control-jev-browse cli -- --url https://example.com --goal "stop"`.
  Exit code `1`. Stdout `error` contains `TYPESAFE_API_KEY is not set`.
  Save as `cli-missing-key/typesafe-named.json`.
- **Proof.** The artifacts show exit `1` and the set-key strings. Do not retry
  with a fake key.

## Gotchas

- Exit `1` with the set-key message is the in-band success proof for this
  feature; do not treat it as a product regression.
- The CLI reloads the repo `.env`, so `env -u TYPESAFE_API_KEY` lets a key in
  `.env` come back. Assign both keys empty as in the command above.
- Leaving `OPENROUTER_API_KEY` set sends the run to OpenRouter instead of
  failing; see [Jev provider](./jev-provider.md). With both keys unset the
  default provider is OpenRouter, so the un-pinned message names its key.
- This does not prove fixture or live browsing.
