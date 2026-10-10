/**
 * The link-reach lab's numbers are what the "Share-link reach" roadmap
 * decision is made on, so the math that produces them is pinned here:
 * fit counting against the shipped budget, rescue/fail-both classification,
 * and the shape of the human summary.
 */
import { describe, expect, test } from 'bun:test';
import {
  formatReachReportText,
  measurePresetReach,
  summarizeReach,
} from '../../scripts/preset-lab-link-reach.ts';
import { MAX_REMIX_URL_LENGTH } from '../../src/js/frontend/url-state.ts';

/** Pseudo-varied digits: deflate cannot fold repeated runs away, which a
 * fail-both fixture needs — plain 'yyyy…' compresses to almost nothing. */
function incompressibleFiller(lines: number): string {
  const out: string[] = [];
  for (let index = 0; index < lines; index += 1) {
    out.push(
      `// ${index} ${(index * 7919) % 99_991} ${(index * 10_007) % 99_989}`,
    );
  }
  return out.join('\n');
}

describe('share-link reach measurement', () => {
  test('a small source fits raw; compression only pays as the source grows', () => {
    const tiny = measurePresetReach({
      id: 'tiny',
      file: 'milkdrop-presets/tiny.milk',
      raw: '[preset00]\nzoom=1.01\n',
    });
    expect(tiny.rawFits).toBe(true);
    expect(tiny.compressedFits).toBe(true);

    // Deflate-raw is measured, not assumed — and it is not free: on a
    // tiny source the prefix and base64url expansion cost more than
    // deflate saves, so the numbers must come from a real measurement.
    const roomy = reachFor(
      'roomy',
      `[preset00]\nzoom=1.01\n${incompressibleFiller(300)}\n`,
    );
    expect(roomy.compressedLinkLength).toBeLessThan(roomy.rawLinkLength);
  });

  test('the aggregate classifies fits, rescues, and fail-both', () => {
    // One preset per band, chosen against MAX_REMIX_URL_LENGTH: one that
    // fits raw, one the raw encoding cannot carry but compression can, and
    // one whose payload is too large for either.
    const fitsRaw = reachFor(
      'small',
      `[preset00]\nzoom=1.01\n// ${incompressibleFiller(200)}\n`,
    );
    const rescued = reachFor(
      'rescued',
      `[preset00]\nzoom=1.01\n// ${incompressibleFiller(1_000)}\n`,
    );
    const hopeless = reachFor(
      'hopeless',
      `[preset00]\nzoom=1.01\n// ${incompressibleFiller(1_700)}\n`,
    );
    const report = summarizeReach([fitsRaw, rescued, hopeless]);

    expect(fitsRaw.rawFits).toBe(true);
    expect(rescued.rawFits).toBe(false);
    expect(rescued.compressedFits).toBe(true);
    expect(hopeless.compressedFits).toBe(false);

    expect(report.presetCount).toBe(3);
    expect(report.raw.fitCount).toBe(1);
    expect(report.compressed.fitCount).toBe(2);
    expect(report.compressionRescues).toBe(1);
    expect(report.failBoth.map((preset) => preset.id)).toEqual(['hopeless']);
  });

  test('the human summary states the budget and both encodings', () => {
    const report = summarizeReach([
      reachFor('small', '[preset00]\nzoom=1.01\n'),
      reachFor('small-2', '[preset00]\nzoom=1.02\n'),
    ]);
    const text = formatReachReportText(report);

    expect(text).toContain(`${MAX_REMIX_URL_LENGTH}`);
    expect(text).toContain('raw (today)');
    expect(text).toContain('deflate-raw + base64url');
  });

  function reachFor(id: string, raw: string) {
    return measurePresetReach({
      id,
      file: `milkdrop-presets/${id}.milk`,
      raw,
    });
  }
});
