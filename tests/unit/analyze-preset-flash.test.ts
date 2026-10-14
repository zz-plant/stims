/**
 * The corpus flash audit's bookkeeping, apart from the browser capture:
 * where each run writes its report, and which run of a `--repeat` capture a
 * report speaks for. Both decide whether a measurement survives to the
 * catalog's photosensitivity warning.
 */
import { describe, expect, test } from 'bun:test';
import type { FlashAnalysis } from 'flash-guard';
import { medianRun, parseArgs } from '../../scripts/analyze-preset-flash.ts';

describe('report path', () => {
  test('an unsharded run keeps the default file', () => {
    expect(parseArgs(['--all']).out).toBe('flash-audit.json');
  });

  test('concurrent shards without --out write distinct files', () => {
    // Each run rewrites its report after every preset, so shards sharing a
    // file left only the last writer's results.
    const outs = [1, 2, 3, 4].map(
      (k) => parseArgs(['--all', `--shard=${k}/4`]).out,
    );
    expect(new Set(outs).size).toBe(4);
    expect(outs[1]).toBe('flash-audit.shard-2-of-4.json');
  });

  test('--out still names the file, sharded or not', () => {
    expect(parseArgs(['--shard=2/4', '--out=mine.json']).out).toBe('mine.json');
  });
});

function analysis(
  peakFlashesPerSecond: number,
  peakRedFlashesPerSecond: number,
): FlashAnalysis {
  return {
    peakFlashesPerSecond,
    totalFlashes: peakFlashesPerSecond * 2,
    exceedsThreshold: peakFlashesPerSecond > 3,
    peakRedFlashesPerSecond,
    totalRedFlashes: peakRedFlashesPerSecond * 2,
    exceedsRedThreshold: peakRedFlashesPerSecond > 3,
    motionEnergy: 0,
    luminanceVolatility: 0,
    maxFlashLuminanceDelta: 0,
    meanLuminance: 0,
    frameCount: 300,
  };
}

describe('the run a --repeat report speaks for', () => {
  test('each channel reports its own median run', () => {
    // The general median (4/s) is the run with the lowest red peak. Taking
    // its red figure would report 0 red flashes when the median is 4/s, over
    // the limit, and the catalog would show no warning.
    const attempts = [
      { id: 'a', analysis: analysis(3, 6) },
      { id: 'b', analysis: analysis(4, 0) },
      { id: 'c', analysis: analysis(5, 4) },
    ];
    const { run, analysis: reported } = medianRun(attempts);
    expect(run.id).toBe('b');
    expect(reported.peakFlashesPerSecond).toBe(4);
    expect(reported.peakRedFlashesPerSecond).toBe(4);
    expect(reported.totalRedFlashes).toBe(8);
    expect(reported.exceedsRedThreshold).toBe(true);
  });

  test('a single run reports itself', () => {
    const only = { analysis: analysis(2, 1) };
    expect(medianRun([only])).toEqual({ run: only, analysis: only.analysis });
  });
});
