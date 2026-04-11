# Contributing to Stims

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

4. Open `http://localhost:5173/`.

   Use `http://localhost:5173/milkdrop/` only when you need to verify the compatibility alias redirect behavior.

## Where to look first

- Current command/reference docs: [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)
- MilkDrop runtime guidance: [`docs/MILKDROP_PRESET_RUNTIME.md`](./docs/MILKDROP_PRESET_RUNTIME.md)
- Successor workstream map: [`docs/MILKDROP_SUCCESSOR_WORKSTREAMS.md`](./docs/MILKDROP_SUCCESSOR_WORKSTREAMS.md)
- Canonical docs index: [`docs/README.md`](./docs/README.md)
- Repo-local agent capabilities in `.agent/`: [`docs/agents/custom-capabilities.md`](./docs/agents/custom-capabilities.md)

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

- Manifest/generated-artifact consistency check:

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
- `bun run pages:deploy` — manual production deploy fallback for the static site.
- `bun run pages:deploy:preview` — manual preview deploy fallback for the static site.
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

When workflows or structure change, update docs in the same PR (including deployment-track guidance in `docs/DEPLOYMENT.md` when release flow changes). For Pages deploy changes, keep [`wrangler.toml`](./wrangler.toml) aligned with the live Cloudflare project config instead of treating the dashboard as the only source of truth, and keep [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) aligned with the default direct-upload release path.

- Follow [`docs/DOCS_MAINTENANCE.md`](./docs/DOCS_MAINTENANCE.md) as the canonical docs synchronization contract.
- Treat [`docs/README.md`](./docs/README.md) as the canonical docs index and update it whenever docs are added, renamed, moved, or deleted.

## MilkDrop product changes

For product-facing work, keep these areas aligned together:

- Root workspace and engine seam code in `assets/js/frontend/`, `assets/js/core/`, `assets/js/milkdrop/`, and `assets/js/toys/milkdrop-toy.ts`.
- The shipped manifest entry in `assets/data/toys.json`.
- Generated artifacts in `assets/js/data/toy-manifest.ts`, `public/toys.json`, `docs/TOY_SCRIPT_INDEX.md`, and `docs/toys.md`.
- Tests in `tests/` where runtime behavior changed.
