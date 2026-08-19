import { describe, expect, test } from 'bun:test';
import {
  classifyFlashRisk,
  describeFlashRisk,
  type FlashMeasurement,
  hiddenByFlashPreference,
  toSensoryProfile,
  WCAG_FLASHES_PER_SECOND_LIMIT,
  warnsForPhotosensitivity,
} from '../../src/js/core/sensory-profile.ts';

/**
 * The classifier is the only place a measurement becomes a risk band, and a
 * warning that disagrees with the filter that hides the same preset would be
 * worse than neither. These lock the bands, and — more importantly — the two
 * asymmetries that matter for a safety-adjacent feature: red flash can push a
 * preset to 'high' on its own, and an unmeasured preset is never treated as
 * calm.
 */

function measurement(over: Partial<FlashMeasurement> = {}): FlashMeasurement {
  return {
    peakFlashesPerSecond: 0,
    peakRedFlashesPerSecond: 0,
    meanLuminance: 0.2,
    luminanceVolatility: 0.01,
    ...over,
  };
}

describe('classifyFlashRisk', () => {
  test('exceeding the WCAG general threshold is high', () => {
    expect(
      classifyFlashRisk(
        measurement({
          peakFlashesPerSecond: WCAG_FLASHES_PER_SECOND_LIMIT + 0.1,
        }),
      ),
    ).toBe('high');
  });

  test('red flash alone can reach high, without any general flashing', () => {
    // Red flash is not a subset of the general count and is the more
    // dangerous channel — a preset must not pass because its general rate is
    // clean.
    expect(
      classifyFlashRisk(
        measurement({
          peakFlashesPerSecond: 0,
          peakRedFlashesPerSecond: WCAG_FLASHES_PER_SECOND_LIMIT + 0.1,
        }),
      ),
    ).toBe('high');
  });

  test('exactly at the threshold is not high, but is not dismissed either', () => {
    const atLimit = classifyFlashRisk(
      measurement({ peakFlashesPerSecond: WCAG_FLASHES_PER_SECOND_LIMIT }),
    );
    expect(atLimit).toBe('medium');
  });

  test('bands descend with activity', () => {
    expect(classifyFlashRisk(measurement({ peakFlashesPerSecond: 2.4 }))).toBe(
      'medium',
    );
    expect(classifyFlashRisk(measurement({ peakFlashesPerSecond: 0.7 }))).toBe(
      'low',
    );
    expect(classifyFlashRisk(measurement({ peakFlashesPerSecond: 0 }))).toBe(
      'none',
    );
  });
});

describe('profile construction', () => {
  test('records the worst of the two channels, not just the general one', () => {
    const profile = toSensoryProfile(
      measurement({ peakFlashesPerSecond: 1, peakRedFlashesPerSecond: 4.2 }),
      '2026-08-19T00:00:00.000Z',
    );
    expect(profile.maxTransitionsPerSecondEstimate).toBe(4.2);
    expect(profile.flashRiskLevel).toBe('high');
    expect(profile.measuredAt).toBe('2026-08-19T00:00:00.000Z');
  });

  test('carries the luminance figures through unchanged', () => {
    const profile = toSensoryProfile(
      measurement({ meanLuminance: 0.42, luminanceVolatility: 0.19 }),
      '2026-08-19T00:00:00.000Z',
    );
    expect(profile.meanLuminance).toBe(0.42);
    expect(profile.maxLuminanceDelta).toBe(0.19);
  });
});

describe('unmeasured presets are never treated as calm', () => {
  test('an absent profile does not warn — it is not a claim of safety', () => {
    expect(warnsForPhotosensitivity(undefined)).toBe(false);
  });

  test('an absent profile is not hidden by the reduce-flashing preference', () => {
    // Hiding unmeasured presets would silently shrink the catalog to whatever
    // the lab has covered, and imply the remainder had been cleared.
    expect(hiddenByFlashPreference(undefined)).toBe(false);
  });

  test('"unknown" reads as not measured, distinctly from "none"', () => {
    expect(describeFlashRisk('unknown')).toBe('Flashing not measured');
    expect(describeFlashRisk('none')).toBe('No flashing measured');
    expect(describeFlashRisk('unknown')).not.toBe(describeFlashRisk('none'));
  });

  test('only high-risk presets warn and are filtered', () => {
    const at = (flashRiskLevel: 'none' | 'low' | 'medium' | 'high') =>
      toSensoryProfile(
        measurement({
          peakFlashesPerSecond:
            flashRiskLevel === 'high'
              ? 5
              : flashRiskLevel === 'medium'
                ? 2.2
                : flashRiskLevel === 'low'
                  ? 0.5
                  : 0,
        }),
        '2026-08-19T00:00:00.000Z',
      );
    expect(warnsForPhotosensitivity(at('high'))).toBe(true);
    expect(warnsForPhotosensitivity(at('medium'))).toBe(false);
    expect(hiddenByFlashPreference(at('high'))).toBe(true);
    expect(hiddenByFlashPreference(at('none'))).toBe(false);
  });
});
