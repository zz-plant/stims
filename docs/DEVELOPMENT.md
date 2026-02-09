# Development Guide

This is the day-to-day developer workflow reference for Stim Webtoys Library.

## Toolchain baseline

- Package manager/runtime: **Bun 1.3+** (`bun@1.3.8` declared in `package.json`).
- Build/dev server: Vite.
- Lint + format: Biome.
- Typecheck: TypeScript (`tsc --noEmit`).
- Tests: Bun test runner with repo preload/importmap wiring.

## Setup

```bash
bun install
```

When dependency manifests or lockfiles change:

```bash
bun install --frozen-lockfile
```

## Command reference

| Task | Command |
| --- | --- |
| Start dev server | `bun run dev` |
| Start dev server on LAN | `bun run dev:host` |
| Dev smoke check (no browser) | `bun run dev:check` |
| Production build | `bun run build` |
| Preview production build | `bun run preview` |
| Run tests | `bun run test` |
| Run tests (watch) | `bun run test:watch` |
| Lint | `bun run lint` |
| Lint + write fixes | `bun run lint:fix` |
| Format | `bun run format` |
| Format check | `bun run format:check` |
| Typecheck | `bun run typecheck` |
| Typecheck watch | `bun run typecheck:watch` |
| Full quality gate | `bun run check` |
| Quick quality gate | `bun run check:quick` |
| Toy consistency check | `bun run check:toys` |
| Generate SEO artifacts | `bun run generate:seo` |
| Serve `dist/` | `bun run serve:dist` |
| Cloudflare Pages local | `bun run pages:dev` |
| Cloudflare Pages deploy | `bun run pages:deploy` |

## Quality gate expectations

- JS/TS code changes: run `bun run check` before commit.
- Docs-only changes: typecheck/tests can be skipped unless docs changed executable instructions that need validation.
- Toy additions/slug renames: run `bun run check:toys`.

## Targeted testing

Run a single test file with:

```bash
bun run test tests/path/to/spec.test.ts
```

Always prefer `bun run test` over `bun test` directly so preload/importmap flags in `package.json` are retained.

## Typical development flow

1. Create a branch from `main`.
2. Implement change.
3. Run appropriate checks (`bun run check` for JS/TS, plus `bun run check:toys` when relevant).
4. Update docs that changed behavior or workflow.
5. Commit with a sentence-case title and no trailing period.

## Related docs

- Contributor onboarding: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- Docs map: [`README.md`](./README.md)
- Toy implementation details: [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md)
- Deployment: [`DEPLOYMENT.md`](./DEPLOYMENT.md)
- Architecture: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
