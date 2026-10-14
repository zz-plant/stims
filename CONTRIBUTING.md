# Contributing to Stims

## Set up

You need:

- [Bun](https://bun.sh) 1.3.14, the version `package.json` pins. Node 22 is declared for the Node-based tools.
- [mise](https://mise.jdx.dev), only for `bun run setup`, which starts with `mise trust` so mise applies `mise.toml` (Bun 1.3.14, Node 22). Without mise, run `bun run setup:codex`: the same bootstrap minus that step.
- Playwright's Chromium, for browser-backed tests and the capture tools (`lab:visual`, `parity:capture`, `ui:diff`). Unit and compatibility tests run without it.

```bash
git clone --filter=blob:none https://github.com/zz-plant/stims.git
cd stims
bun run setup                      # bun install, then bun run check:quick
bunx playwright install chromium   # browser tests and capture tools
bun run doctor                     # what works on this machine; changes nothing
bun run dev                        # http://localhost:5173/
```

`--filter=blob:none` skips the old binaries in the git history. `bun run setup -- --print-plan` prints what setup would do without doing it. `bun install` on its own installs dependencies and skips the check; CI runs `bun install --frozen-lockfile`, which fails rather than rewrite `bun.lock`.

`bun run doctor` checks Bun, TypeScript, Biome, Playwright, Wrangler and the installed dependencies, then launches headless Chromium and reports whether it renders on a GPU, in software, or not at all. Correctness tools work in software rendering; frame times measured there do not describe real hardware.

In a cloud container that ships Chromium under `PLAYWRIGHT_BROWSERS_PATH` and blocks downloads, `bun run setup:browsers` links that build where the pinned Playwright looks for it. `bun run setup` already does this.

Open `http://localhost:5173/?agent=true` for browser checks: agent mode keeps rendering in a tab the browser reports as hidden.

## Where to look first

- New here? Start with the onboarding map: [`docs/ONBOARDING.md`](./docs/ONBOARDING.md)
- Current command/reference docs: [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md)
- Test profiles, quality gates and the manual checklist: [`docs/TESTING.md`](./docs/TESTING.md), [`docs/QA_PLAN.md`](./docs/QA_PLAN.md)
- MilkDrop runtime guidance: [`docs/MILKDROP_PRESET_RUNTIME.md`](./docs/MILKDROP_PRESET_RUNTIME.md)
- Priorities and workstreams: [`docs/ROADMAP.md`](./docs/ROADMAP.md)
- Play, edit, and share: [`docs/USER_GUIDE.md`](./docs/USER_GUIDE.md)
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

- Catalog manifest consistency check:

  ```bash
  bun run check:catalog-integrity
  ```

- Run targeted tests:

  ```bash
  bun run test tests/path/to/spec.test.ts
  ```

`bun run test` with no profile runs unit + compatibility tests; [Testing](./docs/TESTING.md) lists the other profiles. Package suites use their own configuration: run `bun --cwd packages/<name> test` or `bun run check:packages`.

## Common dev commands

- `bun run help` — every script with a one-line purpose; `bun run help --for "<symptom>"` suggests the instrument for a problem.
- `bun run dev` — start local Vite server.
- `bun run dev:agent` — start Vite, typecheck watch, and fast-test watch.
- `bun run dev:host` — start Vite on LAN.
- `bun run build` — production build.
- `bun run preview` — preview built output.
- `bun run site:deploy` — manual production deploy fallback for the site Worker.
- `bun run site:preview` — upload a preview version of the site Worker without shifting production traffic.
- `bun run lint` / `bun run lint:fix` — Biome linting.
- `bun run format` / `bun run format:check` — Biome formatting.
- `bun run typecheck` — TypeScript no-emit checks.

The agent session helpers (`session:codex`, `model:codex`) depend on local model tooling most machines do not have; [agent tooling](./docs/agents/tooling-and-quality.md) covers them.

## Branches, commits, and pull requests

- Branch from `main` and keep PRs focused.
- Use Conventional Commits: `type(scope): summary`, lowercase after the colon, no trailing period, such as `docs: update contributor setup`. [Commit conventions](./docs/COMMIT_CONVENTIONS.md) says what the commit hook checks.
- Scaffold the PR description with `bun run pr:body` and check it with `bun run pr:body -- --check <file>`. It needs a short summary, the test commands you ran, and the docs touched (or `None`).

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
