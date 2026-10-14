/**
 * The quality score's flash component, read from the catalog's merged audit
 * verdict (`sensoryProfile`). It used to read `exceedsThreshold` off scratch
 * reports, which ignored the red-flash channel and defaulted every
 * unmeasured preset to a clean 0.
 */
import { describe, expect, test } from 'bun:test';
import { flashPenaltyFor } from '../../scripts/score-catalog-quality.ts';
import { toSensoryProfile } from '../../src/js/core/sensory-profile.ts';

const measured = (peakFlashesPerSecond: number, peakRedFlashesPerSecond = 0) =>
  toSensoryProfile(
    {
      peakFlashesPerSecond,
      peakRedFlashesPerSecond,
      meanLuminance: 0.2,
      luminanceVolatility: 0.01,
    },
    '2026-10-13T00:00:00.000Z',
  );

describe('flashPenaltyFor', () => {
  test('a preset over the WCAG limit is penalised', () => {
    expect(flashPenaltyFor(measured(17))).toBe(0.5);
  });

  test('red flashes alone over the limit are penalised', () => {
    expect(flashPenaltyFor(measured(0, 5))).toBe(0.5);
  });

  test('a preset measured at or under the limit carries no penalty', () => {
    expect(flashPenaltyFor(measured(3))).toBe(0);
    expect(flashPenaltyFor(measured(0))).toBe(0);
  });

  test('an unmeasured preset is null, not a clean 0', () => {
    expect(flashPenaltyFor(undefined)).toBeNull();
  });
});
