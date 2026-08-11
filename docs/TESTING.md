# Testing guide

Single authoritative reference for the Stims test suite. Covers the test framework, speed tiers, quality gate commands, and per-change checklists.

For the visual smoke checklist and manual QA baseline, see [`QA_PLAN.md`](./QA_PLAN.md).

---

## Framework

| Tool | Role |
|---|---|
| **Bun test runner** (`bun test`) | All unit, integration, and contract tests |
| **happy-dom** | DOM/browser-API simulation for tests that need `window`, `document`, `navigator`, `localStorage` |
| **Playwright** | Real browser automation — agent integration harness (`tests/e2e/agent-integration.test.ts`) |

Every test run uses:
- `--preload=./tests/setup.ts` — installs happy-dom globals, fake `requestAnimationFrame`, fake WebGPU constants
- `--importmap=./tests/importmap.json` — alias map used across the suite

---

## Speed tiers

Tests are grouped into three speed tiers. Use the right tier for your workflow.

### Tier 1 — Fast (default quality gate, ~1-2 min)

**Command:** `bun run test:fast`  
**What it includes:** All unit and compatibility tests **except** the slow corpus/certification/integration list below.  
**Concurrency & Sharding:** The fast suite runs under `bun test --parallel`, which distributes test files across worker processes with work stealing (`STIMS_TEST_SHARDS=n` overrides the worker count; `n=1` forces a single in-process run).  
**When to use:** Pre-commit, `bun run check`, any time you want confident signal without waiting.

Tests excluded from this tier:

| File | Why excluded |
|---|---|
| `tests/e2e/agent-integration.test.ts` | Requires Playwright + a running Vite server |
| `tests/corpus/capture-certification-corpus.test.ts` | Requires a built dist |
| `tests/corpus/capture-visual-reference-suite.test.ts` | Requires a built dist |
| `tests/corpus/certification-corpus.test.ts` | Loads ~120 corpus presets |
| `tests/corpus/certification-corpus-perf-suite.test.ts` | Perf benchmarks, not correctness |
| `tests/corpus/certification-corpus-runtime.test.ts` | Full corpus runtime exercise |
| `tests/corpus/milkdrop-corpus-compat.test.ts` | 120+ preset compatibility matrix |
| `tests/corpus/milkdrop-parity.test.ts` | Pixel-level WebGPU/WebGL comparison |
| `tests/corpus/milkdrop-projectm-compat.test.ts` | ProjectM reference comparison |
| `tests/corpus/run-certification-corpus-perf-suite.test.ts` | Corpus perf runner |
| `tests/corpus/run-parity-diff-suite.test.ts` | Parity visual diff runner |

### Tier 2 — Full (all Bun tests, ~5 min+)

**Command:** `bun run test`  
**What it includes:** Every test file in `tests/`, including corpus and certification runs.  
**When to use:** Before merging changes to the MilkDrop compiler, renderer adapter, feedback manager, or parity pipeline. Use `bun run check:all` to run this tier through the quality gate.

### Tier 3 — Integration (Playwright, ~3 min)

**Command:** `bun run test:integration`  
**What it includes:** `tests/e2e/agent-integration.test.ts` only — real Chromium browser.  
**When to use:** Automatically in CI on every PR and push. Run locally when touching shell bootstrap, audio initialization, or the MilkDrop engine seam.

---

## Quality gate commands

```
bun run check:quick   # Biome lint + typecheck + guards (~5-10s). Use constantly.
bun run check         # Guards + Tier 1 sharded tests (~1-2min). Use pre-commit.
bun run check:all     # Guards + Tier 2 tests (all). Use pre-merge on hot files.
```

Each gate runs in this sequence:

1. **Preflight**: `check:no-ts-nocheck` (bans `@ts-nocheck` guards) + `check:ci-config` (workflow drift)
2. **Concurrent Lane (Fail-Fast)**: Asset health (`assets:check`), Biome check, catalog fidelity, catalog integrity, toy manifest drift, SEO surface, CSS token resolution, stale paths, duplicate CSS, architecture boundaries, and TypeScript typecheck run concurrently. If any check fails, remaining concurrent tasks are killed immediately for instant feedback.
3. **Postflight**: Test suite (tier depends on mode: none for `quick`, `test:fast` for `full`, `test` for `all`).

---

## Named test profiles

These profiles are passed to `scripts/run-tests.ts` via `--profile`:

Each profile maps to a set of `tests/` subdirectories (`unit`, `compat`, `corpus`, `e2e`). Every test file must live in one of those categories — `run-tests.ts` fails the run if a file sits uncategorized in `tests/`, because no profile would ever execute it.

| Profile | Command | Categories |
|---|---|---|
| `all` (default) | `bun run test` | `unit` + `compat` + `corpus` + `e2e` |
| `fast` | `bun run test:fast` | `unit` + `compat` — what `bun run check` runs |
| `unit` | `bun run test:unit` | `unit` |
| `compat` | `bun run test:compat` | `compat` + `corpus` (the slow parity corpus lives here) |
| `e2e` | `bun run test:e2e` | `e2e` |
| `integration` | `bun run test:integration` | `tests/e2e/agent-integration.test.ts` only, run serially as its own CI job |

---

## CI behavior

| Event | Jobs that run |
|---|---|
| Pull request | `quality` (lint + typecheck + `test:fast`) + `integration` (Playwright) |
| Push to `main` | `quality` + `integration` (deploys run on Cloudflare Workers Builds, not Actions) |
| Merge group | `quality` + `integration` |

Integration tests run on **every PR** — not just on push to main. This is intentional: the integration harness catches shell bootstrap, audio lifecycle, and engine seam regressions that no unit test covers.

---

## Per-change checklists

### Touching `src/js/milkdrop/feedback-manager-*` or `renderer-adapter*`

- [ ] `bun run test:compat` passes against the reference preset set
- [ ] WebGL and WebGPU paths both exercised (check `tests/unit/milkdrop-renderer-adapter.test.ts`)
- [ ] No hardcoded resolution scales or target sizes without a comment explaining the reason
- [ ] Blend alpha order verified against projectM baseline

### Touching `src/js/core/renderer-setup.ts`, `renderer-capabilities.ts`, `render-service.ts`, `backend-fallback.ts`

- [ ] Fallback chain tested with WebGPU disabled (see `tests/unit/renderer-capabilities.test.js`)
- [ ] `renderScale` propagation verified end-to-end (capability probe → renderer plan → query override → pooled renderers)
- [ ] Audio worklet initialization validated on the fallback path
- [ ] `bun run test:integration` passes locally if the shell or audio bridge was touched

### Touching `src/js/milkdrop/compiler/**`

- [ ] `bun run test:compat` passes
- [ ] Any new compiler behavior has a focused test in `tests/unit/milkdrop-compiler-seams.test.ts` or `tests/unit/milkdrop-compiler-shader-analysis.test.ts`
- [ ] No new source-text string assertions — assert on AST/IR structure or numeric output instead

### Touching `tests/**`

- [ ] No new path-string or formatting assertions (these break on unrelated refactors)
- [ ] No new uses of `importFresh()` — prefer factory functions with injected dependencies
- [ ] Integration harness startup contract in `tests/e2e/agent-integration.test.ts` unchanged unless intentionally versioned

### Touching shell or routing (`src/js/frontend/App.tsx`, `url-state.ts`, `workspace-hooks.ts`)

- [ ] `tests/unit/app-shell.test.js` and `tests/unit/frontend-url-state.test.ts` pass
- [ ] `bun run test:integration` passes (integration harness exercises the full boot sequence)
- [ ] URL state normalization tested for both legacy params (`experience`, `panel`) and canonical params (`tool`, `collection`)

---

## Structural notes

### Why `importFresh()` exists (and its limits)

Several DOM tests use `importFresh()` (a cache-busting query-param import) to get fresh module state per test. This works but is a workaround for modules with import-time side effects. New code should prefer factory functions (`createFoo({ window, navigator })`) over module-level state so tests can instantiate fresh instances without cache tricks.

### What happy-dom does and does not simulate

happy-dom provides `window`, `document`, `navigator`, `localStorage`, and `requestAnimationFrame`. It does **not** implement WebGPU, WebGL, AudioContext, or real layout. Tests that need GPU or audio behavior must use the mock helpers in `tests/environment/webgpu.ts` and `tests/test-helpers.ts`, or go to the Playwright integration tier.

### The parity pipeline is not a unit test

`bun run parity:suite` and `bun run parity:capture` are scripted pixel-comparison workflows, not `bun test` files. They require a running dist and produce artifacts in `output/playwright/`. Treat them as a manual sign-off step before parity-related PRs, not as part of the daily test loop.

---

## Related docs

- [`QA_PLAN.md`](./QA_PLAN.md) — high-value flows and manual smoke checklist
- [`VERIFICATION_MATRIX.md`](./VERIFICATION_MATRIX.md) — feature-level verification mapping
- [`MANUAL_SMOKE_BASELINE.md`](./MANUAL_SMOKE_BASELINE.md) — artifact-capture and sign-off checklist for milestone refactors
- [`RECURRING_FIX_PATTERNS_AUDIT_2026-05.md`](./RECURRING_FIX_PATTERNS_AUDIT_2026-05.md) — root cause analysis for the recurring regression clusters
