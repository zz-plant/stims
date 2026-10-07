/**
 * The EEL conformance corpus lives in `packages/eel-conformance/`, which is
 * published to npm as `eel-conformance` so other MilkDrop implementations
 * can run the same cases. This module re-exports that package's loader so
 * the two in-repo consumers keep their import path:
 * `tests/unit/eel-conformance-spec.test.ts` (which runs every case against
 * all three execution tiers as part of `bun run check`) and
 * `scripts/eel-conformance-run.ts` (the human-facing report).
 *
 * `reference-runner.ts` beside this file is the worked example of the
 * runner contract, written against this repo's tiers. The contract itself,
 * the fixed RNG, the buffer sizes and the comparison tolerance are documented
 * in the package README and exported from its loader.
 */
export * from '../../packages/eel-conformance/src/index.ts';
