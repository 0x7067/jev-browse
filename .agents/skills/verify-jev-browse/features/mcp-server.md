# MCP server

`bundled/mcp.mjs` (bin `jev-browse-mcp`) speaks JSON-RPC over stdio and
exposes one tool, `jev_browse`, which runs the same CLI agent loop and
returns the `RunResult` as tool text. `initialize`, `tools/list`, and
argument validation need no model; an actual `tools/call` drive is
out-of-band.

## Sub-features

- `mcp-initialize` answers `initialize` with `serverInfo.name`
  `jev-browse` and the package version (in-band).
- `mcp-tools-list` lists exactly one tool named `jev_browse` requiring
  `goal` + `url` (in-band).
- `mcp-missing-key` returns a `tools/call` result with `isError: true`
  naming the selected provider's key variable when no key is set (in-band).
- `mcp-drive` a real `tools/call` browses and returns a JSON `RunResult`
  in the tool text (out-of-band, needs a provider key).

## How to get to it (user POV)

- Configure `jev-browse-mcp` as an MCP stdio server (e.g. in `mcp.json`),
  or run `node bundled/mcp.mjs` and write JSON-RPC lines to its stdin.
- Call the `jev_browse` tool with `{url, goal}`; optional `engine`,
  `max_steps`, `expect`, `stop_at_challenge`.

## Driving it with control-jev-browse

Preconditions:

- `control-jev-browse doctor` reports `doctor=ok` for this run.
- `eval "$(control-jev-browse env)"`.
- Pipe requests through `env JEV_PROFILE="$VERIFY_HOME/profile"
  JEV_AB_PROFILE="$VERIFY_HOME/profile" node bundled/mcp.mjs` so the run
  uses this run's profile (there is no `control-jev-browse mcp` wrapper).

- **Handshake.** Pipe three request lines to stdin:
  `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | env JEV_PROFILE="$VERIFY_HOME/profile" JEV_AB_PROFILE="$VERIFY_HOME/profile" node bundled/mcp.mjs`.
  Stdout answers id 1 with `serverInfo.name` `jev-browse` and id 2 with
  `tools[0].name` `jev_browse`. Save stdout as `mcp/handshake.json`.
- **Missing-key call.** Pipe a `tools/call` line with both key vars and
  `JEV_PROVIDER` emptied (assignments, not `env -u` — `loadDotEnv` refills
  unset vars from the repo `.env`; a leftover `JEV_PROVIDER=typesafe` would
  rename the expected key to `TYPESAFE_API_KEY`):
  `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"0"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"jev_browse","arguments":{"url":"https://example.com","goal":"stop"}}}' | env JEV_PROFILE="$VERIFY_HOME/profile" JEV_AB_PROFILE="$VERIFY_HOME/profile" TYPESAFE_API_KEY= OPENROUTER_API_KEY= JEV_PROVIDER= node bundled/mcp.mjs`.
  The id-3 response is a tool result with `isError:true` whose
  `content[0].text` contains `OPENROUTER_API_KEY is not set` (OpenRouter is
  the auto-selected provider when the TypeSafe key is unset). Save stdout as
  `mcp/missing-key-call.json`.
- **Real drive (out-of-band).** With a provider key set, `tools/call` a
  fixture goal needs `JEV_ALLOW_FILE_URLS=1` in the server env — the
  `jev_browse` arg list has no file-url opt-in. The tool text is the
  RunResult JSON; verify `status:"done"` and `final_text` there.

## Gotchas

- `tools/call` responses are JSON-RPC `result` envelopes; the RunResult is
  a JSON string inside `content[0].text`, flagged by `isError`.
- Calls are serialized through a queue — send requests on separate lines
  and read one response per line.
- The packaged plugin registers the server under the `browser` key in
  `mcp.json`, so MCP clients surface the tool as `browser`/`jev_browse`; the
  server `serverInfo.name` stays `jev-browse`.
- `file://` calls without `JEV_ALLOW_FILE_URLS=1` in the server env return
  the http(s)-only error as an `isError` tool result, same gate as the CLI.
