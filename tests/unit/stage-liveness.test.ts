/**
 * Attract mode boots the engine purely to put visuals behind the landing
 * card. When that render is blank the page pays a GPU device and a full-rate
 * render loop to composite nothing, so the runtime checks and pauses it.
 *
 * The check has one dangerous failure mode: compositing a WebGPU canvas into
 * a 2D canvas can return fully transparent pixels instead of the frame, which
 * looks exactly like a black image. Condemning a working render on that
 * evidence would break the landing page for everyone it currently works for,
 * so "no alpha anywhere" must report unknown, never blank.
 */
import { describe, expect, test } from 'bun:test';
import {
  sampleStageLiveness,
  shouldRetireAttractRender,
  summarizeStagePixels,
} from '../../src/js/core/services/stage-liveness.ts';

/** `count` RGBA pixels, all the same value. */
function fill(
  count: number,
  [r, g, b, a]: [number, number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = a;
  }
  return pixels;
}

describe('summarizeStagePixels', () => {
  test('a fully transparent readback is unknown, not blank', () => {
    // The trap: every channel reads 0, so luminance alone says "black".
    const verdict = summarizeStagePixels(fill(1024, [0, 0, 0, 0]));

    expect(verdict.readable).toBe(false);
    expect(verdict.visible).toBe(false);
  });

  test('an opaque black frame is blank', () => {
    const verdict = summarizeStagePixels(fill(1024, [0, 0, 0, 255]));

    expect(verdict.readable).toBe(true);
    expect(verdict.visible).toBe(false);
    expect(verdict.coverage).toBe(0);
  });

  test('a rendered frame is visible', () => {
    const verdict = summarizeStagePixels(fill(1024, [180, 60, 200, 255]));

    expect(verdict.readable).toBe(true);
    expect(verdict.visible).toBe(true);
    expect(verdict.coverage).toBe(1);
    expect(verdict.maxLuma).toBeGreaterThan(80);
  });

  test('a near-black wash counts as blank, because nobody can see it either', () => {
    const verdict = summarizeStagePixels(fill(1024, [4, 4, 4, 255]));

    expect(verdict.readable).toBe(true);
    expect(verdict.visible).toBe(false);
  });

  test('a dark frame with real content in it is visible', () => {
    // The case the attract check must not kill: mostly dark, but drawing.
    const pixels = fill(1024, [0, 0, 0, 255]);
    for (let i = 0; i < 40 * 4; i += 4) {
      pixels[i] = 200;
      pixels[i + 1] = 220;
      pixels[i + 2] = 255;
    }

    const verdict = summarizeStagePixels(pixels);

    expect(verdict.visible).toBe(true);
    expect(verdict.meanLuma).toBeLessThan(20);
  });

  test('a single stray bright pixel does not vouch for a frame', () => {
    const pixels = fill(1024, [0, 0, 0, 255]);
    pixels[0] = 255;
    pixels[1] = 255;
    pixels[2] = 255;

    expect(summarizeStagePixels(pixels).visible).toBe(false);
  });

  test('an empty readback is unknown', () => {
    expect(summarizeStagePixels(new Uint8ClampedArray(0)).readable).toBe(false);
  });
});

describe('shouldRetireAttractRender', () => {
  const blank = {
    readable: true,
    visible: false,
    maxLuma: 0,
    meanLuma: 0,
    coverage: 0,
  };
  const rendering = {
    readable: true,
    visible: true,
    maxLuma: 200,
    meanLuma: 90,
    coverage: 0.8,
  };
  const unknown = {
    readable: false,
    visible: false,
    maxLuma: 0,
    meanLuma: 0,
    coverage: 0,
  };

  test('retires a render both samples agree is blank', () => {
    expect(shouldRetireAttractRender([blank, blank])).toBe(true);
  });

  test('keeps a render either sample saw', () => {
    expect(shouldRetireAttractRender([blank, rendering])).toBe(false);
    expect(shouldRetireAttractRender([rendering, blank])).toBe(false);
  });

  test('keeps a render it could not read', () => {
    // A browser whose canvas will not composite back must not have attract
    // mode switched off for every visitor on it.
    expect(shouldRetireAttractRender([unknown, unknown])).toBe(false);
    expect(shouldRetireAttractRender([blank, unknown])).toBe(false);
  });

  test('a missing sample is not evidence', () => {
    expect(shouldRetireAttractRender([blank, null])).toBe(false);
    expect(shouldRetireAttractRender([])).toBe(false);
  });
});

/**
 * The readback is only valid inside a frame callback. A WebGPU canvas holds
 * its image until the presenting task ends, so a read from a timer
 * composites fully transparent — measured 0 of 1024 opaque pixels against
 * 1024 of 1024 for the same frame one rAF later. Reading synchronously made
 * every verdict "unknown" on the default backend, which is why the guard
 * could never retire a blank attract render.
 */
describe('sampleStageLiveness scheduling', () => {
  test('defers the read to a frame callback', async () => {
    const calls: string[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      calls.push('scheduled');
      setTimeout(() => {
        calls.push('read');
        cb(0);
      }, 0);
      return 1;
    }) as typeof globalThis.requestAnimationFrame;

    try {
      // A zero-sized canvas short-circuits before any 2D work, which keeps
      // this about the scheduling rather than about canvas support.
      const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
      const pending = sampleStageLiveness(canvas);
      expect(calls).toEqual(['scheduled']);
      const result = await pending;
      expect(calls).toEqual(['scheduled', 'read']);
      expect(result.readable).toBe(false);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
    }
  });

  test('still resolves where there is no frame clock', async () => {
    const originalRaf = globalThis.requestAnimationFrame;
    (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame =
      undefined;
    try {
      const result = await sampleStageLiveness({
        width: 0,
        height: 0,
      } as HTMLCanvasElement);
      expect(result.readable).toBe(false);
    } finally {
      globalThis.requestAnimationFrame = originalRaf;
    }
  });
});
