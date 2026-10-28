import { describe, expect, test } from 'bun:test';
import { createCanvasFrameCopy } from '../src/frame-copy.ts';
import { frameBus } from './frame-bus.ts';
import { greyCanvas, greyCanvasFactory } from './grey-canvas.ts';

describe('createCanvasFrameCopy', () => {
  test('is sized before the first frame and follows the source after each', () => {
    const source = greyCanvas(200, { width: 800, height: 600 });
    const bus = frameBus();
    const copy = createCanvasFrameCopy({
      getCanvas: () => source,
      size: { width: 1080, height: 1920 },
      createCanvas: greyCanvasFactory().create,
      subscribe: bus.subscribe,
    });
    if (!copy) throw new Error('no 2D context');
    const output = copy.canvas as ReturnType<typeof greyCanvas>;

    // A capture taken before any frame is at the preset size, not 300x150.
    expect([output.width, output.height]).toEqual([1080, 1920]);
    expect(output.level).toBe(0);

    bus.frame();
    expect(output.level).toBe(200);
    source.level = 90;
    bus.frame();
    expect(output.level).toBe(90);

    copy.dispose();
    expect(bus.listeners).toBe(0);
    source.level = 10;
    bus.frame();
    expect(output.level).not.toBe(10);
  });

  test('crops the source to fill a portrait output, centred', () => {
    const source = greyCanvas(200, { width: 1920, height: 1080 });
    const bus = frameBus();
    const copy = createCanvasFrameCopy({
      getCanvas: () => source,
      size: { width: 1080, height: 1920 },
      createCanvas: greyCanvasFactory().create,
      subscribe: bus.subscribe,
    });
    if (!copy) throw new Error('no 2D context');
    bus.frame();
    const output = copy.canvas as ReturnType<typeof greyCanvas>;
    // 9:16 out of 16:9: the full height, and 1080 * (1080 / 1920) = 607.5
    // of the width, taken from the middle.
    const [sx, sy, sw, sh] = output.sourceRects[0] as number[];
    expect(sh).toBe(1080);
    expect(sy).toBe(0);
    expect(sw).toBeCloseTo(607.5);
    expect(sx).toBeCloseTo((1920 - 607.5) / 2);
    copy.dispose();
  });

  test('without a size the copy takes the source size, and resizes with it', () => {
    const source = greyCanvas(200, { width: 800, height: 600 });
    const bus = frameBus();
    const copy = createCanvasFrameCopy({
      getCanvas: () => source,
      createCanvas: greyCanvasFactory().create,
      subscribe: bus.subscribe,
    });
    if (!copy) throw new Error('no 2D context');
    const output = copy.canvas as ReturnType<typeof greyCanvas>;
    expect([output.width, output.height]).toEqual([800, 600]);
    source.width = 3840;
    source.height = 2160;
    source.level = 120;
    bus.frame();
    expect([output.width, output.height]).toEqual([3840, 2160]);
    expect(output.level).toBe(120);
    copy.dispose();
  });

  test('returns null where the output canvas has no 2D context', () => {
    const copy = createCanvasFrameCopy({
      getCanvas: () => greyCanvas(0),
      size: { width: 16, height: 16 },
      createCanvas: () =>
        ({ getContext: () => null }) as unknown as HTMLCanvasElement,
      subscribe: () => () => {},
    });
    expect(copy).toBeNull();
  });
});
