# Agent Guidelines (Essentials)

Stim Webtoys Library is a collection of interactive, audio-reactive web toys built with Three.js/WebGL for responsive visual play.

## Essentials

- **Package manager:** Bun (use `bun install` for dependency updates, reserve `bun install --frozen-lockfile` for reproducible/CI installs, and run scripts with `bun run ...`).
- **Quality gate for JS/TS edits:** run `bun run check` (Biome check + typecheck + tests) before committing.
- **Commit metadata:** use sentence case commit titles with no trailing period.
- **PR metadata:** include a short summary plus explicit lists of tests run and docs touched/added.

## Recommended execution order

1. Open [`docs/agents/README.md`](./docs/agents/README.md) for progressive-disclosure guidance.
2. Use [`docs/agents/tooling-and-quality.md`](./docs/agents/tooling-and-quality.md) before editing code.
3. Use [`docs/agents/metadata-and-docs.md`](./docs/agents/metadata-and-docs.md) before finalizing commit/PR text.
4. Use [`docs/README.md`](./docs/README.md) to keep contributor-facing links aligned if docs move.

## Alignment requirements

- Keep links between `AGENTS.md`, `CONTRIBUTING.md`, and `docs/README.md` in sync when restructuring docs.
- If you add or rename scripts, update both `docs/DEVELOPMENT.md` and agent overlays that mention those scripts.
- If you add or rename toys, update `docs/TOY_DEVELOPMENT.md`, `docs/TOY_SCRIPT_INDEX.md`, and `docs/toys.md` in the same change.
