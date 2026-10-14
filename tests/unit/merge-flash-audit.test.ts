import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  combineMeasurements,
  toMeasurement,
} from '../../scripts/merge-flash-audit.ts';
import { classifyFlashRisk } from '../../src/js/core/sensory-profile.ts';

/**
 * The merge step decides which measurements are allowed to become a shipped
 * photosensitivity claim. Its one non-obvious rule is that an incomplete
 * measurement is rejected outright rather than defaulted: a report with no
 * red-flash figure must not merge as though the red channel had been checked
 * and come back clean.
 *
 * tests/fixtures/flash-audit/pre-red-channel-sample.json is an excerpt of a real
 * report from before that channel existed, so it doubles as the fixture for
 * exactly that case.
 */

describe('toMeasurement', () => {
  const complete = {
    presetId: 'x',
    peakFlashesPerSecond: 1,
    peakRedFlashesPerSecond: 0,
    meanLuminance: 0.3,
    luminanceVolatility: 0.02,
  };

  test('accepts a complete report', () => {
    expect(toMeasurement(complete)).toEqual({
      peakFlashesPerSecond: 1,
      peakRedFlashesPerSecond: 0,
      meanLuminance: 0.3,
      luminanceVolatility: 0.02,
    });
  });

  test('passes the flash swing through when the report has one', () => {
    expect(
      toMeasurement({ ...complete, maxFlashLuminanceDelta: 0.5 })
        ?.maxFlashLuminanceDelta,
    ).toBe(0.5);
    // Older reports lack it; they still merge, without a swing.
    expect(toMeasurement(complete)).not.toHaveProperty(
      'maxFlashLuminanceDelta',
    );
  });

  test('rejects a report with no red-flash channel', () => {
    const { peakRedFlashesPerSecond: _omitted, ...noRed } = complete;
    expect(toMeasurement(noRed)).toBeNull();
  });

  test('rejects a failed run even when some numbers are present', () => {
    expect(toMeasurement({ ...complete, error: 'timeout' })).toBeNull();
  });

  test('rejects a capture that stayed black or white and still', () => {
    // eos-heater-core-c before its feedback built up, and a white-out.
    expect(
      toMeasurement({
        ...complete,
        peakFlashesPerSecond: 0,
        meanLuminance: 0.0011,
        luminanceVolatility: 0.0001,
      }),
    ).toBeNull();
    expect(
      toMeasurement({
        ...complete,
        peakFlashesPerSecond: 0,
        meanLuminance: 1,
        luminanceVolatility: 0,
      }),
    ).toBeNull();
  });

  test('keeps a dark preset that moves', () => {
    expect(
      toMeasurement({
        ...complete,
        meanLuminance: 0.0019,
        luminanceVolatility: 0.0021,
      }),
    ).not.toBeNull();
  });

  test('rejects reports missing luminance figures', () => {
    const { meanLuminance: _a, ...noLuminance } = complete;
    expect(toMeasurement(noLuminance)).toBeNull();
  });
});

describe('the pre-red-channel report is refused wholesale', () => {
  test('every row of the legacy sample is unusable', () => {
    const path = join(
      import.meta.dir,
      '..',
      'fixtures',
      'flash-audit',
      'pre-red-channel-sample.json',
    );
    const reports = (
      JSON.parse(readFileSync(path, 'utf8')) as {
        reports: Parameters<typeof toMeasurement>[0][];
      }
    ).reports;

    expect(reports.length).toBeGreaterThan(0);
    // Some of these rows completed successfully and carry real general-channel
    // numbers. They are still refused, because merging them would publish a
    // red-flash verdict nobody measured.
    const succeeded = reports.filter((r) => !r.error);
    expect(succeeded.length).toBeGreaterThan(0);
    expect(reports.every((r) => toMeasurement(r) === null)).toBe(true);
  });
});

describe('combineMeasurements', () => {
  const at60 = {
    peakFlashesPerSecond: 0,
    peakRedFlashesPerSecond: 2,
    meanLuminance: 0.2,
    luminanceVolatility: 0.01,
  };
  const at30 = {
    peakFlashesPerSecond: 8,
    peakRedFlashesPerSecond: 0,
    meanLuminance: 0.4,
    luminanceVolatility: 0.03,
  };

  test('a preset calm at 60 fps and flashing at 30 is judged by the 30', () => {
    expect(classifyFlashRisk(at60)).toBe('medium');
    expect(classifyFlashRisk(combineMeasurements([at60, at30]))).toBe('high');
  });

  test('each channel keeps its own worst rate', () => {
    const calm = {
      peakFlashesPerSecond: 0,
      peakRedFlashesPerSecond: 0,
      meanLuminance: 0.3,
      luminanceVolatility: 0,
    };
    const combined = combineMeasurements([calm, at60, at30]);
    expect(combined.peakFlashesPerSecond).toBe(8);
    expect(combined.peakRedFlashesPerSecond).toBe(2);
    expect(combined.luminanceVolatility).toBe(0.03);
    expect(combined.meanLuminance).toBeCloseTo(0.3);
  });

  test('one measurement passes through unchanged', () => {
    expect(combineMeasurements([at30])).toEqual(at30);
  });
});
