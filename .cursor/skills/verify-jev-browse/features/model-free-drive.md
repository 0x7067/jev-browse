# Model-free drive paths

Proving snapshot/act behavior when the TypeSafe account cannot serve
decisions (HTTP 402, missing TYPESAFE_API_KEY). The bundled CLI and
scripts/eval.mjs both die at the first decide call, so use the direct
CdpBrowser probe harness and the CLI's pre-decide observable surface.

## Sub-features

- probe-harness — `scripts/probes/reliability.ts` drives observe() + act()
  against the fixture with no model call.
- headed-probe — a temp probe with `CdpBrowser.open(url, { headed: true })`
  shows the actions in a real window for recordings.
- cli-fatal-snapshot — the CLI still opens Chrome, loads the page, runs
  settleFirstObservation + observe, then dies at decide; the stderr `fatal`
  event carries `url`, `title`, and `elements` (count) as proof the page and
  snapshot pipeline ran through the real bundled binary.
- pending-wait-timing — a hanging-request page proves WAIT blocks on
  `pending_requests`/`pending_nav` (15s budget) instead of a fixed sleep.

## How to get to it (user POV)

There is no user-facing snapshot/observe subcommand; `bundled/cli.mjs`
requires `--goal` and dies at the first decide without working model
credentials. Direct CdpBrowser probes are the only model-free drive path.

## Driving it with control-jev-browse

Preconditions: launch + doctor per features/README.md.

- **Baseline probe**:
  `npx tsx scripts/probes/reliability.ts` — expect a log line containing
  `below-fold actions=N`, `covered-click`, `below-next`, `slow-wait` verdicts.
- **CLI to the decide boundary** (needs only that TYPESAFE_API_KEY is set,
  value may be dead):
  `control-jev-browse cli -- --allow-file-urls --url "file://$JEV_BROWSE_ROOT/fixture-interactions.html" --goal "stop"`.
  With a credit-less key expect stdout RunResult `status:"error"` carrying
  the HTTP 402 text and a stderr `fatal` event with `url`, `title`, and
  `elements` count. Elements is a count, not the action list — use the probe
  for below:true/label proof.
- **Headed probe** (recordings): copy `scripts/probes/reliability.ts` to a
  temp file, pass `{ headed: true }` to `CdpBrowser.open`, add pauses between
  steps. Pace the pauses with `process.once("SIGUSR1", ...)` and `kill -USR1
  <pid>` — non-PTY exec shells cannot feed stdin, so `await stdin` pauses
  deadlock. The fixture's DONE `<output>`s are `position:fixed`, so results
  stay visible regardless of scroll.
- **pending_requests probe**: serve a page that does `fetch('/hang?ms=6000')`
  on DOMContentLoaded; observe while it is in flight shows
  `pending_requests >= 1`, and `act(wait)` returns only after the request
  resolves (elapsed ≈ the delay, not ~1.5s).

## Gotchas

- `elements` in the fatal event is a number (`snap.elements.length`), not the
  array — do not expect labels/flags there.
- The session secret may be named `TYPESAFE_AI_KEY` while the code reads
  `TYPESAFE_API_KEY`; export the mapping or makeClient throws before Chrome
  opens, so nothing is exercised.
- The TypeSafe SDK calls `POST /v1/systemone` — not OpenAI-compatible, so
  OpenRouter keys cannot substitute for the decide model.
- Headed windows open at `--window-position=40,40 --window-size=1120,900`;
  activate/maximize by window id (`wmctrl -i -a <id>`), and click the driven
  tab to the front — the driver's first tab is `about:blank`.
- `pkill -f chrome` is banned; target the launched instance's profile dir
  (`JEV_PROFILE`) or the pid instead.
