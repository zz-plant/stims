import { describe, expect, test } from 'bun:test';
import { shouldEnableStatsOverlay } from '../../src/js/core/stats-overlay.ts';

describe('stats overlay gating', () => {
  test('enables the overlay when the stats query param is present', () => {
    expect(shouldEnableStatsOverlay({ search: '?stats=1' })).toBe(true);
  });

  test('disables the overlay when the query param forces it off', () => {
    expect(
      shouldEnableStatsOverlay({
        search: '?stats=0',
        storageValue: '1',
      }),
    ).toBe(false);
  });

  test('falls back to the persisted debug flag', () => {
    expect(shouldEnableStatsOverlay({ storageValue: '1' })).toBe(true);
    expect(shouldEnableStatsOverlay({ storageValue: null })).toBe(false);
  });
});
