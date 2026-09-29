![jev-browse · a browser agent driven by TypeSafe Jev](docs/banner.svg)

# jev-browse

jev-browse is a TypeScript browser agent. You give it one goal and a start URL.
On every step, [TypeSafe's Jev](https://docs.typesafe.ai) picks an operation
and an element from a numbered list of what's on the page. A small LLM only
comes in when the operation is `TYPE_TEXT`, to write the text. It ships with
two browser engines and installs on Pi, Claude Code, Codex, and any MCP client.

Here it searches Google Flights for one-way flights from Zürich to London. The
video plays at real speed. The bar at the bottom shows each action as it runs.

[![jev-browse searching Google Flights at 1× speed, with each action captioned](docs/demo.gif)](docs/demo.mp4)

[MP4](docs/demo.mp4) · [The run loop](src/agent.ts) · [The recorder](scripts/record_demo.mjs)

## How it picks an action

Each observation builds a fresh element table:

```
[1] button    Change ticket type · Round trip
[2] combobox  Where from?        · San Francisco
[3] combobox  Where to?          · empty
[4] textbox   Departure          · empty
...
```

The operations are `CLICK`, `DOUBLE_CLICK`, `TYPE_TEXT`, `SELECT`, `SCROLL_UP`, `SCROLL_DOWN`,
`WAIT`, `DONE`, and `BLOCKED`. There are also `HOVER`, `CONTEXT_CLICK`, `DRAG`,
`GO_BACK`, `GO_FORWARD`, and `PRESS_*` for Enter, Tab, Escape, Backspace,
Delete, the arrows, Home, End, PageUp, PageDown, and Space. Key presses are
real key events, so command palettes and Enter-to-submit forms work.

```
                      one Jev request
                     ┌───────────────────────────┐
page → element table → operation                 │
                     │ click_target              │
                     │ type_text_target          │
                     │ select_target, if present │
                     └─────────────┬─────────────┘
                         use the matching target
                                   │
                    CLICK [7] ─────┤──→ browser
                TYPE_TEXT [3] ─────┘
                          ↓
                   small LLM → text → browser
```

Jev answers every target question in the same request as the operation. Only
the target that matches the operation runs: if it says `CLICK`, the agent uses
`click_target` and ignores the rest. That puts both decisions in one network
round trip. The model picks a row number from the table and never writes
selectors, coordinates, or code, so every target it can name exists on the
page.

The extractor reads through open shadow roots and same-origin iframes. It adds
up each frame's offset so clicks land on the right pixel. It also indexes
input types that a plain role mapping misses: `password`, `date`, `time`,
`range`, and `file`. Date fields get typed key by key, because `insertText`
can't fill them. File inputs are filled with `DOM.setFileInputFiles` and never
clicked. When a click opens a new tab, the agent switches to it, so
`target=_blank` flows keep going.

## Install

You need Node 22 or later and Chrome. The repo root is an
[Agent Plugins](https://agent-plugins.org/) package (`plugin.json`, `mcp.json`,
`skills/`), so each harness installs it the usual way:

| Harness | Install |
| --- | --- |
| Pi | `pi install git:github.com/0x7067/jev-browse` (registers the `jev_browse` tool and skill) |
| Claude Code | `claude plugin marketplace add 0x7067/jev-browse`, then `claude plugin install jev-browse@jev-browse` |
| Codex / ChatGPT | `codex plugin marketplace add 0x7067/jev-browse`, then `codex plugin install jev-browse` |
| OpenCode | `opencode mcp add jev --global -- npx -y -p github:0x7067/jev-browse jev-browse-mcp` |
| Any MCP client | stdio command `npx -y -p github:0x7067/jev-browse jev-browse-mcp` |
| CLI only | `npm install -g github:0x7067/jev-browse`, or `npx -y -p github:0x7067/jev-browse jev-browse` |

Every install above runs `bundled/`, a committed esbuild bundle with the SDK
inlined. There's no `npm install`, no build step, and no `node_modules` on the
installing machine.

### Configure

```bash
JEV_PROVIDER=...            # typesafe or openrouter; default picks the provider whose key is set
TYPESAFE_API_KEY=...        # typesafe provider — console.typesafe.ai/settings/keys
OPENROUTER_API_KEY=...      # openrouter provider — openrouter.ai/settings/keys
TYPESAFE_MODEL=jev-latest   # default
TEXT_MODEL_API_KEY=...      # required for TYPE_TEXT
TEXT_MODEL_BASE_URL=...     # OpenAI-compatible endpoint
TEXT_MODEL=...              # e.g. inception/mercury-2.5 on OpenRouter
JEV_AB_PROFILE=...          # optional — agent-browser engine profile dir (default ~/.jev-browse/agent-browser-profile)
```

Keys are read from the environment first. Then come `.env` in the package
root, the client's plugin-data directory (`PLUGIN_DATA` or
`CLAUDE_PLUGIN_DATA`), and `.env` in the current directory. The plugin-data
path is there for MCP servers that a GUI app starts, since those don't inherit
a login shell. `.env.example` lists every variable.

## Run it

```bash
jev-browse --url https://www.google.com/travel/flights?hl=en \
  --goal "Find one-way flights from Zurich to London on December 26, 2026, \
for one adult in economy. Stop when matching flight options are visible." \
  [--engine cdp|agent-browser] [--headed] [--cdp http://localhost:9222] \
  [--max-steps 60] [--allow-file-urls]
```

Step events stream to stderr as JSONL. Stdout carries only the final result
JSON. The exit code is 0 on `done`, 2 on `blocked`, and 1 on error.

Harnesses talk to the MCP server instead. It runs `node bundled/mcp.mjs` on
stdio and exposes one tool, `jev_browse`; `mcp.json` points at
`${PLUGIN_ROOT}/bundled/mcp.mjs`. For local work, run from source with
`npm run run`, or rebuild `bundled/` with `npm run compile` (see Development).

Start URLs must be `http` or `https`. Page text goes to outside model APIs, so
a `file://` start URL would leak local files. Tests and fixtures opt in with
`--allow-file-urls` or `JEV_ALLOW_FILE_URLS=1`.

## What happens on each step

Each decision costs one Jev request. The operation and the target questions
see the same page state. Jev also predicts the usual next move: pick the
autocomplete suggestion after typing, press Enter to submit, or call the goal
done. If the page after the action matches that prediction, the agent runs the
follow-up without asking Jev again. That's the `FOLLOW_UP` caption in the demo.
Nothing in the loop looks at screenshots. Jev reads structured page state, and
the demo video comes from a separate CDP screencast.

The agent reads the page once per step. `snapshot.js` collects visible
controls, their names and values, and the page text in one browser call. It
keeps references to the real DOM nodes. Where the platform provides a signal,
the snapshot uses it:

- ARIA IDL reflection: `ariaCurrent`, `ariaModal`, `ariaLive`, `ariaRequired`
- `computedRole()` and `computedName()`, when the browser ships them
- the HTML-AAM implicit role mappings for tags
- native `<dialog>` and visible ARIA modal dialogs
- `rel` and `href` tokens on links, copied verbatim

A heuristic is left only where no standard signal exists.
[docs/standards.md](docs/standards.md) lists each one with its reason.

Before acting, the agent checks that the page hasn't changed since it looked.
Fill, wait, scroll, and `DONE` compare the whole page marker. Click and select
use a narrower check: the document, the URL, form values, and the area around
the target. If a select fails to evaluate, the run stops with an error rather
than retrying. The checks ignore noise. A ticking clock, a counter, or a
framework re-render that swaps every node doesn't count as a new page. The
compare covers document identity, URL, title, page text with digits
normalized, controls, and form state. If a node was swapped out, the agent
finds it again once by root, role, and name.

Actions that change the page never retry. The agent logs each action before it
observes the result. It caches `TYPE_TEXT` values only while the text helper's
input stays identical, and drops them after a successful change. There is one
exception. Sometimes trusted `Input.dispatch*` events never reach the page,
for example when a canceled navigation kills the renderer's input pipeline.
Then a click or hover retries once through events fired inside the page before
it counts as a strike.

Runs have limits. The run ends `blocked` after `--max-steps` actions (default
60; `max_steps` in the MCP tool), after twice that many model calls, or after
three non-wait actions in a row that change nothing. Other fuses catch loops,
repeated page states, and 10 seconds without progress. Each browser profile
has one run lock under `~/.jev-browse/`. A second run on the same profile
waits up to 30 seconds, then fails, instead of fighting over Chrome's
SingletonLock.

Running as root weakens one default. Chrome refuses to start as uid 0 without
`--no-sandbox`, so jev-browse adds that flag and says so on stderr. Renderer
sandboxing is then off. To keep it, attach to a Chrome running as a normal
user with `--cdp` or `JEV_CDP_URL`. `JEV_CHROME_ARGS` adds your own Chrome
flags, split like a shell would: quotes group words, `\` escapes.

## Engines

| | `cdp` (default) | `agent-browser` |
| --- | --- | --- |
| Transport | Minimal CDP client over a browser WebSocket | `agent-browser` CLI subprocesses |
| Browser | Launches Chrome with a persistent `~/.jev-browse/profile`, or attaches with `--cdp` | Managed session, `~/.jev-browse/agent-browser-profile` |
| Input | `Input.dispatchMouseEvent`/`insertText`/key events | CLI click/fill/select/hover on tagged `data-jev-node` elements |
| Deps | Chrome only | agent-browser binary |

Both engines implement `BrowserDriver` (`observe / fresh / act / close`) on
top of the same `snapshot.js`, action space, and freshness checks. `cdp` remains
the default. Both engines follow new tabs and expose explicit tab switching.
Field-value generation retains observed page history for cross-page tasks.
Agent-browser uses validated native mouse/keyboard input for click,
hover, and text entry inside open shadow roots and accessible same-origin frames,
and native select values with input/change events. Nested frame and shadow form
fixtures cover these paths. Cross-origin frame contents remain inaccessible to
the shared DOM snapshot. File uploads across shadow/frame boundaries are not yet
verified; ordinary top-level upload behavior is unchanged.

## Code map

Every implementation file stays under 500 lines. `npm run lint` enforces that
with oxlint's `max-lines` rule.

| File | Job |
| --- | --- |
| [src/agent.ts](src/agent.ts) | Run loop, state bag, result assembly |
| [src/agent/steps.ts](src/agent/steps.ts) | The phase machine: observe, decide, act, settle |
| [src/agent/consults.ts](src/agent/consults.ts) | DONE confirmation, blocked probes, repair consults |
| [src/agent/fuses.ts](src/agent/fuses.ts) | No-progress fuses: cycles, revisits, idle streaks |
| [src/agent/followup.ts](src/agent/followup.ts) | Predicted follow-ups and toggle detection |
| [src/agent/observe.ts](src/agent/observe.ts) | First-observation settle and state summary |
| [src/snapshot/](src/snapshot/) → [src/snapshot.js](src/snapshot.js) | Ordered fragments joined into the injected snapshot |
| [src/model/decide.ts](src/model/decide.ts) | Operation and target questions, and the decision request |
| [src/model/space.ts](src/model/space.ts) | The numbered action space |
| [src/model/text.ts](src/model/text.ts) | Text-helper handoff for `TYPE_TEXT` |
| [src/model/endpoints.ts](src/model/endpoints.ts) | Model endpoint warm-up |
| [src/questions.ts](src/questions.ts) | Model instructions |
| [src/cdp/browser.ts](src/cdp/browser.ts) | Session shell: attach, observe, tab adoption |
| [src/cdp/input.ts](src/cdp/input.ts) | Trusted input and DOM-event fallbacks |
| [src/cdp/events.ts](src/cdp/events.ts) | Network, navigation, dialog, and download events |
| [src/cdp/fresh.ts](src/cdp/fresh.ts) | Freshness checks and settle over the shared marker contract |
| [src/cdp/launch.ts](src/cdp/launch.ts) | Chrome spawn and WebSocket URL lookup |
| [src/cdp/socket.ts](src/cdp/socket.ts) | Minimal CDP client over a browser WebSocket |
| [src/cdp/chrome.ts](src/cdp/chrome.ts) | Chrome and Chromium discovery |
| [src/abrowser.ts](src/abrowser.ts) | agent-browser engine behind the same driver interface |
| [src/cli.ts](src/cli.ts) | Headless entry point that every adapter runs |
| [src/mcp.ts](src/mcp.ts) | stdio MCP server exposing `jev_browse` |
| [integrations/pi](integrations/pi/index.ts) | Pi extension: `jev_browse` tool and skill |
| [bundled](bundled/) | Committed esbuild bundles; installs run these |
| [plugin.json](plugin.json) · [mcp.json](mcp.json) | Agent Plugins manifest and MCP wiring |
| [scripts/eval.mjs](scripts/eval.mjs) + [evals/](evals/) | Real-world task suite and results |
| [scripts/record_demo.mjs](scripts/record_demo.mjs) | CDP screencast recorder behind `docs/demo.*` |

## Evidence and limits

The demo is a 14,586 ms run with 11 actions. The clock starts after
the first page observation. It includes model calls, generated text, browser
work, and loading waits. The run ends on a results page for one-way flights
from Zürich to London on Saturday, December 26, 2026, with fares in CHF. The
video plays at 1×, timed from CDP frame timestamps, and holds the last frame
for 2.5 seconds.

Coverage comes from [`fixture-interactions.html`](fixture-interactions.html)
and a [real-world task suite](evals/). The suite covers form flows,
autocomplete, iframes and framesets, shadow roots, hover menus, native
selects, date pickers, file upload, dynamic loading, modals, multi-tab flows,
infinite scroll, drag and drop, context menus, and invisible (`opacity:0`)
custom controls. It also runs multi-step logged-in flows, such as ParaBank
transfers and full saucedemo checkouts. Range sliders work by focusing the
slider and pressing arrow keys. Each suite run is checked against the final
URL, the page text, or the actions it ran. Tasks with nothing to check are
reported separately. [evals/](evals/) has the details.

`DONE` is the model's claim, and the model can be wrong. It has claimed goals
it didn't reach; we measured this on command palettes that only accept Enter.
Check outcomes yourself. Cross-origin iframes and closed shadow roots stay
opaque, because the DOM doesn't expose them. There's no address bar in the
action space, so start on the right site: Google Flights, not google.com.
Nothing in the code stops purchases or credential entry. The instructions ask
the model to behave, and nothing enforces it, so scope goals with that in mind.

## Development

```bash
git clone https://github.com/0x7067/jev-browse && cd jev-browse
npm install          # dev tooling (typescript, esbuild, oxlint)
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint, the 500-line cap, and the no-comments check
npm run compile      # joins src/snapshot/ into src/snapshot.js, then tsc -> dist/ and bundled/
npm run check:bundle # rebuilds bundled/ and fails if it differs from the commit
npm run run -- --url ... --goal ...   # tsx src/cli.ts, no build step
```

Run `npm run compile` before you commit a change to `src/`, and commit the
rebuilt `bundled/` with it. Installed copies run only `bundled/`.
`check:bundle` works as a pre-commit gate.

The build script is named `compile`, not `build`. npm runs install-time
preparation for git dependencies when a script called `build`, `install`,
`prepare`, or similar exists, and that breaks `npx -p github:...` installs.

Record the demo with:

```bash
node scripts/record_demo.mjs --url "https://www.google.com/travel/flights?hl=en&curr=CHF" \
  --goal "Find one-way flights from Zurich to London on {{DATE+90d}}, \
for one adult in economy. Stop when matching flight options are visible."
```

The recorder starts a headless Chrome on a free port and attaches the agent to
it with `--cdp`. It captures a screencast, then captions each step from the
stderr events. It writes `docs/demo.mp4` and `docs/demo.gif` at 1×. Live runs
make paid API calls.

`{{DATE+Nd}}` in a goal becomes the date N days after the recording day. The
summary JSON prints the resolved goal. Don't hard-code the date. Once it's in
the past, Google Flights greys it out, the task can't be done, and the run
ends in a false `DONE` on the calendar instead of on a results page.

## License

MIT. See [LICENSE](LICENSE).

### Diagnostic traces and completion evidence

Use `--trace FILE` (or `JEV_TRACE_FILE`) to write a local JSONL trace. The path
must be new; traces are created with owner-only permissions and are not
uploaded. They contain page text, DOM target details, model inputs and outputs,
and may include typed values. Keep them with the run evidence.

```bash
node bundled/cli.mjs --url https://example.com --goal 'Read the page' \
  --trace evals/results/read-example.jsonl
node scripts/trace-summary.mjs evals/results/read-example.jsonl
node scripts/eval.mjs --tasks fx-quiz-setup,fx-guide-anchor --trace
```

Both engines record observations, decisions, attempted actions, DOM fallback
attempts, completion checks, and fatal snapshots. CDP traces additionally record
request/session IDs, method timing, navigation and request failures. Evaluations
are labeled `observe`, `freshness`, `settle`, `after_input`, or `input`. Page-side
execution and dispatch timing distinguish expensive evaluation from renderer
scheduling delays. A call still pending after five seconds triggers one
`Browser.getVersion` liveness probe; the normal 30-second call timeout remains.
An error names the stalled method, purpose, session, and call ID.

Every DONE claim, including a predicted DONE_AFTER, now checks its outcome on a
fresh observation. Default goal tracking keeps the initial observation and seven
recent observations, with bounded text and control summaries. Decisions assess
whether the goal is already satisfied before executing another action. A satisfied
assessment triggers the completion check even when the proposed action is not DONE.

The completion review distinguishes satisfied, incomplete, and uncertain outcomes
and checks the evidence basis: current state, observed history, or an action the
user explicitly requested as the stopping boundary. It supports already-satisfied
goals and intermediate outcomes that disappear after navigation. Rejected reviews
stay in subsequent decision context; uncertainty calls for inspection, not blind
repetition of an irreversible action. No regex or fixed success banner is required.
`goal_assessment` in the result records the latest completion review; traces retain
the supporting observation history. These are model judgments, not independent
proofs. Bounded history can omit evidence, and both model assessments can be wrong. Two rejected claims on the same
observation end as `blocked/completion_unverified`.

For a known outcome, supply `--expect` with a nonempty JSON object of regexes:
`url_match`, `text_match`, `state_match`, and/or `frames_match`. Every supplied
condition must match before DONE is accepted. These conditions replace the model
completion judgment, so include all outcomes that matter. They do not constrain
which actions the agent can take. For example:

```bash
node bundled/cli.mjs --url https://example.com --goal 'Read the example page' \
  --expect '{"text_match":"Example Domain"}'
```

`--stop-at-challenge` stops as `blocked/verification_required` when visible
verification is detected. Goals explicitly saying to stop at a challenge or not
to interact with verification also enable this behavior. Hidden widget markup
does not count as visible verification. Results include `challenge_reasons`.
MCP callers can supply the equivalent `expect` and `stop_at_challenge` arguments.

`final_frames` reports each visible iframe/frame's declared source, readable
current document URL and ready state, accessibility, observed load event, and
nearest `data-loaded` or `data-ready` attribute. `load_event: unknown` means the
observer did not see a load event; it does not mean the frame failed. An
inaccessible document remains unknown. A page-provided readiness attribute is
reported as evidence from that page, not proof of embedded application behavior.

Completion stability compares semantic controls, text, URLs, readiness, and
challenge evidence. It ignores CSS class-name hints such as a temporary `copied`
class; action freshness continues to compare those hints before dispatch.
Explicit completion conditions remain in every decision prompt until satisfied.

Settling measures the quiet period with Node's clock and polls the page's mutation
revision. Page timer throttling cannot prolong the scheduled wait; an unresponsive
CDP call remains subject to the separate protocol timeout. Run
`node scripts/check-settle-budget.mjs` to check quiet and continuously mutating
pages with deliberately delayed page timers.

Double-click uses two native click pairs with CDP. Agent-browser dispatches
the corresponding pointer/mouse events and `dblclick` in the target document;
these synthetic events have `isTrusted=false`. Its installed `dblclick` command
emitted only one click event in verification, so it is not used.

Answer delivery uses a separate review call. With an OpenRouter text endpoint,
`ANSWER_REVIEW_MODEL` defaults to `anthropic/claude-opus-5.5`; other text endpoints use
`TEXT_MODEL`. Set `ANSWER_REVIEW_MODEL` to override it. Jev still selects browser
actions and determines whether a written answer is requested. Action-only goals
do not require text-model credentials. Review calls add latency and cost.
If answer generation returns empty or malformed content, its second attempt uses
the configured answer-review model. Valid null answers, refusals, and unsupported
claims do not trigger this fallback. Generated answers still require evidence
review, and traces record the actual models and reported usage.
