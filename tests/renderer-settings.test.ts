import { describe, expect, test } from 'bun:test';
import { applyRendererSettings } from '../assets/js/core/renderer-settings';

describe('applyRendererSettings', () => {
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
      xrSupported: false,
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
