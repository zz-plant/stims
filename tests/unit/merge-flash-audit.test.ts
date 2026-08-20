import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toMeasurement } from '../../scripts/merge-flash-audit.ts';

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

  test('rejects a report with no red-flash channel', () => {
    const { peakRedFlashesPerSecond: _omitted, ...noRed } = complete;
    expect(toMeasurement(noRed)).toBeNull();
  });

  test('rejects a failed run even when some numbers are present', () => {
    expect(toMeasurement({ ...complete, error: 'timeout' })).toBeNull();
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
