import { afterEach, describe, expect, test } from 'bun:test';
import {
  getAdaptiveMaxPixelRatio,
  getDevicePerformanceProfile,
  getDeviceTier,
} from '../../src/js/core/device-profile.ts';
import { getRendererBackendMaxPixelRatioCap } from '../../src/js/core/renderer-settings.ts';

const originalNavigator = globalThis.navigator;

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
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
