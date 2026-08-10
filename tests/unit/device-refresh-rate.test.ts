import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  getDisplayRefreshRate,
  getObservedRefreshRate,
  startRefreshRateSampling,
} from '../../src/js/core/device-profile.ts';

const originalNavigator = globalThis.navigator;
const originalMatchMedia = globalThis.window?.matchMedia;
const originalRaf = globalThis.window?.requestAnimationFrame;

/**
 * Drives the sampler's rAF loop synchronously with a fixed frame period so the
 * observed rate is deterministic.
 */
function installFakeRaf(framePeriodMs: number, frames = 40) {
  let now = 0;
  let remaining = frames;
  globalThis.window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    if (remaining-- <= 0) return 0;
    now += framePeriodMs;
    // Synchronous dispatch keeps the test free of timers.
    cb(now);
    return 0;
  }) as typeof window.requestAnimationFrame;
}

beforeEach(() => {
  if (typeof globalThis.window === 'undefined') return;
  globalThis.window.matchMedia = ((query: string) =>
    ({
      media: query,
      // `(update: fast)` must match, otherwise getDisplayRefreshRate
      // short-circuits to 60 before consulting the observed rate.
      matches: true,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;

  delete (
    globalThis.window as unknown as {
      __stims_webgpu_performance_tier?: string;
    }
  ).__stims_webgpu_performance_tier;
  try {
    globalThis.window.sessionStorage?.removeItem(
      'stims:webgpu-performance-tier',
    );
  } catch {}
});

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
  if (typeof globalThis.window !== 'undefined') {
    if (originalMatchMedia) globalThis.window.matchMedia = originalMatchMedia;
    if (originalRaf) globalThis.window.requestAnimationFrame = originalRaf;
  }
});

describe('display refresh rate', () => {
  test('does not assume 120Hz from core count alone', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        ...originalNavigator,
        userAgent:
          'Mozilla/5.0 (Linux; Android 16; SM-S901U1) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36',
        hardwareConcurrency: 8,
        deviceMemory: 8,
      },
    });

    // An unmeasured device must fall back to 60. Guessing 120 here is what
    // budgeted a 60Hz Galaxy S22 at 8.33ms/frame, leaving the adaptive quality
    // controller under permanent, unclearable frame pressure.
    expect(getDisplayRefreshRate()).toBeLessThanOrEqual(60);
  });

  test('quantizes an observed 60Hz cadence', () => {
    if (typeof globalThis.window === 'undefined') return;
    installFakeRaf(16.7);
    startRefreshRateSampling();
    expect(getObservedRefreshRate()).toBe(60);
  });
});
