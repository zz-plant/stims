# Contributing to Stims

Thanks for contributing. This guide covers the current Bun-first workflow for humans and automation contributors.

## Quick start

1. Install **Bun 1.3+** (the repo declares `bun@1.3.14` in `package.json`).
2. Bootstrap the local workspace:

   ```bash
   bun run doctor
   bun run setup -- --print-plan
   bun run setup
   ```

   `bun run doctor` prints the local readiness summary without changing the workspace. If you only need dependencies and are not ready to run the quick validation pass, use:

   ```bash
   bun install
   ```

   Use `bun install --frozen-lockfile` in CI or other reproducible-install contexts where lockfile changes must be disallowed.

3. Start the dev server:

   ```bash
   bun run dev
   ```

   For a warmer agent-oriented session on machines that expose the local helper commands, use:

   ```bash
   bun run session:codex -- --profile review
   ```

4. Open `http://localhost:5173/`.

   Use `http://localhost:5173/milkdrop/` only when you need to verify the compatibility alias redirect behavior.

## Where to look first

- Current command/reference docs: [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)
- MilkDrop runtime guidance: [`docs/MILKDROP_PRESET_RUNTIME.md`](./docs/MILKDROP_PRESET_RUNTIME.md)
- Successor workstream map: [`docs/MILKDROP_SUCCESSOR_WORKSTREAMS.md`](./docs/MILKDROP_SUCCESSOR_WORKSTREAMS.md)
- Canonical docs index: [`docs/README.md`](./docs/README.md)
- Agent bootstrap and delegation guide: [`docs/agents/agent-handoffs.md`](./docs/agents/agent-handoffs.md)
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

> Use `bun run test` (not raw `bun test`) so the beforeEach/preload setup in `bunfig.toml` is always applied.

## Common dev commands

- `bun run doctor` — print a local readiness summary for Bun, dependencies, and LM Studio helper availability.
- `bun run setup -- --print-plan` — preview the local bootstrap plan without changing the workspace.
- `bun run setup` — install dependencies and run `bun run check:quick`.
- `bun run dev` — start local Vite server.
- `bun run session:codex -- --profile review` — keep the dev server, local model roles, and a verification watcher warm for agent sessions.
- `bun run model:codex -- --mode triage --no-exec` — route a task onto the fast or quality local model helper stack.
- `bun run dev:host` — start Vite on LAN.
- `bun run build` — production build.
- `bun run preview` — preview built output.
- `bun run site:deploy` — manual production deploy fallback for the site Worker.
- `bun run site:preview` — upload a preview version of the site Worker without shifting production traffic.
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

When workflows or structure change, update docs in the same PR (including deployment-track guidance in `docs/DEPLOYMENT.md` when release flow changes). For site deploy changes, keep [`wrangler.site.jsonc`](./wrangler.site.jsonc) aligned with the live Cloudflare Workers Builds config instead of treating the dashboard as the only source of truth.

- Follow [`docs/DOCS_MAINTENANCE.md`](./docs/DOCS_MAINTENANCE.md) as the canonical docs synchronization contract.
- Treat [`docs/README.md`](./docs/README.md) as the canonical docs index and update it whenever docs are added, renamed, moved, or deleted.

## Contributing presets

Presets are contributions too — you don't need to touch engine code.

1. **Learn or refresh**: the guided course lives at [`docs/authoring/README.md`](./docs/authoring/README.md); the generated language reference at [`docs/authoring/reference.md`](./docs/authoring/reference.md).
2. **Author in the live editor** (`bun run dev`, then the Editor panel — or on the deployed site). Export produces a `.milk` file; Remix preserves credit lineage automatically.
3. **Measure before you submit**: `bun run lab:reactivity -- --file path/to/your.milk` reports whether each variable actually reacts to audio — aim for a `reactive` verdict. (`bun run lab:visual` adds pixel-level verdicts but currently only accepts catalog `--preset` ids, so it runs after your preset lands in `public/milkdrop-presets/`.)
4. **Submit**: open a PR adding the `.milk` file under `public/milkdrop-presets/` (the catalog gates in `bun run check` will validate it), or share it as a `#code=` URL from the editor. Credit any preset you remixed — multi-author titles are the community's convention, and `deriveRemixCredit` keeps lineage intact.

## Product and runtime changes

For product-facing work, keep these areas aligned together:

- Root workspace and engine seam code in `src/js/frontend/`, `src/js/core/`, and `src/js/milkdrop/`.
- Edge functions, AI endpoints, and middleware in `functions/` and `functions/api/`.
- Type contracts and ambient declarations in `src/types/`.
- Tests in `tests/` where runtime behavior changed.
- Run `bun run check` to verify all quality gates before opening a PR.
