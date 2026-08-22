/**
 * The parity oracle's own measurement error: how much a preset's mismatch
 * ratio moves between identical runs, and what that means for a delta.
 *
 * Shared by measure-parity-noise.ts, which measures the bands, and
 * run-parity-diff-suite.ts, which uses them to decide whether a change in a
 * mismatch ratio is a result or a coin flip. The band lives in
 * src/data/milkdrop-parity/parity-noise-bands.json so it is reviewable
 * evidence rather than a constant somebody picked.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { MilkdropRenderBackend } from '../src/js/milkdrop/common-types.ts';

export const PARITY_NOISE_BANDS_PATH =
  'src/data/milkdrop-parity/parity-noise-bands.json';

export type ParityNoiseBand = {
  presetId: string;
  backend: MilkdropRenderBackend;
  /** How many captures the band was measured from. */
  repeats: number;
  /** Per-channel mismatch threshold the samples were scored with. */
  threshold: number;
  warmupFrames: number;
  /** Every measured mismatch ratio, oldest first, so the band is auditable. */
  samples: number[];
  min: number;
  max: number;
  median: number;
  mean: number;
  stdDev: number;
  /**
   * `max - min`: the smallest difference this instrument can resolve for this
   * preset. Two runs that differ by less than this differ by nothing that was
   * measured.
   */
  width: number;
  /** True when the capture host was known to be busy. Widens the band. */
  contended: boolean;
  measuredAt: string;
  note?: string;
};

export type ParityNoiseBandsFile = {
  version: 1;
  /**
   * Read by run-parity-diff-suite.ts to decide whether a change in mismatch
   * ratio is a result or a coin flip. A preset with no entry here has an
   * unknown noise floor, and the suite says so instead of implying zero.
   */
  generatedBy: 'scripts/measure-parity-noise.ts';
  bands: ParityNoiseBand[];
};

export function createEmptyParityNoiseBandsFile(): ParityNoiseBandsFile {
  return {
    version: 1,
    generatedBy: 'scripts/measure-parity-noise.ts',
    bands: [],
  };
}

export function loadParityNoiseBands(repoRoot: string): ParityNoiseBandsFile {
  const filePath = path.join(repoRoot, PARITY_NOISE_BANDS_PATH);
  if (!fs.existsSync(filePath)) {
    return createEmptyParityNoiseBandsFile();
  }
  const parsed = JSON.parse(
    fs.readFileSync(filePath, 'utf8'),
  ) as Partial<ParityNoiseBandsFile>;
  return {
    ...createEmptyParityNoiseBandsFile(),
    ...parsed,
    bands: Array.isArray(parsed.bands) ? parsed.bands : [],
  };
}

export function upsertParityNoiseBands(
  repoRoot: string,
  bands: ParityNoiseBand[],
) {
  const file = loadParityNoiseBands(repoRoot);
  const replaced = new Set(bands.map((band) => `${band.presetId}`));
  const next = file.bands
    .filter((band) => !replaced.has(band.presetId))
    .concat(bands)
    .sort((left, right) => left.presetId.localeCompare(right.presetId));
  const filePath = path.join(repoRoot, PARITY_NOISE_BANDS_PATH);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ ...file, bands: next }, null, 2)}\n`,
  );
  // The repo lints its checked-in JSON, and Biome fills number arrays in a way
  // JSON.stringify does not reproduce. Format on write so a calibration run
  // never leaves the tree failing `check:quick`.
  spawnSync('bunx', ['biome', 'format', '--write', filePath], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  return { filePath, bands: next };
}

export function summarizeNoiseSamples(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  const count = sorted.length;
  const mean = sorted.reduce((total, value) => total + value, 0) / count;
  const variance =
    sorted.reduce((total, value) => total + (value - mean) ** 2, 0) / count;
  const median =
    count % 2 === 1
      ? sorted[(count - 1) / 2]
      : (sorted[count / 2 - 1] + sorted[count / 2]) / 2;
  return {
    min: sorted[0],
    max: sorted[count - 1],
    median,
    mean,
    stdDev: Math.sqrt(variance),
    width: sorted[count - 1] - sorted[0],
  };
}

/**
 * Smallest difference between two runs that this preset's instrument can
 * resolve.
 *
 * The observed range of N captures is the honest floor, but N is small and a
 * range from a handful of samples systematically understates the real spread —
 * measured here, a 5-sample band on 100-square spanned 0.24 percentage points
 * while seven serial captures of the same build spanned 0.52. So take the
 * larger of that range and the textbook bound for the difference of two
 * independent measurements, 2 standard deviations widened by sqrt(2).
 */
export function noiseResolution(band: ParityNoiseBand) {
  return Math.max(band.width, 2 * band.stdDev * Math.SQRT2);
}

export type NoiseVerdict =
  | 'no-baseline'
  | 'noise-band-unmeasured'
  | 'no-measurable-change'
  | 'improved'
  | 'regressed';

/**
 * Judge a mismatch ratio against a baseline using the preset's own measured
 * run-to-run spread as the resolution limit.
 *
 * A delta no larger than the band width is not a result: the same build
 * produces that much movement on its own. Calling it an improvement is how
 * a null change gets reported as progress.
 */
export function judgeAgainstNoiseBand({
  current,
  baseline,
  band,
}: {
  current: number | null;
  baseline: number | null | undefined;
  band: ParityNoiseBand | null | undefined;
}): {
  verdict: NoiseVerdict;
  delta: number | null;
  resolution: number | null;
} {
  if (current === null || baseline === null || baseline === undefined) {
    return { verdict: 'no-baseline', delta: null, resolution: null };
  }
  const delta = current - baseline;
  if (!band) {
    return { verdict: 'noise-band-unmeasured', delta, resolution: null };
  }
  const resolution = noiseResolution(band);
  if (Math.abs(delta) <= resolution) {
    return { verdict: 'no-measurable-change', delta, resolution };
  }
  return { verdict: delta < 0 ? 'improved' : 'regressed', delta, resolution };
}

export function findNoiseBand(
  file: ParityNoiseBandsFile,
  presetId: string,
  backend: MilkdropRenderBackend | null,
) {
  return (
    file.bands.find(
      (band) =>
        band.presetId === presetId && (!backend || band.backend === backend),
    ) ?? null
  );
}
