import { describe, expect, test } from 'bun:test';
import {
  applyRendererSettings,
  getRendererBackendMaxPixelRatioCap,
} from '../assets/js/core/renderer-settings';

describe('applyRendererSettings', () => {
  test('allows a higher initial pixel-ratio ceiling on desktop webgpu backends', () => {
    expect(
      getRendererBackendMaxPixelRatioCap({
        backend: 'webgl',
        isMobile: false,
      }),
    ).toBe(1.5);
    expect(
      getRendererBackendMaxPixelRatioCap({
        backend: 'webgpu',
        isMobile: false,
      }),
    ).toBe(2.5);
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
});
