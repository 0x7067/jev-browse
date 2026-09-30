# Cursor Cloud Agent environment

Repository-managed setup for [jev-browse](https://github.com/0x7067/jev-browse) on Cursor Cloud Agents.

## What the build provides

- **Node.js 22.19** (oxlint needs `>=22.18`; see `.cursor/Dockerfile`)
- **Google Chrome** at `/usr/bin/google-chrome-stable` (headless CDP; `findChrome()` also checks `PATH` and `CHROME_PATH`)
- **`npm ci`** on each build (see `install` in `environment.json`)
- **No `start` or `terminals`** — jev-browse is a bundled CLI (`bundled/cli.mjs`); Chrome is launched per invocation, not as a background daemon

## Secrets (Cursor dashboard only)

Do **not** commit API keys or `.env` files with real credentials. Add optional values in the Cloud Agents environment **Secrets** tab (saved-environment UI). They are injected as environment variables at runtime.

| Variable | Secret? | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | yes | OpenRouter Jev provider |
| `TYPESAFE_API_KEY` | yes | TypeSafe Jev provider |
| `TEXT_MODEL_API_KEY` | yes | OpenAI-compatible helper for `TYPE_TEXT` |
| `TEXT_MODEL_BASE_URL` | no | Helper endpoint (default in `.env.example`) |
| `TEXT_MODEL` | no | Helper model id |
| `JEV_PROVIDER` | no | `typesafe` or `openrouter` |
| `TYPESAFE_MODEL` | no | Jev model id (default `jev-latest`) |
| `JEV_CHROME_ARGS` | no | Extra Chrome flags (shell-style) |

See `.env.example` for defaults and comments.
