# Tooling & Quality Checks

## Package manager

- Prefer **Bun** tooling to match the repo `packageManager`.
- For dependency changes, install with `bun install --frozen-lockfile`.
- Run scripts with `bun run ...`.

## Linting & formatting

- Use **Biome** for linting and formatting. Do not use ESLint or Prettier.

## Required checks

- For JavaScript/TypeScript changes, run the relevant quality checks before committing:
  - `bun run check` (Biome + typecheck + tests)
  - Optional quick pass: `bun run check:quick` (Biome + typecheck, skips tests)

## Documentation-only changes

- For Markdown/prose-only changes, you can skip `bun run typecheck` and `bun run test`.
- Formatting docs is optional; there is no dedicated script for docs, but you can run `bunx biome format --write docs` if you want to normalize Markdown formatting.
