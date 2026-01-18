# Tooling & Quality Checks

## Package manager

- Prefer **Bun** tooling to match the repo `packageManager`.
- For dependency changes, install with `bun install --frozen-lockfile`.
- Run scripts with `bun run ...`.

## Linting & formatting

- Use **Biome** for linting and formatting. Do not use ESLint or Prettier.

## Required checks

- For JavaScript/TypeScript changes, run the relevant quality checks before committing:
  - `bun run check` (Biome + tests)
  - `bun run typecheck`

## Documentation-only changes

- For Markdown/prose-only changes, you can skip `bun run typecheck` and `bun run test`.
- Still run `bun run format` on touched docs.
