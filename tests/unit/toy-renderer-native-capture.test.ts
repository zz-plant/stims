import { describe, expect, it } from 'bun:test';
import { createToyRendererSession } from '../../src/js/core/toy-renderer-session.ts';

describe('toy renderer native capture override', () => {
  it('keeps the native viewport through adaptive settings and restores the live viewport', async () => {
    const applied: Array<{
      options: Record<string, unknown>;
      viewport: { width: number; height: number } | undefined;
    }> = [];
    const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
    const handle = {
      renderer: { setAnimationLoop() {} },
      backend: 'webgl' as const,
      info: {},
      canvas,
      getRuntimeControls: () => ({}),
      applySettings: (
        options: Record<string, unknown> = {},
        viewport?: { width: number; height: number },
      ) => {
        applied.push({ options, viewport });
        if (viewport) {
          canvas.width = viewport.width;
          canvas.height = viewport.height;
        }
      },
      release() {},
    };
    const session = createToyRendererSession({
      host: null,
      canvas,
      options: { maxPixelRatio: 2 },
      requestRendererImpl: async () => handle as never,
    });
    await session.ready;
    session.setViewport({
      width: 640,
      height: 360,
      cssWidth: 640,
      cssHeight: 360,
    });

    const restore = session.beginNativeCapture(3840, 2160);
    expect(restore).not.toBeNull();
    expect(applied[applied.length - 1]?.viewport).toEqual({
      width: 3840,
      height: 2160,
    });
    expect(applied[applied.length - 1]?.options).toMatchObject({
      maxPixelRatio: 1,
      renderScale: 1,
      adaptiveMaxPixelRatioMultiplier: 1,
      adaptiveRenderScaleMultiplier: 1,
    });

    session.updateOptions({ adaptiveRenderScaleMultiplier: 0.5 });
    expect(applied[applied.length - 1]?.viewport).toEqual({
      width: 3840,
      height: 2160,
    });
    expect(canvas.width).toBe(3840);
    expect(canvas.height).toBe(2160);

    restore?.();
    expect(applied[applied.length - 1]?.viewport).toEqual({
      width: 640,
      height: 360,
    });
    expect(applied[applied.length - 1]?.options).toMatchObject({
      maxPixelRatio: 2,
      adaptiveRenderScaleMultiplier: 0.5,
    });
  });
});
