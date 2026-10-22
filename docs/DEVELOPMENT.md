# Development

Stims is one browser-native app for playing and editing MilkDrop presets. Prefer changes that strengthen the shared runtime, preset workflows, and app shell over adding parallel product surfaces.

For a concise parallel execution map across parity, runtime performance, browser-native product work, and proof/release work, see the [roadmap's workstreams](./ROADMAP.md#workstreams).

## Toolchain

`package.json` pins Bun 1.4.3 and declares Node 22 for Node-based tooling; [Contributing](../CONTRIBUTING.md#set-up) has the setup steps. Current tooling uses React 19, Vite 8, TypeScript 7, Biome 2, and Playwright; exact versions belong in `package.json` and `bun.lock`. Dependency-cruiser uses the SWC parser. The [September audit](./archive/TECH_STACK_MODERNIZATION_2026-09.md) is historical and does not define today's version constraints.

## Core workflow

1. Set up once as [Contributing](../CONTRIBUTING.md#set-up) describes.
2. Start local development with `bun run dev:agent` for dev, typecheck, and fast-test watchers, or `bun run dev` for the server alone, and open `http://localhost:5173/`.
3. Run `bun run check:quick` while iterating (runs concurrent linting, typechecking, asset, catalog, SEO, and architecture checks with instant fail-fast feedback).
4. For specific test coverage during iteration, run `bun run test tests/path/to/spec.test.ts`.
5. Run `bun run check` before finalizing changes (includes asset checks, concurrent guards, package checks, and unit + compatibility + corpus tests).

`bun run check` includes parallel asset validation (`assets:check`), documentation and public-claim guards, SEO surface validation, and the architecture boundary guard. The quality gate runs concurrent checks and stops that lane on failure; total duration depends on the checks and host. The public-claim check keeps the README preset count aligned with the shipped catalog and rejects wording that promotes known experimental foundations as shipped features. The architecture check verifies the documented `app` (root entry point `src/js/app.ts`) / `frontend` / `core` / `ui` / `utils` / `milkdrop` dependency directions.

Test files fan out across `bun test --parallel` workers sized to your CPU count; override with `STIMS_TEST_SHARDS=<count>` (e.g. `STIMS_TEST_SHARDS=8 bun run test:fast`, `STIMS_TEST_SHARDS=1` for a single-process run).

[`TESTING.md`](./TESTING.md) owns the test profiles, the gates and which evidence fits which change; [`tests/INDEX.md`](../tests/INDEX.md) maps the test directories.

## Main scripts

To regenerate the README's Play → Edit → Share clip, start `bun run dev`, then run `bun scripts/generate-workflow-demo.ts`. It records the real UI, verifies the copied URL preserves the edited source, and writes a silent MP4 and an accelerated animated WebP under `docs/assets/clips/`; `--preview-only` re-encodes the WebP from the committed MP4 without recording. Browser evidence and raw recordings remain in `output/playwright/workflow-demo/`. Review the generated media before publishing it; [launch material](./LAUNCH.md) contains copy and measurement commands.

| Task | Command |
| --- | --- |
| Check local readiness | `bun run doctor` |
| List every script with its purpose | `bun run help` |
| Start dev server | `bun run dev` |
| Start dev and verification watchers | `bun run dev:agent` |
| Start dev server on all interfaces | `bun run dev:host` |
| WebGPU-focused local session | `bun run dev:webgpu` |
| Fast quality gate (lint + types + guards) | `bun run check:quick` |
| Full quality gate (guards + gate test suite) | `bun run check` |
| Complete quality gate (guards + all test profiles) | `bun run check:all` |
| README public-claim drift check | `bun run check:readme-claims` |
| SEO surface check | `bun run check:seo` |
| Architecture boundary check | `bun run check:architecture` |
| Asset health check | `bun run assets:check` |
| Run default tests (unit + compat) | `bun run test` |
| Run a specific test file | `bun run test tests/path/to/spec.test.ts` |
| Run another test profile | See [`TESTING.md`](./TESTING.md#select-a-profile) |
| Run certification-corpus browser performance suite | `bun run perf:certification-corpus` |
| Build production assets | `bun run build` |
| Preview production build | `bun run preview` |

Performance comparisons need more controls than an ordinary smoke test. Follow
[`RUNTIME_PERFORMANCE.md`](./RUNTIME_PERFORMANCE.md) to hold the preset, audio,
viewport, backend, quality step, warmup, capture window, and CPU throttle
constant across before/after runs.

## Agent sessions and parity capture

`session:codex` and `model:codex` keep a dev server, watchers and local model roles warm for agent sessions; the model roles need local LM Studio helper commands. [Agent tooling](./agents/tooling-and-quality.md) documents both.

Capturing Stims output, importing native projectM references, diffing, and promoting measured results is the [parity plan](./MILKDROP_PROJECTM_PARITY_PLAN.md)'s workflow; follow it there, including its rules on serial captures and noise.

## Product assumptions

- The primary app entrypoint is `index.html` (`/`).
- `milkdrop/index.html` (`/milkdrop/`) is a compatibility alias that redirects into the root app route.
- Presets are part of one visualizer product, not separate first-class toys.

## Frontend boundaries

- `src/js/app.ts` and `src/js/frontend/*` are the active product frontend.
- `src/js/milkdrop/*` remains the visual engine behind the adapter seam.
- `src/js/frontend/` draws no Three.js scenes of its own; every visual on the stage comes from the engine behind the adapter.
- `src/js/frontend/workspace-router.tsx` is a thin pass-through that renders `App.tsx` directly — the old `@tanstack/react-router` was removed in favor of the native History API (see `url-state.ts` + `workspace-hooks.ts` for URL sync).
- The pre-React DOM shell (`loader.ts`, `router.ts`, `toy-view.ts`, `library-view*`, `bootstrap/*`) has been deleted. `milkdrop/index.html` is the only remaining compatibility surface, and it redirects to `/`.
- New product work must not reintroduce a second shell that boots the engine outside the adapter seam.

## Testing

Use the narrowest command that fits the change. [`TESTING.md`](./TESTING.md) maps changes to evidence, and [`QA_PLAN.md`](./QA_PLAN.md) is the manual checklist for UI, runtime and renderer changes.

## Docs to keep aligned

- [`README.md`](../README.md)
- [`LINEAGE_AND_CREDITS.md`](./LINEAGE_AND_CREDITS.md)
- [`MILKDROP_PRESET_RUNTIME.md`](./MILKDROP_PRESET_RUNTIME.md)
- [`DEPLOYMENT.md`](./DEPLOYMENT.md)

