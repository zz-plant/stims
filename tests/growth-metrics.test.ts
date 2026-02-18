import { beforeEach, describe, expect, test } from 'bun:test';

import {
  getGrowthSnapshot,
  recordLibraryVisit,
  recordToyOpen,
} from '../assets/js/utils/growth-metrics.ts';

describe('growth metrics', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('tracks active days and toy opens', () => {
    recordLibraryVisit();
    recordToyOpen('aurora-painter', 'library');

    const snapshot = getGrowthSnapshot();
    expect(snapshot.weeklyActiveDays).toBeGreaterThanOrEqual(1);
    expect(snapshot.toyOpens).toBe(1);
    expect(snapshot.recentToySlugs).toEqual(['aurora-painter']);
  });
});
