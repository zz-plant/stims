# Testing

Use the root test wrapper to select profiles and isolate browser-backed files. Package suites have their own Bun configuration and run separately through `bun run check:packages`.

## Runner and environment

[Bun](https://bun.sh) runs the tests. `bunfig.toml` preloads `tests/setup.ts`, which installs happy-dom globals and simulation helpers. There is no test import map. happy-dom supplies DOM APIs; it does not provide real layout, Web Audio, WebGL, or WebGPU. Mocks establish local logic contracts, while Playwright tests establish browser behavior within their tested environment.

Test files live under `tests/unit`, `tests/compat`, `tests/corpus`, or `tests/e2e`. The runner rejects uncategorized root test files so they cannot silently miss every profile. It recognizes both `.test.ts` and `.test.tsx` files.

## Select a profile

| Command | Coverage |
| --- | --- |
| `bun run test` or `bun run test:fast` | Unit + compatibility; default profile is `fast` |
| `bun run test:unit` | Unit only |
| `bun run test:compat` | Compatibility only |
| `bun run test:corpus` | Corpus and parity contracts |
| `bun run test:gate` | Unit + compatibility + corpus |
| `bun run test:e2e` | Browser end-to-end suites |
| `bun run test:integration` | Only `tests/e2e/agent-integration.test.ts` |
| `bun run test -- --profile all` | All four categories |
| `bun run test -- tests/unit/frontend-url-state.test.ts` | A selected file |
| `bun run test:changed` | Affected tests in the default fast profile |
| `bun run check:packages` | Standalone package typechecks and tests |

The runner uses parallel execution for ordinary files. `STIMS_TEST_SHARDS` controls parallelism; `1` disables it. Browser-backed files marked with `browserTest` run in separate serial passes, including browser files within the corpus category. E2E files are serial. Install supported Playwright browsers before expecting browser coverage; a skipped browser test is not a passing browser verification.

Use `--no-bail` to report failures beyond the first failing file, `--timeout <ms>` to set the default test timeout, and `--junit-dir <directory>` to write per-pass reports. Explicit per-test timeouts remain effective.

## Quality gates

| Command | Checks and tests |
| --- | --- |
| `bun run check:quick` | Changed-file lint, types, assets, and guard checks; no root test suite |
| `bun run check` | Full Biome check, types, guards, package checks, then `test:gate` |
| `bun run check:all` | Full checks, then all profiles including E2E |
| `bun run verify --changed` | Scoped verification chosen from changed files |

The gate runs preflight checks, concurrent checks that fail fast, and a postflight test pass. `scripts/run-quality-gate.ts` owns the check list; [generated guardrails](./GUARDRAILS.md) explain each guard. Use `--quiet` for compact passing output. CI uses `--no-tests` because test jobs run separately.

For docs-only changes, run `bun run check:doc-references` and `bun run check:readme-claims`. Also verify the behavior of commands you change and check any generated documentation affected by the edit.

## CI coverage

`.github/workflows/ci.yml` classifies changed paths. Quality checks, production build, and bundle budget run for documentation changes as well. Browser-heavy and test jobs are conditional on code changes; unknown paths are treated as code changes. The workflow owns the precise matrix and aggregate status. Documentation-only PRs do not automatically receive every browser check.

Cloudflare Workers Builds owns preview and production deployment on pushes; GitHub Actions checks are not deployment proof.

## Choose evidence for the change

| Change | Useful verification |
| --- | --- |
| Shell, routing, shared links | URL-state unit tests; browser integration; fresh-load shared-link tests |
| Editor | Compiler/editor contracts plus real apply, undo, export, and share flows |
| Audio lifecycle | Worklet and handler tests plus permission/input checks in a real browser |
| Renderer or fallback | Both backends, capability tests, rendered comparisons, and integration |
| Compiler or EEL semantics | Package suite, compatibility + corpus tests, tier differential tests |
| Capture | Inspect a downloaded recording's encoded size, audio, and frame pacing |
| Public copy or generated docs | Claim/reference guards and the affected generator's check mode |

Before changing expression execution, inspect `tests/unit/eel-tier-differential.test.ts` and `tests/unit/gpu-field-tier-differential.test.ts`. They compare execution tiers; a mismatch is a semantic divergence that needs investigation.

Use factory functions with injected dependencies for new isolated tests. Existing `importFresh()` calls work around module state and should not become the default design. Assert behavior, numeric output, or AST/IR structure rather than source-file formatting.

## Visual parity and performance

`parity:capture`, `parity:diff`, and `parity:suite` produce rendered artifacts and comparison reports. Certification target membership, an imported reference, and a measured pass are different evidence. Keep inputs, capture timing, backend, and provenance aligned before promoting a result. See [development capture workflow](./DEVELOPMENT.md#compatibility-capture-workflow) and the [parity plan](./MILKDROP_PROJECTM_PARITY_PLAN.md).

Performance reports are browser measurements. Hold preset, audio, viewport, backend, quality, warmup, capture window, and CPU throttle constant. Unit tests or a successful page load do not establish an FPS improvement. See [runtime performance evidence](./RUNTIME_PERFORMANCE.md).

For user-flow sign-off, use the [QA plan](./QA_PLAN.md), [verification matrix](./VERIFICATION_MATRIX.md), and [manual smoke baseline](./MANUAL_SMOKE_BASELINE.md). Record which browser checks ran and which were skipped.
