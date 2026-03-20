import { describe, expect, test } from 'bun:test';

describe('mobile-ripples toy module', () => {
  test('exports a callable start function', async () => {
    const moduleExports = await import('../assets/js/toys/mobile-ripples.ts');
    const moduleRecord = moduleExports as {
      start?: unknown;
      default?: { start?: unknown };
    };
    const startCandidate = moduleRecord.start ?? moduleRecord.default?.start;

    expect(typeof startCandidate).toBe('function');
  });
});
