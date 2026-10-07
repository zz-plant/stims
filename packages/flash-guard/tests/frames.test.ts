/**
 * The pixel frontend is judged against the luminance-grid path: the same
 * strobe, described once as RGBA bytes and once as luminance tiles, must
 * produce the same flash rate. Then the things only pixels can show: the
 * visual-field window on a partial-screen strobe, and the red-flash channel.
 */
import { describe, expect, test } from 'bun:test';
import {
  analyzeFlashTimeline,
  analyzeRgbaFrames,
  createFlashFrameCounter,
  LINEAR_CHANNEL_LUT,
  linearizeChannel,
  relativeLuminance,
} from '../src/index.ts';

const W = 64;
const H = 36;
const FRAME_MS = 1000 / 60;

type Rgb = [number, number, number];

/** A frame painted `fill` everywhere, with an optional rectangle in `paint`. */
function frame(
  fill: Rgb,
  rect?: { x: number; y: number; w: number; h: number; paint: Rgb },
): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const inRect =
        rect &&
        x >= rect.x &&
        x < rect.x + rect.w &&
        y >= rect.y &&
        y < rect.y + rect.h;
      const [r, g, b] = inRect ? (rect as { paint: Rgb }).paint : fill;
      const o = (y * W + x) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = 255;
    }
  }
  return px;
}

/** Alternates between two painters every `period` frames. */
function strobe(
  count: number,
  period: number,
  off: () => Uint8Array,
  on: () => Uint8Array,
) {
  const frames: Uint8Array[] = [];
  for (let f = 0; f < count; f += 1) {
    frames.push(Math.floor(f / period) % 2 === 1 ? on() : off());
  }
  return frames;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

describe('luminance table', () => {
  test('matches the transfer function at every byte', () => {
    for (let byte = 0; byte < 256; byte += 1) {
      expect(LINEAR_CHANNEL_LUT[byte]).toBe(linearizeChannel(byte));
    }
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 9);
  });
});

describe('analyzeRgbaFrames', () => {
  test('a full-field strobe scores the same as its luminance timeline', () => {
    // 5 frames on, 5 off at 60 fps: a luminance change every 5 frames, and
    // every change after the first completes an opposing pair, so 12 flashes
    // a second (a 6 Hz square wave is 12 flashes, not 6).
    const frames = strobe(
      120,
      5,
      () => frame(BLACK),
      () => frame(WHITE),
    );
    const fromPixels = analyzeRgbaFrames(frames, {
      width: W,
      height: H,
      deltaMs: FRAME_MS,
      cols: 16,
      rows: 9,
      stride: 1,
    });
    const tiles = 16 * 9;
    const fromLuminance = analyzeFlashTimeline({
      frames: frames.map((f) => new Array(tiles).fill(f[0] === 255 ? 1 : 0)),
      deltaMs: FRAME_MS,
      cols: 16,
      rows: 9,
    });
    expect(fromPixels.peakFlashesPerSecond).toBe(
      fromLuminance.peakFlashesPerSecond,
    );
    expect(fromPixels.totalFlashes).toBe(fromLuminance.totalFlashes);
    expect(fromPixels.peakFlashesPerSecond).toBe(12);
    expect(fromPixels.exceedsThreshold).toBe(true);
    expect(fromPixels.frameCount).toBe(120);
    expect(fromPixels.meanLuminance).toBeCloseTo(0.5, 2);
  });

  test('a strobe covering a third of the screen fails, a sixteenth passes', () => {
    // The visual field is a third of each axis. A rectangle a third wide and
    // a third tall fills one window completely; a 1/4 x 1/4 rectangle
    // covers 9/16 of a window, still over 25%; a 1/8 x 1/8 one covers 9/64,
    // about 14%, under the line.
    const score = (w: number, h: number) =>
      analyzeRgbaFrames(
        strobe(
          120,
          5,
          () => frame(BLACK),
          () => frame(BLACK, { x: 0, y: 0, w, h, paint: WHITE }),
        ),
        {
          width: W,
          height: H,
          deltaMs: FRAME_MS,
          cols: 32,
          rows: 18,
          stride: 1,
        },
      );
    expect(score(W / 3, H / 3).exceedsThreshold).toBe(true);
    expect(score(W / 4, H / 4).exceedsThreshold).toBe(true);
    expect(score(W / 8, H / 8).exceedsThreshold).toBe(false);
    // The small one is still a tenth of the screen; whole-screen area
    // tests would also pass it, so the discriminating case is the quarter.
    expect(score(W / 4, H / 4).peakFlashesPerSecond).toBe(12);
  });

  test('a red flash is counted on the red channel even at equal luminance', () => {
    // Pure red has relative luminance 0.2126. Grey 127 has 0.2122: the swing
    // is far under the 0.1 general threshold, so only the red criterion can
    // see this strobe.
    const RED: Rgb = [255, 0, 0];
    const GREY: Rgb = [127, 127, 127];
    expect(
      Math.abs(relativeLuminance(...RED) - relativeLuminance(...GREY)),
    ).toBeLessThan(0.01);
    const result = analyzeRgbaFrames(
      strobe(
        120,
        5,
        () => frame(GREY),
        () => frame(RED),
      ),
      { width: W, height: H, deltaMs: FRAME_MS, stride: 1 },
    );
    expect(result.peakFlashesPerSecond).toBe(0);
    expect(result.exceedsThreshold).toBe(false);
    expect(result.peakRedFlashesPerSecond).toBe(12);
    expect(result.exceedsRedThreshold).toBe(true);
  });

  test('a monotonic fade is motion, not flashing', () => {
    const frames: Uint8Array[] = [];
    for (let f = 0; f < 60; f += 1) {
      const v = Math.round((f / 59) * 255);
      frames.push(frame([v, v, v]));
    }
    const result = analyzeRgbaFrames(frames, {
      width: W,
      height: H,
      deltaMs: FRAME_MS,
    });
    expect(result.totalFlashes).toBe(0);
    expect(result.motionEnergy).toBeGreaterThan(0);
  });

  test('stride samples fewer pixels but the same tiles', () => {
    const full = createFlashFrameCounter({
      width: W,
      height: H,
      deltaMs: FRAME_MS,
      stride: 1,
    });
    const sparse = createFlashFrameCounter({
      width: W,
      height: H,
      deltaMs: FRAME_MS,
      stride: 2,
    });
    expect(sparse.cols).toBe(full.cols);
    expect(sparse.rows).toBe(full.rows);
    expect(sparse.tilePixels * 4).toBe(full.tilePixels);
    for (const f of strobe(
      30,
      5,
      () => frame(BLACK),
      () => frame(WHITE),
    )) {
      full.push(f);
      sparse.push(f);
    }
    expect(sparse.analyze().totalFlashes).toBe(full.analyze().totalFlashes);
  });

  test('defaults the grid to the frame aspect and rejects short frames', () => {
    const counter = createFlashFrameCounter({
      width: 320,
      height: 180,
      deltaMs: FRAME_MS,
    });
    expect(counter.cols).toBe(32);
    expect(counter.rows).toBe(18);
    expect(() => counter.push(new Uint8Array(10))).toThrow(/expected at least/);
    expect(() =>
      createFlashFrameCounter({ width: 0, height: 10, deltaMs: FRAME_MS }),
    ).toThrow(/positive/);
  });

  test('reset forgets the frames pushed so far', () => {
    const counter = createFlashFrameCounter({
      width: W,
      height: H,
      deltaMs: FRAME_MS,
    });
    for (const f of strobe(
      60,
      5,
      () => frame(BLACK),
      () => frame(WHITE),
    ))
      counter.push(f);
    expect(counter.analyze().totalFlashes).toBeGreaterThan(0);
    counter.reset();
    expect(counter.frameCount).toBe(0);
    expect(counter.analyze().totalFlashes).toBe(0);
  });
});
