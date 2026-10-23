import { describe, expect, it } from 'bun:test';
import { createVideoExportRuntime } from '../../src/js/frontend/engine/video-export-runtime.ts';

describe('visualizer video export runtime', () => {
  it('switches renderer, camera, and MilkDrop targets to native output dimensions and restores them', () => {
    const calls: string[] = [];
    let pixelRatio = 2;
    let logicalWidth = 640;
    let logicalHeight = 360;
    const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
    const renderer = {
      getPixelRatio: () => pixelRatio,
      getSize: (target: { set: (width: number, height: number) => unknown }) =>
        target.set(logicalWidth, logicalHeight),
      setPixelRatio: (value: number) => {
        pixelRatio = value;
        calls.push(`pixel-ratio:${value}`);
      },
      setSize: (width: number, height: number) => {
        logicalWidth = width;
        logicalHeight = height;
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        calls.push(`renderer:${width}x${height}`);
      },
    };
    const camera = {
      aspect: 16 / 9,
      updateProjectionMatrix: () => calls.push('camera'),
    };
    const toy = {
      canvas,
      renderer,
      rendererBackend: 'webgl' as const,
      viewportWidth: 640,
      viewportHeight: 360,
      camera,
      audioStream: null,
    };
    const runtime = createVideoExportRuntime({
      getToy: () => toy,
      resizeMilkdrop: (width, height) =>
        calls.push(`milkdrop:${width}x${height}`),
    });

    const session = runtime.beginNativeCapture({ width: 3840, height: 2160 });
    expect(session.ok).toBe(true);
    expect(canvas.width).toBe(3840);
    expect(canvas.height).toBe(2160);
    expect(toy.viewportWidth).toBe(3840);
    expect(toy.viewportHeight).toBe(2160);
    expect(camera.aspect).toBe(16 / 9);
    expect(calls).toContain('milkdrop:3840x2160');

    if (session.ok) session.restore();
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
    expect(toy.viewportWidth).toBe(640);
    expect(toy.viewportHeight).toBe(360);
    expect(pixelRatio).toBe(2);
    expect(calls[calls.length - 1]).toBe('milkdrop:640x360');
  });

  it('uses both frustum axes for portrait native capture, and restores them', () => {
    const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
    const renderer = {
      getPixelRatio: () => 1,
      getSize: (target: { set: (width: number, height: number) => unknown }) =>
        target.set(1280, 720),
      setPixelRatio: () => {},
      setSize: (width: number, height: number) => {
        canvas.width = width;
        canvas.height = height;
      },
    };
    const camera = {
      left: -1,
      right: 1,
      top: 1,
      bottom: -1,
      updateProjectionMatrix: () => {},
    };
    const toy = {
      canvas,
      renderer,
      rendererBackend: 'webgl' as const,
      viewportWidth: 1280,
      viewportHeight: 720,
      camera,
      audioStream: null,
    };
    const runtime = createVideoExportRuntime({
      getToy: () => toy,
      resizeMilkdrop: () => {},
    });

    const session = runtime.beginNativeCapture({ width: 1080, height: 1920 });
    expect(session.ok).toBe(true);
    // Portrait 1080×1920: aspect 0.5625, so the vertical half-extent is
    // 1/aspect ≈ 1.7778 and the horizontal stays ±1 — the same extents
    // initCamera would build for this aspect.
    expect(camera.left).toBe(-1);
    expect(camera.right).toBe(1);
    expect(camera.top).toBeCloseTo(1920 / 1080, 3);
    expect(camera.bottom).toBeCloseTo(-(1920 / 1080), 3);

    if (session.ok) session.restore();
    expect(camera.left).toBe(-1);
    expect(camera.right).toBe(1);
    expect(camera.top).toBe(1);
    expect(camera.bottom).toBe(-1);
  });

  it('restores immediately and reports an allocation failure when dimensions are not native', () => {
    let pixelRatio = 2;
    const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
    const renderer = {
      getPixelRatio: () => pixelRatio,
      getSize: (target: { set: (width: number, height: number) => unknown }) =>
        target.set(640, 360),
      setPixelRatio: (value: number) => {
        pixelRatio = value;
      },
      setSize: () => {
        canvas.width = 1920;
        canvas.height = 1080;
      },
    };
    const toy = {
      canvas,
      renderer,
      rendererBackend: 'webgpu' as const,
      viewportWidth: 640,
      viewportHeight: 360,
      camera: {
        aspect: 16 / 9,
        updateProjectionMatrix() {},
      },
      audioStream: null,
    };
    const runtime = createVideoExportRuntime({
      getToy: () => toy,
      resizeMilkdrop() {},
    });

    expect(runtime.beginNativeCapture({ width: 3840, height: 2160 })).toEqual({
      ok: false,
      reason:
        'The active WebGPU backend could not allocate a native 3840 × 2160 recording surface.',
    });
    expect(pixelRatio).toBe(2);
    expect(toy.viewportWidth).toBe(640);
    expect(toy.viewportHeight).toBe(360);
  });
});
