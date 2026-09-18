# Anti-slop provenance

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop), commit `e6676e8d0bf17c678cb45b9dacb2bd6ca8dea53a` (`skills/install-anti-slop/assets/anti-slop`, latest commit on that path as of 2026-09-18).

Copied verbatim on 2026-09-18 via the `install-anti-slop` skill's `scripts/install.mjs`, which was itself installed from the same repository (skill folder hash `89044d21c75a367eac1ddbaf208e650b1a7d5820`, recorded in `~/.agents/.skill-lock.json`).

## Installed paths

- `tools/oxlint/anti-slop/index.ts` — generic plugin entry, registered in `oxlint.config.ts` as `anti-slop`.
- `tools/oxlint/anti-slop/effect/index.ts` — opt-in Effect plugin, not registered (no `effect` dependency in this repository).
- `tools/oxlint/anti-slop/vendor/eslint-stylistic/` — vendored `padding-line-between-statements`; see `vendor/eslint-stylistic/UPSTREAM.md` for its own provenance.

## Deviations

None. Files are unmodified from the bundled assets.

## Updating

Re-run the `install-anti-slop` skill's update procedure (`references/update.md`), which diffs the bundled assets against this directory. Do not copy over `UPSTREAM.md` or `vendor/eslint-stylistic/` blindly; preserve provenance records.
