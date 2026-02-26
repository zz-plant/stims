# Development Guide

This is the operational handbook for day-to-day contribution to Stim Webtoys Library. Use it to choose the right command quickly, run the right quality gates, and ship changes with predictable metadata/docs hygiene.

## Toolchain baseline

- Package manager/runtime: **Bun 1.3+** (`bun@1.3.8` pinned in `package.json`).
- Build/dev server: **Vite**.
- Lint + format: **Biome**.
- Typecheck: **TypeScript** (`tsc --noEmit`).
- Tests: **Bun test** with preload/importmap wiring from package scripts.
- Deploy tooling: **Wrangler** for Cloudflare Pages.

## Environment and prerequisites

- Node is supported for fallback script execution (`engines.node: ^22`), but use Bun for installs and scripts.
- Clone the repo and install dependencies:

```bash
bun install
```

When dependency manifests change and lockfile updates are expected, run:

```bash
bun install
```

For reproducible CI-style installs that must not modify `bun.lock`, run:

```bash
bun install --frozen-lockfile
```

## Choose your workflow lane

Use this to decide the minimum workflow before you start running commands.

| Change type | Minimum checks before commit | Usually add |
| --- | --- | --- |
| Docs-only wording/link updates | Proofread + command/path validation in edited docs | `bun run check:quick` when commands/instructions changed significantly |
| JS/TS behavior changes | `bun run check` | Targeted test run while iterating |
| Toy addition/rename/registration edits | `bun run check` + `bun run check:toys` | `bun run health:toys` and toy docs updates |
| SEO generation/check logic changes | `bun run check` + `bun run check:seo` | `bun run generate:seo` to refresh artifacts |
| Deploy pipeline/workflow changes | `bun run check` + local smoke (`bun run dev:check`) | `bun run pages:dev` before deploy |

## Command reference

### Core local development

| Task | Command | Notes |
| --- | --- | --- |
| Start dev server | `bun run dev` | Default local Vite dev server. |
| Start dev server on LAN | `bun run dev:host` | Use for device testing on local network. |
| Start WebGPU-focused dev session | `bun run dev:webgpu` | Launches localhost Vite + Chromium with WebGPU-enabling flags. |
| Dev smoke check (no browser) | `bun run dev:check` | Scripted health check for local dev boot. |
| Production build | `bun run build` | Uses Bun with Node fallback in script. |
| Reuse prior build artifacts | `bun run build:reuse` | Useful in deploy/preview loops. |
| Preview production build | `bun run preview` | Serves built output with Vite preview. |
| Serve `dist/` directly | `bun run serve:dist` | Minimal static server for built output. |

### Quality and validation

| Task | Command | Notes |
| --- | --- | --- |
| Full quality gate | `bun run check` | Biome check + typecheck + tests. Required for JS/TS edits. |
| Quick quality gate | `bun run check:quick` | Biome check + typecheck (faster iteration path). |
| Run all tests | `bun run test` | Preserves preload/importmap setup. |
| Run compatibility-focused unit tests | `bun run test:compat` | Fast compatibility coverage for renderer preference and fallback state logic. |
| Run full compatibility regression suite | `bun run test:compat:full` | Includes loader + toy-view flows to surface integration issues. |
| Run tests in watch mode | `bun run test:watch` | Iterative local testing. |
| Run agent integration test | `bun run test:agent` | Focused test for MCP/agent integration path. |
| Typecheck once | `bun run typecheck` | Runs `tsc --noEmit`. |
| Typecheck watch | `bun run typecheck:watch` | Continuous TS diagnostics. |
| Lint | `bun run lint` | Lint-only diagnostics. |
| Lint + auto-fix | `bun run lint:fix` | Biome check with writes. |
| Format write | `bun run format` | Applies Biome formatting. |
| Format check | `bun run format:check` | Non-writing format validation. |

### Toy and content integrity

| Task | Command | Notes |
| --- | --- | --- |
| Toy consistency check | `bun run check:toys` | Validates toy registration/docs consistency. |
| Toy health check | `bun run health:toys` | Runs toy runtime/metadata health diagnostics. |
| Play a specific toy | `bun run play:toy <slug>` | Scripted toy-run helper against local dev server. |
| Generate SEO artifacts | `bun run generate:seo` | Regenerates SEO-derived assets. |
| Validate SEO artifacts | `bun run check:seo` | Ensures generated SEO artifacts are valid. |

### Cloudflare Pages workflows

| Task | Command | Notes |
| --- | --- | --- |
| Local Pages dev | `bun run pages:dev` | Builds first, then runs Wrangler Pages locally. |
| Deploy Pages | `bun run pages:deploy` | Build + deploy sequence. |
| Deploy reusing build | `bun run pages:deploy:reuse` | Faster deploy loop if build is already available. |

### MCP tooling

| Task | Command | Notes |
| --- | --- | --- |
| Start MCP server | `bun run mcp` | Starts project MCP server script. |

## Golden-path recipes

### 1) Implement a normal JS/TS feature

```bash
bun run dev
# implement change
bun run check
```

If `bun run check` is too slow during iteration, use `bun run check:quick` until final validation.

### 2) Add or rename a toy

```bash
bun run dev
# implement toy + metadata + docs updates
bun run check
bun run check:toys
```

Also keep toy docs synchronized in the same change:

- `docs/TOY_DEVELOPMENT.md`
- `docs/TOY_SCRIPT_INDEX.md`
- `docs/toys.md`

### 3) Refresh SEO-derived content

```bash
bun run generate:seo
bun run check:seo
```

Run `bun run check` as well if supporting JS/TS logic changed.

### 4) Prepare a Pages deployment

```bash
bun run check
bun run build
bun run pages:dev
# final verification
bun run pages:deploy
```

Use `bun run pages:deploy:reuse` when deploying a build you already verified.

## Quality gate expectations

- **JS/TS edits:** run `bun run check` before commit.
- **Docs-only edits:** tests/typecheck can be skipped unless command paths/workflows changed and need validation.
- **Toy additions/slug changes:** run `bun run check:toys` and update toy docs together.

## Targeted testing patterns

Run a single test file:

```bash
bun run test tests/path/to/spec.test.ts
```

Run tests matching a pattern:

```bash
bun run test -- --filter "toy"
```

Always prefer `bun run test` over `bun test` directly so preload/importmap flags in `package.json` are retained.

## Troubleshooting quick hits

- **`bun run test` behaves differently from direct `bun test`:** ensure you are invoking through package scripts so preload/importmap flags apply.
- **Formatting/lint drift:** run `bun run lint:fix` followed by `bun run format`.
- **Typecheck errors after dependency changes:** rerun `bun install` and then `bun run typecheck`.
- **`check:toys` failures after renaming a slug:** verify toy docs and metadata updates landed together.
- **Pages command failures locally:** verify Wrangler auth/context and rerun `bun run pages:dev`.
- **`navigator.gpu` missing during local testing:** run `bun run dev:webgpu` so Chromium starts with WebGPU flags on localhost.

## Commit and PR metadata checklist

Before opening a PR:

1. Commit title is sentence case with no trailing period.
2. PR description includes:
   - a short summary,
   - explicit list of tests run,
   - explicit list of docs touched/added.
3. If scripts/workflows changed, linked docs are updated (`docs/README.md`, contributor/agent overlays as needed).

## Suggested contribution workflow

1. Create a branch from `main`.
2. Implement the change.
3. Run relevant validation commands for your workflow lane.
4. Update docs when behavior, scripts, or workflow expectations change.
5. Commit using sentence case with no trailing period.
6. Open PR with explicit tests/docs metadata.

## Related docs

- Contributor onboarding: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- Docs map: [`README.md`](./README.md)
- Toy implementation details: [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md)
- Deployment details: [`DEPLOYMENT.md`](./DEPLOYMENT.md)
- Architecture overview: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- Agent-focused overlays: [`agents/README.md`](./agents/README.md)
