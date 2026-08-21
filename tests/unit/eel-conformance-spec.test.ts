/**
 * EEL platform-profile conformance.
 *
 * The cases themselves live in `spec/eel-conformance/cases/*.json` — portable
 * data, deliberately not TypeScript, so a projectM or Butterchurn port can run
 * the same corpus without importing anything from this repo. This suite is one
 * consumer of it: it runs every case against all three execution tiers so
 * `bun run check` fails the moment a tier drifts from the specification.
 *
 * Unlike the tier-differential fuzz suites (which only assert tiers AGREE),
 * each case pins an ABSOLUTE expected value. Two tiers can agree and both be
 * wrong; that is how the case-insensitivity bug survived until this corpus
 * was written.
 *
 * Cases marked `provisional` record what this implementation does without
 * confirming it against ns-eel. They are still enforced — drifting from them
 * unnoticed would be worse — but README.md lists them as open questions, and
 * changing one is a platform-semantics decision, not a test fix.
 */
import { describe, expect, test } from 'bun:test';
import {
  type EelConformanceCase,
  loadEelConformanceCases,
} from '../../spec/eel-conformance/index.ts';
import {
  EEL_CONFORMANCE_TIERS,
  runConformanceCase,
} from '../../spec/eel-conformance/reference-runner.ts';

const CASES = loadEelConformanceCases();

/**
 * Re-exported for tests that need the corpus but not the per-tier run —
 * currently tests/unit/eel-csp-fallback.test.ts.
 */
export const SPEC: EelConformanceCase[] = CASES;

describe('EEL platform-profile conformance', () => {
  test('the corpus is non-empty and every case is identified', () => {
    expect(CASES.length).toBeGreaterThan(0);
    const ids = CASES.map((c) => `${c.section}/${c.id}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const tier of EEL_CONFORMANCE_TIERS) {
    for (const specCase of CASES) {
      const label = `${specCase.section}/${specCase.id}: ${specCase.name} [${tier}]`;
      test(label, () => {
        const outcome = runConformanceCase(specCase, tier);
        if (outcome.status === 'skip') {
          expect(outcome.skipReason).toBeTruthy();
          return;
        }
        expect(outcome.failures.join('\n')).toBe('');
      });
    }
  }
});
