import { describe, expect, test } from 'bun:test';

const FOOTWORK_TOYS = [
  ['battle-fan', '../assets/js/toys/battle-fan.ts'],
  ['heel-toe-comets', '../assets/js/toys/heel-toe-comets.ts'],
  ['juke-grid', '../assets/js/toys/juke-grid.ts'],
] as const;

describe('footwork toy modules', () => {
  test('export callable start functions', async () => {
    for (const [_slug, modulePath] of FOOTWORK_TOYS) {
      const moduleExports = await import(modulePath);
      const moduleRecord = moduleExports as {
        start?: unknown;
        default?: { start?: unknown };
      };
      const startCandidate = moduleRecord.start ?? moduleRecord.default?.start;

      expect(typeof startCandidate).toBe('function');
    }
  });
});
