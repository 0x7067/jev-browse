# jev-browse

A browser agent where [TypeSafe Jev](https://docs.typesafe.ai) drives — it picks
the operation and target each step instead of judging a trajectory someone else
produced. TypeScript port of the `jev-ultrafast` Python reference, with two
interchangeable browser engines and adapters for Pi, Claude Code, OpenCode,
Codex, and any MCP-capable harness.

```
page → element table → operation            one systemOne request
                     │ click_target        ─┐
                     │ type_text_target     │ speculative heads
                     │ select_target       ─┘
                         └─ only the chosen operation's head executes
```

Each observe extracts an indexed table of visible elements. The model chooses
one operation and one index per step — it never emits selectors, coordinates,
or code, so it can't hallucinate a target. `TYPE_TEXT` delegates the string to
a small OpenAI-compatible helper model; every other decision is a Jev choice.

## Operations

`CLICK`, `TYPE_TEXT`, `SELECT`, `SCROLL_UP`, `SCROLL_DOWN`, `WAIT`, `DONE`,
`BLOCKED` (the reference set) plus `HOVER`, `GO_BACK`, `GO_FORWARD`, and
`PRESS_*` for Enter, Tab, Escape, Backspace, Delete, the arrows, Home, End,
PageUp/PageDown, and Space — real `Input.dispatchKeyEvent` events, so command
palettes and Enter-to-submit forms work.

The extractor reads through open shadow roots and same-origin iframes
(accumulating coordinate offsets so hits land correctly), and indexes input
types a pure role-mapping would miss: `password`, `date`, `time`, `range`,
`file`. Date fields are typed key-by-key because `insertText` can't drive
them; `file` inputs are filled through `DOM.setFileInputFiles`, never clicked
(that would open a native dialog). Tabs opened mid-run are adopted
automatically on the cdp engine, so `target=_blank` flows continue.

Verified coverage: `fixture-interactions.html` scores 15/16 — one fixture
section per interaction class. The remaining gap is range sliders: a click
would set the value, but the model tends to press arrow keys without focusing
the slider first.

## Install

Requires Node ≥22 and Chrome. Clone, then:

```bash
npm install
node scripts/install.mjs          # pi + claude + opencode + codex
node scripts/install.mjs pi       # or one target
```

The installer esbuild-bundles every entry point into `~/.jev-browse/install/`
— a standalone copy that shares nothing with this repo except its shape — and
wires each harness:

| Harness | What it registers |
| --- | --- |
| Pi | `pi install ~/.jev-browse/install` — package with the `jev_browse` tool + skill |
| Claude Code | `claude --plugin-dir ~/.jev-browse/install`, or add to a marketplace for persistence |
| OpenCode | `opencode mcp add jev` → `node ~/.jev-browse/install/src/mcp.ts` (OpenCode v2 has no plugin-tool API, so MCP it is) |
| Codex | `jev-browse` entry in `~/.agents/plugins/marketplace.json` + enabled in `~/.codex/config.toml` |

Re-running the installer is idempotent and purges stale paths. To remove
everything: `node scripts/install.mjs clean`.

## Configure

```bash
TYPESAFE_API_KEY=...        # required — console.typesafe.ai/settings/keys
TYPESAFE_MODEL=jev-latest   # default
TEXT_MODEL_API_KEY=...      # required for TYPE_TEXT
TEXT_MODEL_BASE_URL=...     # OpenAI-compatible endpoint
TEXT_MODEL=...              # e.g. inception/mercury-2.5 on OpenRouter
TEXT_MODEL_REASONING=none   # some helper models reject the reasoning field
```

Keys resolve from the environment, then `.env` at the package root or the
current directory (see `.env.example`). The installed bundles also read
`~/.jev-browse/install/.env` (CLI/MCP) and `~/.jev-browse/install/integrations/.env`
(pi extension) — useful for GUI-spawned MCP servers that don't inherit a
login shell.

## Use it

CLI:

```bash
npm run build   # once — tsc -> dist/ (or run src/ directly on Node ≥22.18)

node dist/cli.js --url https://example.com \
  --goal "Find the pricing page and report the tiers" \
  [--engine cdp|agent-browser] [--headed] [--cdp http://localhost:9222] \
  [--max-steps 60] [--allow-file-urls]
```

Step events stream to stderr as JSONL; stdout carries only the final result
JSON. Exit 0 on `done`, 2 on `blocked`, 1 on error.

MCP (what the harnesses use): `node src/mcp.ts` on stdio, exposes `jev_browse`.

Only `http(s)` start URLs are accepted — page text flows to external model
APIs, so `file://` would be an exfiltration path. Tests and fixtures opt in
with `--allow-file-urls` or `JEV_ALLOW_FILE_URLS=1`.

## Engines

| | `cdp` (default) | `agent-browser` |
| --- | --- | --- |
| Transport | Minimal CDP client over a browser WebSocket | `agent-browser` CLI subprocesses |
| Browser | Launches Chrome, persistent `~/.jev-browse/profile`, or `--cdp` attach | Managed session, `~/.jev-browse/agent-browser-profile` |
| Input | `Input.dispatchMouseEvent`/`insertText`/key events — the reference sequence | CLI click/fill/select/hover on tagged `data-jev-node` elements |
| Deps | Chrome only | agent-browser binary |

Both implement `BrowserDriver` (`observe / fresh / act / close`) over the same
`snapshot.js`, action space, and freshness guards. `cdp` is the default
because it won the head-to-head — same decisions, fewer wrong final states —
and because it's the only engine that pierces iframes and shadow DOM: CSS
selectors can't cross those boundaries, so the agent-browser engine filters
pierced actions out of the table rather than offer dead targets.

Runs serialize on a `~/.jev-browse/run.lock` pid lock — concurrent invocations
fail fast instead of fighting over Chrome's SingletonLock.

## Reference semantics kept

- `snapshot.js` semantics verbatim: 6000-char visible-text cap, ≤250 action
  candidates, WeakMap node identity, per-node guards, page marker.
- Freshness: full marker compare for fill/wait/scroll/DONE; a scoped guard
  (document + URL + form values + target context) for click/select.
- Mutations never retry. Execution is logged before the post-action
  observation. Select evaluation failures are fatal, not stale.
- `TYPE_TEXT` values are cached only while the helper input is identical, and
  discarded after a successful mutation.
- Budgets: `MAX_STEPS` actions (default 60), `2×` model calls, three
  consecutive no-change non-wait actions → `blocked`.

## Limits

`DONE` is a claim, not proof — the model can assert a goal it didn't reach
(measured on Enter-only palettes). Verify outcomes independently.

Cross-origin iframes and closed shadow roots stay opaque — that's DOM, not
us. There's no in-page address bar, so start on the right site (Google
Flights, not google.com). No purchase or credential guardrail exists in code;
the instruction text asks the model to behave and nothing enforces it. Scope
goals accordingly.

## License

MIT — see [LICENSE](LICENSE).
