# Development Guide

This is the day-to-day workflow reference for contributing to Stim Webtoys Library.

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

## Command reference

### Core local development

| Task | Command | Notes |
| --- | --- | --- |
| Start dev server | `bun run dev` | Default local Vite dev server. |
| Start dev server on LAN | `bun run dev:host` | Use for device testing on local network. |
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
| Play specific toy | `bun run play:toy -- <slug>` | Scripted toy run helper. |
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

## Suggested contribution workflow

1. Create a branch from `main`.
2. Implement the change.
3. Run the relevant validation commands (minimum: `bun run check` for JS/TS changes).
4. Update docs when behavior, scripts, or workflow expectations change.
5. Commit using sentence case with no trailing period.
6. In PR metadata, include a short summary, explicit tests run, and docs touched.

## Troubleshooting quick hits

- **`bun run test` behaves differently from direct `bun test`:** ensure you are invoking through package scripts so preload/importmap flags apply.
- **Formatting/lint drift:** run `bun run lint:fix` followed by `bun run format`.
- **Typecheck errors after dependency changes:** rerun `bun install` and then `bun run typecheck`.
- **Pages command failures locally:** verify Wrangler auth/context and rerun `bun run pages:dev`.

## Related docs

- Contributor onboarding: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- Docs map: [`README.md`](./README.md)
- Toy implementation details: [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md)
- Deployment details: [`DEPLOYMENT.md`](./DEPLOYMENT.md)
- Architecture overview: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- Agent-focused overlays: [`agents/README.md`](./agents/README.md)
