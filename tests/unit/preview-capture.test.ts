import { describe, expect, test } from 'bun:test';
import { collectPreviewFrames } from '../../src/js/utils/media/preview-frame-collector.ts';

describe('preview capture lifecycle', () => {
  test('samples actual draw notifications and releases its observer after completion', async () => {
    let draw: (now: number) => void = () => {};
    let disposed = false;
    const captured = collectPreviewFrames({
      subscribe: (listener) => {
        draw = listener;
        return () => {
          disposed = true;
        };
      },
      read: () =>
        new Uint8Array([
          30, 50, 70, 255, 30, 50, 70, 255, 30, 50, 70, 255, 30, 50, 70, 255,
        ]),
      width: 2,
      height: 2,
      signal: new AbortController().signal,
    });
    for (let i = 0; i < 20; i++) draw(i * 200);
    const clip = await captured;
    expect(clip.frames).toHaveLength(20);
    expect(clip.delayMs).toBe(200);
    expect(disposed).toBe(true);
  });

  test('aborting or changing the preset stops capture without publishing a mixed clip', async () => {
    for (const changed of [false, true]) {
      let draw: (now: number) => void = () => {};
      let disposed = false;
      const controller = new AbortController();
      const capture = collectPreviewFrames({
        subscribe: (listener) => {
          draw = listener;
          return () => {
            disposed = true;
          };
        },
        read: () => new Uint8Array(16),
        width: 2,
        height: 2,
        signal: controller.signal,
        isCurrent: () => !changed,
      });
      const rejection = capture.then(
        () => null,
        (error: unknown) => error,
      );
      if (changed) draw(0);
      else controller.abort();
      expect(await rejection).toBeInstanceOf(Error);
      expect(disposed).toBe(true);
    }
  });
});
