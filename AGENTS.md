# Agent Guidelines

These instructions apply to the entire repository.

- Prefer **Bun** tooling to match `packageManager` (for installs use `bun install --frozen-lockfile` when dependencies change, and run scripts with `bun run ...`).
- For JavaScript/TypeScript changes, run the relevant quality checks before committing: `bun run lint`, `bun run typecheck`, and `bun run test` when you change logic.
- Keep the docs in `docs/` and the root `README.md` in sync with workflow or toy changes so contributors can find updated guidance.
- Follow existing formatting conventions; use `bun run format` if you alter code or prose that needs consistent styling.
