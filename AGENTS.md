# Agent Guidelines

These instructions apply to the entire repository.

- Prefer **Bun** tooling to match `packageManager` (for installs use `bun install --frozen-lockfile` when dependencies change, and run scripts with `bun run ...`).
- For JavaScript/TypeScript changes, run the relevant quality checks before committing: `bun run lint`, `bun run typecheck`, and `bun run test` when you change logic.
- For documentation-only changes (Markdown/prose), you can skip `bun run lint`, `bun run typecheck`, and `bun run test`, but still run `bun run format` on touched docs, double-check links/anchors render as expected, and note any doc-specific review steps (like syncing `docs/` and `README.md`) in the PR description.
- Keep the docs in `docs/` and the root `README.md` in sync with workflow or toy changes so contributors can find updated guidance.
- Follow existing formatting conventions; use `bun run format` if you alter code or prose that needs consistent styling.
