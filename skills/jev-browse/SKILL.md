---
name: jev-browse
description: Drive a real browser autonomously toward one bounded web goal (search, filter, navigate, fill a form). Use when a task is a self-contained web objective with a clear done condition; keep step-by-step browser tools for exploratory or interactive work.
---

# jev-browse

This plugin provides the `jev_browse` tool (MCP) and a CLI that let TypeSafe
Jev drive a real Chrome tab end-to-end.

## When to use

- Bounded goals with an observable end state: "find flights X→Y on date Z and
  stop when results are visible", "open the pricing page and report tiers".
- Tasks that would take many step-by-step browser calls — the driver loops
  observe → choose → act itself, ~1 decision per second.

## When NOT to use

- Exploratory browsing where the next step depends on what you find — drive it
  yourself instead.
- Content the model can't see: closed shadow roots, cross-origin iframes,
  canvas or other bitmap UI.
- Purchases, credential entry, or other irreversible flows — there is no
  enforced guardrail.

## Inputs

- `goal` (required): one natural-language goal WITH an explicit stop
  condition. The driver cannot read your mind about "done".
- `url` (required): starting http(s) page on the target site. The driver
  navigates in-page — it cannot reach the address bar, so start on the right
  site (e.g. Google Flights, not google.com).
- `engine`: `cdp` (default, own Chrome) or `agent-browser` (existing
  agent-browser session).
- `max_steps`: action budget, default 60.

## Reading the result

`status` is `done` | `blocked` | `error`. A `done` is the model's claim, not
proof — check `final_url` and `history` before reporting success. `blocked`
means no supported operation could make progress (or the no-change detector
fired); treat it as "try differently" not "failed".

See [README.md](../../README.md) for engines, env vars, and limits.

## CLI (direct use)

```bash
jev-browse --url URL --goal "GOAL" [--engine cdp|agent-browser] [--max-steps N]
```

Or: `node <plugin>/bundled/cli.mjs …`. Step events stream to stderr; result
JSON is stdout. Requires Node ≥22. Env: `TYPESAFE_API_KEY` (required),
`TEXT_MODEL_API_KEY` + `TEXT_MODEL_BASE_URL`/`TEXT_MODEL` (required for text
entry). Dev checkout: `npm run run` (tsx `src/cli.ts`).
