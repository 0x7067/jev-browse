# drive — Jev as the browser driver

A reusable browser agent where [TypeSafe Jev](https://docs.typesafe.ai) is the
**driver**, not a judge. TypeScript port of `jev-ultrafast` (kept in
`../jev-ultrafast/` as the reference) with two interchangeable browser engines
and thin adapters for Pi, Claude Code, OpenCode, and any MCP-capable harness.

```
page → element table → operation            one systemOne request
                     │ click_target        ─┐
                     │ type_text_target     │ speculative heads
                     │ select_target       ─┘
                         └─ only the chosen operation's head executes
```

One index per DOM node, per-operation target heads, code-owned element
identity — the model never emits selectors or code. `TYPE_TEXT` delegates the
string to a small OpenAI-compatible helper; everything else is Jev choices.

## Engines

| | `cdp` (default) | `agent-browser` |
| --- | --- | --- |
| Transport | Minimal CDP client, built-in WebSocket | `agent-browser` CLI subprocesses |
| Browser | Launches Chrome (`--headless=new`, persistent `~/.jev-drive/profile`) or `--cdp http://host:9222` attach | Managed session, dedicated `~/.jev-drive/agent-browser-profile` |
| Input | `Input.dispatchMouseEvent`/`insertText` (trusted) — exact reference sequence | agent-browser click/fill/select on tagged `data-jev-node` elements — delegated, close but not identical semantics |
| Deps | Chrome only | agent-browser binary |
| Role | Reference-faithful engine | Alternate engine; useful where agent-browser already manages Chrome |

Both implement `BrowserDriver` (`observe / fresh / act / close`) and share the
same `snapshot.js`, action-space builder, decision call, and freshness guards.
Runs serialize on a `~/.jev-drive/run.lock` pid lock — concurrent invocations
fail fast instead of colliding on Chrome's SingletonLock.

## Build

```bash
cd drive
npm install
npm run build        # tsc -> dist/ (snapshot.js is copied alongside)
```

Node 22+. Credentials: `TYPESAFE_API_KEY` (required), `TEXT_MODEL_API_KEY` +
`TEXT_MODEL_BASE_URL`/`TEXT_MODEL` (required for TYPE_TEXT). Put them in
`drive/.env` or export them; a repo-root `.env` also loads when cwd is the
repo. `TYPESAFE_MODEL` defaults to `jev-latest`.

## CLI (the shared entry point every adapter calls)

```bash
node dist/cli.js --url https://example.com --goal "Find the pricing page and report the tiers" \
  [--engine cdp|agent-browser] [--headed] [--cdp http://localhost:9222] \
  [--max-steps 60] [--allow-file-urls]
```

Only `http(s)` start URLs are accepted by default — page text flows to external
model APIs, so `file://`/`chrome://` would be exfiltration paths. Tests and
local fixtures opt in with `--allow-file-urls` or `JEV_ALLOW_FILE_URLS=1`.

`node src/mcp.ts` also works on Node ≥22.18 (native type stripping), so plugin
installs don't need the build step.

Step events stream to **stderr** as JSONL; the final result JSON is the only
stdout payload. Exit 0 on `done`, 2 on `blocked`, 1 on error.

## Packaging and install

`drive/` is a portable [Agent Plugin](https://agent-plugins.org/): root
`plugin.json` manifest, `mcp.json` (stdio → `node ${PLUGIN_ROOT}/src/mcp.ts`),
and `skills/jev-browse/`. Each harness also gets its native plugin form:

| Harness | Native plugin | Install |
| --- | --- | --- |
| **Pi** | `pi` package manifest in `package.json` (extension + skill) | `pi install /path/to/drive` |
| **Claude Code** | `.claude-plugin/plugin.json` + `.mcp.json` | `claude --plugin-dir /path/to/drive` per session, or marketplace install |
| **OpenCode** | `Plugin` hooks module exposing `jev_browse` | stub into `~/.config/opencode/plugin/` (installer writes it) |
| **Codex** | portable `plugin.json` + `mcp.json` + `skills/` (Codex ≥0.117 reads the Agent Plugins format natively) | personal marketplace entry in `~/.agents/plugins/marketplace.json` (installer writes it) |

`scripts/install.mjs` performs all four installs (idempotent):

```bash
node scripts/install.mjs        # all four
node scripts/install.mjs pi     # or one target
```

The Codex/OpenCode paths bake in absolute paths — moving this repo means
re-running the installer.

## Semantics preserved from the reference

- `snapshot.js` is verbatim: visible-text cap 6000 chars, ≤250 action
  candidates, WeakMap node identity, per-node guards, page marker.
- Freshness: full marker compare for fill/wait/scroll/DONE; scoped guard
  (document + URL + form values + target context) for click/select.
- Mutations are never retried; execution is logged before the post-action
  observation. Select evaluation failures are fatal, not stale.
- `TYPE_TEXT` values are cached only while the entire helper input is
  identical, and discarded after a successful mutation.
- Budgets: `MAX_STEPS` actions (default 60), `2×` model calls; three
  consecutive no-change non-wait actions → `blocked`.
- DONE is a claim, not proof — verify outcomes independently.

## Boundaries

In-page only: no address-bar navigation mid-run (pick the start URL), no file
uploads, no multi-tab strategy, no shadow DOM / iframe traversal beyond what
`snapshot.js` sees. The `agent-browser` engine additionally depends on that
CLI's actionability checks for click/fill and its snapshot timing after
mutations; in head-to-head runs it reached wrong final states more often than
the CDP engine, which is why `cdp` is the default.

There is no purchase/credential guardrail in code — the instruction text asks
the model to behave; nothing enforces it. Scope goals and verify outcomes.
