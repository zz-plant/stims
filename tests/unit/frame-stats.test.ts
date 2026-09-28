/**
 * `frame-stats.ts` is the single definition of "unusable as a preview", shared
 * by the generator and the production auditor precisely so the two cannot
 * disagree about which presets are broken. That makes these thresholds the most
 * load-bearing numbers in the preview pipeline: too strict and a sweep
 * recaptures hundreds of good presets, too lax and black cards ship.
 *
 * The failure this file guards is specific and expensive. A mean-only
 * readability check flags every sparse-bright preset — a few glowing shapes on
 * black, which is what a lot of this catalog looks like — as broken, because
 * the *average* pixel is dark. The checks are therefore expressed in terms of
 * "is anything there at all" (max luma) plus "is there structure" (std), never
 * mean alone. Each case below builds a real PNG at the analysis resolution, so
 * the assertions run against the same decode path the pipeline runs against.
 */
import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import {
  analyzeFrame,
  badFrameReason,
  type FrameStats,
  frameScore,
} from '../../scripts/frame-stats.ts';

/** The size analyzeFrame resizes to, so fixtures decode 1:1 with no filtering. */
const W = 96;
const H = 54;

type Fill = (x: number, y: number) => [number, number, number];

/** A handful of bright pixels on black — a wireframe, a few stars, a logo. */
const sparseBright: Fill = (x, y) =>
  x < 10 && y < 10 ? [255, 255, 255] : [0, 0, 0];

/** Encodes a pixel function as a real PNG. */
const png = async (fill: Fill): Promise<Buffer> => {
  const raw = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fill(x, y);
      const i = (y * W + x) * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  return await sharp(Buffer.from(raw), {
    raw: { width: W, height: H, channels: 3 },
  })
    .png()
    .toBuffer();
};

/** Encodes and measures in one step, the way the generator does. */
const frame = async (fill: Fill): Promise<FrameStats> =>
  await analyzeFrame(Buffer.from(await png(fill)));

describe('analyzeFrame', () => {
  test('measures a sparse-bright frame as dark-but-alive', async () => {
    const stats = await frame(sparseBright);

    // 100 hot pixels of 5184: the mean *is* low, which is the whole point.
    expect(stats.meanLuma).toBeLessThan(8);
    expect(stats.maxLuma).toBe(255);
    expect(stats.stdLuma).toBeGreaterThan(2.5);
  });

  test('identical pixels hash identically, different pixels do not', async () => {
    const a = await frame(sparseBright);
    const b = await frame(sparseBright);
    const c = await frame(() => [0, 0, 0]);

    // The auditor decides "already published" from this hash alone, so it has
    // to be stable across runs and distinct across captures.
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });
});

describe('badFrameReason', () => {
  test('accepts a sparse-bright frame that is mostly black', async () => {
    // A mean-only check reports this as broken: mean 4.9 out of 255.
    const stats = await frame(sparseBright);

    expect(badFrameReason(stats)).toBeNull();
    expect(frameScore(stats)).toBeGreaterThan(0);
  });

  test('rejects a pure black frame', async () => {
    const stats = await frame(() => [0, 0, 0]);

    expect(badFrameReason(stats)).toMatch(/^black frame/);
    expect(frameScore(stats)).toBe(0);
  });

  test('rejects a flat frame that is lit but has no structure', async () => {
    // The lit-but-empty case: a solid color is not evidence of a render. This
    // is also what a blown-out feedback loop looks like — solid white, no std.
    const gray = await frame(() => [128, 128, 128]);
    const white = await frame(() => [255, 255, 255]);

    expect(badFrameReason(gray)).toMatch(/^flat frame/);
    expect(badFrameReason(white)).toMatch(/^flat frame/);
    // std is 0 in exact arithmetic; the sampled sum leaves a residue far below
    // any threshold that could reorder two real captures.
    expect(frameScore(gray)).toBeLessThan(0.01);
    expect(frameScore(white)).toBeLessThan(0.01);
  });

  test('rejects a near-black frame that has noise but no highlight', () => {
    // The mirror of the sparse-bright case above: same std, nothing bright.
    // Mean cannot separate those two frames; maxLuma can.
    const dim: FrameStats = {
      hash: 'dim',
      meanLuma: 6,
      maxLuma: 20,
      stdLuma: 5,
      blownFraction: 0,
    };

    expect(badFrameReason(dim)).toMatch(/^black frame/);
    expect(frameScore(dim)).toBe(0);
  });
});

describe('frameScore', () => {
  test('penalises a clipped frame, which can score a huge std and show nothing', async () => {
    // One level apart on the highlight, 249 → 250, straddling the clip
    // threshold. Everything else — geometry, mean, std — is the same frame, so
    // the only thing the two scores can differ on is the clipping penalty.
    const clean = await frame((x) => (x < 48 ? [0, 0, 0] : [249, 249, 249]));
    const clipped = await frame((x) => (x < 48 ? [0, 0, 0] : [250, 250, 250]));

    expect(clean.blownFraction).toBe(0);
    expect(clipped.blownFraction).toBeGreaterThan(0.4);
    expect(clean.stdLuma).toBeGreaterThan(100);
    expect(Math.abs(clean.stdLuma - clipped.stdLuma)).toBeLessThan(1);
    // Both have std ~125, which alone would make the clipped one look like the
    // better card. Without the penalty they would score within a percent of
    // each other.
    expect(frameScore(clipped)).toBeLessThan(frameScore(clean) / 2);
  });

  test('scales an almost-empty frame down rather than rewarding it', () => {
    const shared = { maxLuma: 200, blownFraction: 0 };
    const empty: FrameStats = {
      ...shared,
      hash: 'e',
      meanLuma: 1,
      stdLuma: 40,
    };
    const full: FrameStats = {
      ...shared,
      hash: 'f',
      meanLuma: 40,
      stdLuma: 40,
    };

    expect(frameScore(empty)).toBeLessThan(frameScore(full));
  });

  test('zeroes a frame whose mean is blown out', () => {
    const washedOut: FrameStats = {
      hash: 'w',
      meanLuma: 241,
      maxLuma: 255,
      stdLuma: 30,
      blownFraction: 0.5,
    };

    expect(frameScore(washedOut)).toBe(0);
  });
});
