import { describe, expect, test } from 'bun:test';
import {
  applyRendererSettings,
  DEFAULT_RENDERER_RUNTIME_CONTROLS,
  getRendererBackendMaxPixelRatioCap,
  resolveRendererRuntimeControls,
} from '../assets/js/core/renderer-settings';

describe('applyRendererSettings', () => {
  test('allows a higher initial pixel-ratio ceiling on desktop webgpu backends', () => {
    expect(
      getRendererBackendMaxPixelRatioCap({
        backend: 'webgl',
        isMobile: false,
      }),
    ).toBe(1.35);
    expect(
      getRendererBackendMaxPixelRatioCap({
        backend: 'webgpu',
        isMobile: false,
      }),
    ).toBe(2);
  });

  test('keeps mobile webgpu below the desktop ceiling', () => {
    expect(
      getRendererBackendMaxPixelRatioCap({
        backend: 'webgl',
        isMobile: true,
      }),
    ).toBe(1.25);
    expect(
      getRendererBackendMaxPixelRatioCap({
        backend: 'webgpu',
        isMobile: true,
      }),
    ).toBe(1.5);
  });

  test('applies explicit viewport dimensions when provided', () => {
    const calls: Array<[number, number, boolean?]> = [];
    const renderer = {
      setPixelRatio: () => {},
      setSize: (width: number, height: number, updateStyle?: boolean) => {
        calls.push([width, height, updateStyle]);
      },
      toneMappingExposure: 1,
    };
    const info = {
      renderer: renderer as never,
      backend: 'webgl' as const,
      maxPixelRatio: 2,
      renderScale: 1,
      exposure: 1,
    };

    applyRendererSettings(
      renderer as never,
      info,
      { exposure: 1.2 },
      {},
      { width: 640, height: 360 },
    );

    expect(calls).toEqual([[640, 360, false]]);
    expect(renderer.toneMappingExposure).toBe(1.2);
  });

  test('resolves shared runtime quality controls with safe defaults', () => {
    expect(resolveRendererRuntimeControls()).toEqual(
      DEFAULT_RENDERER_RUNTIME_CONTROLS,
    );

    expect(
      resolveRendererRuntimeControls({
        renderScale: 0.8,
        feedbackScale: 0.75,
        meshDensityMultiplier: 1.2,
        waveSampleMultiplier: Number.NaN,
        motionVectorDensityMultiplier: -1,
      }),
    ).toEqual({
      renderScale: 0.8,
      feedbackScale: 0.75,
      meshDensityMultiplier: 1.2,
      waveSampleMultiplier: 1,
      motionVectorDensityMultiplier: 1,
    });
  });
});
