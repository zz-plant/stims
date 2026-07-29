import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getAdaptiveMaxPixelRatio,
  getDevicePerformanceProfile,
  getDeviceTier,
} from '../../src/js/core/device-profile.ts';
import { getRendererBackendMaxPixelRatioCap } from '../../src/js/core/renderer-settings.ts';

const originalNavigator = globalThis.navigator;
const originalMatchMedia = globalThis.window?.matchMedia;

/**
 * getDevicePerformanceProfile() folds `prefers-reduced-motion` into lowPower,
 * so leaving matchMedia to whatever a previously-run test file left behind
 * makes these assertions depend on file execution order. Several other suites
 * replace window.matchMedia globally, which is exactly how these tests came to
 * pass locally and fail on CI.
 */
beforeEach(() => {
  if (typeof globalThis.window === 'undefined') return;
  globalThis.window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;

  // renderer-capabilities stamps this on window at runtime and most suites
  // never clear it; a leaked "high-end" value promotes every device to ultra.
  delete (
    globalThis.window as unknown as {
      __stims_webgpu_performance_tier?: string;
    }
  ).__stims_webgpu_performance_tier;
});

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
  if (typeof globalThis.window !== 'undefined' && originalMatchMedia) {
    globalThis.window.matchMedia = originalMatchMedia;
  }
});

describe('device-profile flagship mobile optimizations', () => {
  test('categorizes high-concurrency mobile hardware as non-low-power', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        ...originalNavigator,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        hardwareConcurrency: 6,
        deviceMemory: undefined,
      },
    });

    const profile = getDevicePerformanceProfile();
    expect(profile.lowPower).toBe(false);
    expect(getDeviceTier()).toBe('high');
  });

  test('allows up to 2.0 max pixel ratio cap on flagship mobile hardware', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        ...originalNavigator,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        hardwareConcurrency: 8,
        deviceMemory: undefined,
      },
    });

    const cap = getRendererBackendMaxPixelRatioCap({
      backend: 'webgl',
      isMobile: true,
    });
    expect(cap).toBe(2.0);

    const adaptiveCap = getAdaptiveMaxPixelRatio(2.0);
    expect(adaptiveCap).toBe(2.0);
  });
});
