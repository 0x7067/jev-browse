![jev-browse · a browser agent driven by TypeSafe Jev](docs/banner.svg)

# jev-browse

**A browser agent with a dynamic, indexed action space, written in TypeScript.**

Give it one goal. [TypeSafe's Jev](https://docs.typesafe.ai) picks an operation
and an element. A small LLM writes text only when the operation is
`TYPE_TEXT`. Two interchangeable browser engines ship with it, and it installs
on Pi, Claude Code, Codex, and any MCP-capable harness.

**Zürich to London on Google Flights in 10.2 seconds.** One natural-language
goal, generated city names, calendar clicks, and loading waits included.

[![A real Google Flights search at 1× speed: typed cities, clicked calendar, verified results page](docs/demo.gif)](docs/demo.mp4)

[Watch the MP4](docs/demo.mp4) · [Read the loop](src/agent.ts) · [Recorded with](scripts/record_demo.mjs)

## The action space

Every observation produces a new element table:

```
[1] button    Change ticket type · Round trip
[2] combobox  Where from?        · San Francisco
[3] combobox  Where to?          · empty
[4] textbox   Departure          · empty
...
```

The operations are `CLICK`, `TYPE_TEXT`, `SELECT`, `SCROLL_UP`, `SCROLL_DOWN`,
`WAIT`, `DONE`, and `BLOCKED`, plus `HOVER`, `CONTEXT_CLICK`, `DRAG`,
`GO_BACK`, `GO_FORWARD`, and `PRESS_*` for Enter, Tab, Escape, Backspace,
Delete, the arrows, Home, End, PageUp/PageDown, and Space. These are real
key events, so command palettes and Enter-to-submit forms work.

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

The target questions are speculative. If the operation comes back `CLICK`,
only `click_target` can execute. Two decisions, one network round trip. The
model never emits selectors, coordinates, or code, so it can't hallucinate a
target.

The extractor reads through open shadow roots and same-origin iframes,
accumulating coordinate offsets so hits land correctly, and indexes input
types a pure role-mapping would miss: `password`, `date`, `time`, `range`,
`file`. Date fields are typed key-by-key because `insertText` can't drive
them. File inputs are filled through `DOM.setFileInputFiles`, never clicked.
Tabs opened mid-run are adopted automatically, so `target=_blank` flows
continue.

## Install

You need Node ≥ 22 and Chrome. The repo root is a portable
[Agent Plugins](https://agent-plugins.org/) package (`plugin.json`,
`mcp.json`, `skills/`), so each harness installs it natively:

| Harness | Install |
| --- | --- |
| Pi | `pi install git:github.com/0x7067/jev-browse` (registers the `jev_browse` tool and skill) |
| Claude Code | `claude plugin marketplace add 0x7067/jev-browse`, then `claude plugin install jev-browse@jev-browse` |
| Codex / ChatGPT | `codex plugin marketplace add 0x7067/jev-browse`, then `codex plugin install jev-browse` |
| OpenCode | `opencode mcp add jev --global -- npx -y -p github:0x7067/jev-browse jev-browse-mcp` |
| Any MCP client | stdio command `npx -y -p github:0x7067/jev-browse jev-browse-mcp` |
| CLI only | `npm install -g github:0x7067/jev-browse`, or run it through `npx -y -p github:0x7067/jev-browse jev-browse` |

Every path above runs `bundled/`, a committed esbuild bundle with the SDK
inlined. No `npm install`, no build step, no `node_modules` at the install
site.

### Configure

```bash
TYPESAFE_API_KEY=...        # required — console.typesafe.ai/settings/keys
TYPESAFE_MODEL=jev-latest   # default
TEXT_MODEL_API_KEY=...      # required for TYPE_TEXT
TEXT_MODEL_BASE_URL=...     # OpenAI-compatible endpoint
TEXT_MODEL=...              # e.g. inception/mercury-2.5 on OpenRouter
TEXT_MODEL_REASONING=none   # some helper models reject the reasoning field
```

Keys resolve from the environment first, then `.env` in the package root,
then the client's plugin-data directory (`PLUGIN_DATA` or
`CLAUDE_PLUGIN_DATA`), then the current directory. See `.env.example`. The
plugin-data path covers GUI-spawned MCP servers that don't inherit a login
shell.

## Use it

```bash
jev-browse --url https://www.google.com/travel/flights?hl=en \
  --goal "Find one-way flights from Zurich to London on September 20, 2026, \
for one adult in economy. Stop when matching flight options are visible." \
  [--engine cdp|agent-browser] [--headed] [--cdp http://localhost:9222] \
  [--max-steps 60] [--allow-file-urls]
```

Step events stream to stderr as JSONL. Stdout carries only the final result
JSON. Exit 0 on `done`, 2 on `blocked`, 1 on error.

The harnesses call the MCP server, `node bundled/mcp.mjs` on stdio, which
exposes `jev_browse`. `mcp.json` runs it as `${PLUGIN_ROOT}/bundled/mcp.mjs`.
On Node ≥ 22.18 you can also run `node src/mcp.ts` directly.

Only `http(s)` start URLs are accepted. Page text flows to external model
APIs, so `file://` would be an exfiltration path; tests and fixtures opt in
with `--allow-file-urls` or `JEV_ALLOW_FILE_URLS=1`.

## Why it moves

One request per decision cycle. The operation head and the target heads see
the same observed state, and each decision also predicts its conventional
continuation — the autocomplete pick after typing, Enter to submit, or "this
completes the goal". When the post-action page matches that prediction, the
follow-up executes without a second round trip. Nothing in the loop looks at
screenshots; Jev consumes structured state, and the demo video comes from a
separate CDP screencast.

The page is read once per step. `snapshot.js` pulls visible controls, names,
values, and text in a single browser call, atomically, keeping references to
real DOM nodes.

Then it checks the page hasn't moved under it. Fill, wait, scroll, and `DONE`
get a full marker compare. Click and select get a scoped guard covering the
document, the URL, form values, and the target's context. A select whose
evaluation fails is fatal, not stale. These guards tolerate churn, because a
clock, a counter, or a virtual-DOM re-render that recreates every node is not
a changed page: claims compare document identity, URL, title,
digit-normalized text, controls, and form state, and a swapped node is
re-resolved once by root, role, and name.

Mutations never retry. Execution is logged before the post-action
observation, and `TYPE_TEXT` values are cached only while the helper input is
identical, then discarded after a successful mutation. The one exception is
input that never landed at all: when trusted `Input.dispatch*` events deliver
nothing — a canceled provisional navigation can kill the renderer's input
pipeline — an executed click or hover retries once through in-page event
synthesis before it counts as a strike.

Runs are bounded and serialized. `MAX_STEPS` actions (default 60), twice that
many model calls, or three consecutive no-change non-wait actions ends the run
in `blocked`. A pid lock at `~/.jev-browse/run.lock` fails fast instead of
fighting over Chrome's SingletonLock.

Launching as root is the one place the defaults get weaker. Chrome refuses uid
0 without `--no-sandbox`, so the flag is added for you and printed on stderr:
renderer containment is off. Attach to a non-root Chrome through
`--cdp`/`JEV_CDP_URL` to keep it. `JEV_CHROME_ARGS` appends operator flags,
split shell-style — quotes group, `\` escapes.

## Engines

| | `cdp` (default) | `agent-browser` |
| --- | --- | --- |
| Transport | Minimal CDP client over a browser WebSocket | `agent-browser` CLI subprocesses |
| Browser | Launches Chrome with a persistent `~/.jev-browse/profile`, or attaches with `--cdp` | Managed session, `~/.jev-browse/agent-browser-profile` |
| Input | `Input.dispatchMouseEvent`/`insertText`/key events | CLI click/fill/select/hover on tagged `data-jev-node` elements |
| Deps | Chrome only | agent-browser binary |

Both implement `BrowserDriver` (`observe / fresh / act / close`) over the
same `snapshot.js`, action space, and freshness guards. `cdp` is the default
for two reasons: it won the head-to-head on final states, and it's the only
engine that pierces iframes and shadow DOM. CSS selectors can't cross those
boundaries, so the agent-browser engine filters pierced actions out of the
table rather than offer dead targets.

## Small enough to read

| File | Job |
| --- | --- |
| [src/agent.ts](src/agent.ts) | The complete loop and text-helper handoff |
| [src/snapshot.js](src/snapshot.js) | Atomic DOM snapshot, indexed controls, freshness guards |
| [src/model/decide.ts](src/model/decide.ts) | Dynamic operation/target heads and the decision request |
| [src/model/space.ts](src/model/space.ts) | The indexed action space |
| [src/model/text.ts](src/model/text.ts) | Text-helper handoff for `TYPE_TEXT` |
| [src/model/endpoints.ts](src/model/endpoints.ts) | Model-endpoint warm-up |
| [src/questions.ts](src/questions.ts) | Model instructions |
| [src/cdp/browser.ts](src/cdp/browser.ts) | Chrome launch/attach, trusted input, network tracking |
| [src/cdp/socket.ts](src/cdp/socket.ts) | Minimal CDP client over a browser WebSocket |
| [src/cdp/chrome.ts](src/cdp/chrome.ts) | Chrome/Chromium discovery |
| [src/abrowser.ts](src/abrowser.ts) | agent-browser engine over the same driver interface |
| [src/cli.ts](src/cli.ts) | Headless entry point every adapter runs |
| [src/mcp.ts](src/mcp.ts) | stdio MCP server exposing `jev_browse` |
| [integrations/pi](integrations/pi/index.ts) | Pi extension: `jev_browse` tool + skill |
| [integrations/opencode](integrations/opencode/jev-browse.ts) | OpenCode plugin (dormant; MCP is the install path) |
| [bundled](bundled/) | Committed esbuild bundles; the entry points installs actually run |
| [plugin.json](plugin.json) · [mcp.json](mcp.json) | Portable Agent Plugins manifest and MCP wiring |
| [scripts/eval.mjs](scripts/eval.mjs) + [evals/](evals/) | Real-world task suite and results |
| [scripts/record_demo.mjs](scripts/record_demo.mjs) | CDP screencast recorder behind `docs/demo.*` |

## Evidence and limits

The current video is a **10,209 ms** Google Flights run. Timing starts after
initial page observation and includes model calls, generated text, browser
work, and loading waits. The final frame is a verified results page: one-way
Zürich to London on September 20, 2026, with real fares. The video plays at 1×
from CDP frame timestamps, with a ~0.8 s final hold.

Verified coverage is [`fixture-interactions.html`](fixture-interactions.html)
plus a [real-world task suite](evals/) spanning form flows, autocomplete,
iframes and framesets, shadow roots, hover-reveal menus, native selects, date
pickers, file upload, dynamic loading, modals, multi-tab flows, infinite
scroll, drag-and-drop, context menus, invisible (`opacity:0`) custom controls,
and multi-step authenticated flows like ParaBank transfers and full saucedemo
checkouts. Range sliders work through the focus-then-arrows idiom. Suite runs
are verified by URL, page text, or executed actions; tasks with no checkable
expectation are reported separately. The verification details live in
[evals/](evals/).

A `DONE` choice is a claim, not proof. The model can assert a goal it didn't
reach — measured on Enter-only palettes — so verify outcomes independently.
Cross-origin iframes and closed shadow roots stay opaque; that's the DOM, not
us. There's no in-page address bar, so start on the right site: Google
Flights, not google.com. And no purchase or credential guardrail exists in
code. The instruction text asks the model to behave, and nothing enforces it.
Scope goals accordingly.

## Development

```bash
git clone https://github.com/0x7067/jev-browse && cd jev-browse
npm install          # dev tooling (typescript, esbuild, oxlint)
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint
npm run build        # tsc -> dist/ and rebuilds bundled/
npm run run -- --url ... --goal ...   # tsx src/cli.ts, no build step
```

Rebuild `bundled/` with `npm run build` before committing changes to `src/`;
the bundles are what installed copies execute. `npm run check:bundle`
rebuilds and fails if the committed bundles drifted from `src/` (safe to
run as a pre-commit gate).

`node scripts/record_demo.mjs --url URL --goal "..."` records a run through
the fixed-port `--cdp` attach path and renders `docs/demo.mp4` and
`docs/demo.gif` at 1×. Live runs make paid API calls.

## License

MIT. See [LICENSE](LICENSE).
