# Contributing to Stim Webtoys Library

Thanks for contributing. This guide covers the current Bun-first workflow for humans and automation contributors.

## Quick start

1. Install **Bun 1.3+** (the repo declares `bun@1.3.8` in `package.json`).
2. Install dependencies:

   ```bash
   bun install
   ```

   If you are updating dependencies, run:

   ```bash
   bun install
   ```

   Use `bun install --frozen-lockfile` in CI or other reproducible-install contexts where lockfile changes must be disallowed.

3. Start the dev server:

   ```bash
   bun run dev
   ```

4. Open `http://localhost:5173`.

## Quality checks

Use these commands before opening a PR:

- Full gate for JS/TS changes:

  ```bash
  bun run check
  ```

- Faster iteration gate (no tests):

  ```bash
  bun run check:quick
  ```

- Toy registry/docs consistency check when adding or renaming toys:

  ```bash
  bun run check:toys
  ```

- Run targeted tests:

  ```bash
  bun run test tests/path/to/spec.test.ts
  ```

> Use `bun run test` (not raw `bun test`) so preload/importmap flags from `package.json` are always applied.

## Common dev commands

- `bun run dev` — start local Vite server.
- `bun run dev:host` — start Vite on LAN.
- `bun run build` — production build.
- `bun run preview` — preview built output.
- `bun run lint` / `bun run lint:fix` — Biome linting.
- `bun run format` / `bun run format:check` — Biome formatting.
- `bun run typecheck` — TypeScript no-emit checks.

## Branches, commits, and pull requests

- Branch from `main` and keep PRs focused.
- Commit messages should be sentence case with no trailing period.
- PR descriptions should include:
  - short summary,
  - explicit test command list,
  - explicit list of docs touched (or `None`).

## Documentation expectations

When workflows or structure change, update docs in the same PR:

- Start from [`docs/README.md`](./docs/README.md) (docs map by audience + purpose).
- Keep contributor and agent entry points aligned:
  - [`README.md`](./README.md)
  - [`CONTRIBUTING.md`](./CONTRIBUTING.md)
  - [`AGENTS.md`](./AGENTS.md)
  - [`docs/agents/README.md`](./docs/agents/README.md)

## Toy-specific changes

For new or renamed toys, update all of the following together:

- Toy implementation in `assets/js/toys/`.
- Toy metadata in `assets/data/toys.json`.
- Standalone page in `toys/` for page-backed toys.
- `docs/TOY_SCRIPT_INDEX.md` and `docs/toys.md`.
- Tests in `tests/` where behavior changed.

Scaffold helper:

```bash
bun run scripts/scaffold-toy.ts --slug my-toy --title "My Toy" --type module --with-test
```
