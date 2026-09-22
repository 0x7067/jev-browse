# CLI missing key

Without `TYPESAFE_API_KEY`, jev-browse cannot call Jev. The CLI returns a
`RunResult` with `status` `error` and an `error` message that tells the user
to set the key, and exits `1`.

## Sub-features

- `cli-missing-key` exits `1` with `TYPESAFE_API_KEY is not set` on an http(s) URL.
- `cli-missing-key-after-file-allow` is the same message after `--allow-file-urls`
  passes the scheme check (see also file-url-gate).

## How to get to it (user POV)

- Run `jev-browse --url https://example.com --goal "..."` with the key unset.
- Run the same via `node bundled/cli.mjs`.

## Driving it with control-jev-browse

Preconditions:

- `control-jev-browse doctor` reports `doctor=ok` for this run.
- `TYPESAFE_API_KEY` is unset for this drive (in-band).
- `eval "$(control-jev-browse env)"`.

- **Missing key.** Run
  `control-jev-browse cli -- --url https://example.com --goal "stop"`.
  Exit code `1`. Stdout JSON `status` is `error` and `error` contains
  `TYPESAFE_API_KEY is not set`. Save as `cli-missing-key/result.json`.
- **Proof.** The artifact shows exit `1` and the set-key string. Do not retry
  with a fake key.

## Gotchas

- Exit `1` with the set-key message is the in-band success proof for this
  feature; do not treat it as a product regression.
- Loading a repo `.env` that sets the key will skip this path — unset the var
  for the drive (`env -u TYPESAFE_API_KEY control-jev-browse cli -- ...`).
- This does not prove fixture or live browsing.
