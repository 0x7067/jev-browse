# File URL gate

jev-browse refuses `file://` start URLs unless the caller opts in with
`--allow-file-urls` or `JEV_ALLOW_FILE_URLS=1`, because page text flows to
external model APIs. Without the opt-in, the CLI exits `1` and returns a
`RunResult` whose `error` states that only http(s) pages are driven.

## Sub-features

- `file-url-denied` refuses `file://` without `--allow-file-urls` (exit `1`).
- `file-url-allow-reaches-auth` with `--allow-file-urls` passes the scheme check
  and fails next on missing `TYPESAFE_API_KEY` when no key is set (still in-band).

## How to get to it (user POV)

- Run `jev-browse --url file:///... --goal "..."` from a shell or harness.
- Run `node bundled/cli.mjs` with the same flags (installed users get the
  bundled entry via the `jev-browse` bin).
- Eval `file_url` tasks set `JEV_ALLOW_FILE_URLS=1` for fixtures; production
  callers must not.

## Driving it with control-jev-browse

Preconditions:

- `control-jev-browse doctor` reports `doctor=ok` for this run.
- Disposable verify home is set by `control-jev-browse launch`.
- `eval "$(control-jev-browse env)"` if the recipe needs exported run vars.
- `TYPESAFE_API_KEY` may be unset.

- **Denied.** Run
  `control-jev-browse cli -- --url "file://$PWD/fixture-interactions.html" --goal "stop"`.
  Exit code `1`. Stdout JSON `status` is `error` and `error` contains
  `only drives http(s) pages`. Save stdout as `file-url-gate/denied.json`.
- **Allow reaches auth.** Run
  `control-jev-browse cli -- --allow-file-urls --url "file://$PWD/fixture-interactions.html" --goal "stop"`
  with `TYPESAFE_API_KEY` unset. Exit code `1`. Stdout `error` contains
  `TYPESAFE_API_KEY is not set`. Save stdout as `file-url-gate/allow-nokey.json`.
- **Proof.** Both artifacts show the exit and error strings above. Do not launch
  a headed browser for this feature.

## Gotchas

- Eval fixture tasks always opt in to `file://`; they do not prove the deny path.
- A missing key after `--allow-file-urls` is not a file-URL gate failure — it is
  the next gate. Keep the two artifacts separate.
- Do not use a live http(s) URL when proving this feature.
