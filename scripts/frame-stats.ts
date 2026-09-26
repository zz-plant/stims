/**
 * Frame-quality math for preview captures, shared by the generator
 * (scripts/generate-thumbnails.ts) and the production auditor
 * (scripts/audit-production-previews.ts).
 *
 * These thresholds are the definition of "unusable as a preview" and they
 * live in one place on purpose: an auditor that invents its own luma
 * threshold will disagree with the generator about which presets are fine,
 * and report healthy dark presets as broken.
 */
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export type FrameStats = {
  /** sha256 of the raw pixel buffer — byte-identical captures collide. */
  hash: string;
  meanLuma: number;
  maxLuma: number;
  stdLuma: number;
  /** Fraction of pixels clipped to white — high std is worthless if clipped. */
  blownFraction: number;
};

export async function analyzeFrame(buffer: Buffer): Promise<FrameStats> {
  const { data, info } = await sharp(buffer)
    .resize(96, 54)
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sumSq = 0;
  let max = 0;
  let blown = 0;
  const pixels = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    const luma =
      0.299 * data[i] + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
    sum += luma;
    sumSq += luma * luma;
    if (luma > max) max = luma;
    if (
      data[i] >= 250 &&
      (data[i + 1] ?? 0) >= 250 &&
      (data[i + 2] ?? 0) >= 250
    ) {
      blown += 1;
    }
  }
  const mean = sum / pixels;
  return {
    hash: createHash('sha256').update(data).digest('hex'),
    blownFraction: blown / pixels,
    meanLuma: mean,
    maxLuma: max,
    stdLuma: Math.sqrt(Math.max(0, sumSq / pixels - mean * mean)),
  };
}

/**
 * Useless as a preview: pure black, near-black noise, or a flat solid
 * color (including feedback loops blown out to solid white). Sparse-bright
 * presets (a few glowing shapes on black) are legitimate, so a low mean is
 * only fatal when nothing bright exists either.
 */
export function badFrameReason(stats: FrameStats): string | null {
  if (stats.maxLuma < 32 || stats.meanLuma < 0.4) {
    return `black frame (mean=${stats.meanLuma.toFixed(1)}, max=${stats.maxLuma.toFixed(0)})`;
  }
  if (stats.stdLuma < 2.5) {
    return `flat frame (mean=${stats.meanLuma.toFixed(1)}, std=${stats.stdLuma.toFixed(1)})`;
  }
  return null;
}

// The same score the in-page checkpoint search maximizes. Structure (std) is
// what makes a thumbnail readable, scaled down for frames that are technically
// lit but almost empty, penalized for clipping (a white blob on black scores
// enormous std while showing nothing), and zeroed at both failure ends.
export function frameScore(stats: FrameStats): number {
  if (stats.maxLuma < 32 || stats.meanLuma > 240) return 0;
  return (
    stats.stdLuma *
    Math.min(1, stats.meanLuma / 8) *
    (1 - Math.min(1, stats.blownFraction)) ** 2
  );
}
