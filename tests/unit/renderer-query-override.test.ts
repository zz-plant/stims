import { afterEach, describe, expect, test } from 'bun:test';
import {
  clearWebGPUCompatibilityGapOverride,
  isFirefoxUA,
  isRecognizedWebGPUBrowser,
  isWebGPUStableInThisBrowser,
  setWebGPUCompatibilityGapOverride,
  shouldPreferWebGLForKnownCompatibilityGaps,
} from '../../src/js/core/renderer-query-override.ts';
import {
  clearPresetWebglFallbacks,
  markPresetNeedsWebgl,
} from '../../src/js/core/state/preset-webgl-fallback.ts';
import {
  setWebGpuForceMode,
  shouldUseSafeMilkdropWebGpuPath,
} from '../../src/js/milkdrop/webgpu-query-override.ts';
import { replaceProperty } from '../test-helpers.ts';

let restoreLocation = () => {};
let restoreUserAgent = () => {};

afterEach(() => {
  restoreLocation();
  restoreLocation = () => {};
  restoreUserAgent();
  restoreUserAgent = () => {};
  clearWebGPUCompatibilityGapOverride();
  clearPresetWebglFallbacks();
  setWebGpuForceMode('auto');
});

test('renderer query override allows webgpu certification sessions to bypass browser stability preference', () => {
  restoreLocation = replaceProperty(
    window,
    'location',
    new URL('http://localhost/?renderer=webgpu&corpus=certification'),
  );
  expect(shouldPreferWebGLForKnownCompatibilityGaps()).toBe(false);
});

test('renderer query override honors explicit live webgpu requests', () => {
  restoreLocation = replaceProperty(
    window,
    'location',
    new URL('http://localhost/?renderer=webgpu'),
  );
  expect(shouldPreferWebGLForKnownCompatibilityGaps()).toBe(false);
});

test('a preset already marked as needing webgl wins over an explicit renderer=webgpu request', () => {
  restoreLocation = replaceProperty(
    window,
    'location',
    new URL(
      'http://localhost/?renderer=webgpu&preset=rovastar-parallel-universe',
    ),
  );
  markPresetNeedsWebgl('rovastar-parallel-universe');

  expect(shouldPreferWebGLForKnownCompatibilityGaps()).toBe(true);
});

test('a different preset is unaffected by another preset needing webgl', () => {
  restoreLocation = replaceProperty(
    window,
    'location',
    new URL('http://localhost/?renderer=webgpu&preset=some-other-preset'),
  );
  markPresetNeedsWebgl('rovastar-parallel-universe');

  expect(shouldPreferWebGLForKnownCompatibilityGaps()).toBe(false);
});

test('renderer query override keeps unknown browsers on webgl-preferred mode by default', () => {
  restoreLocation = replaceProperty(
    window,
    'location',
    new URL('http://localhost/'),
  );
  expect(shouldPreferWebGLForKnownCompatibilityGaps()).toBe(true);
});

test('explicit user WebGPU override bypasses the browser stability preference', () => {
  restoreLocation = replaceProperty(
    window,
    'location',
    new URL('http://localhost/'),
  );

  setWebGPUCompatibilityGapOverride(true);

  expect(shouldPreferWebGLForKnownCompatibilityGaps()).toBe(false);
});

test('safe MilkDrop WebGPU path stays disabled for certification sessions', () => {
  expect(
    shouldUseSafeMilkdropWebGpuPath(
      new URL('http://localhost/?renderer=webgpu&corpus=certification'),
    ),
  ).toBe(false);
});

test('explicit MilkDrop WebGPU requests use the full path', () => {
  expect(
    shouldUseSafeMilkdropWebGpuPath(
      new URL('http://localhost/?renderer=webgpu'),
    ),
  ).toBe(false);
});

test('safe MilkDrop WebGPU path remains the default on unstable browsers', () => {
  restoreUserAgent = replaceProperty(
    navigator,
    'userAgent',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:129.0) Gecko/20100101 Firefox/129.0',
  );

  expect(shouldPreferWebGLForKnownCompatibilityGaps()).toBe(true);
  expect(shouldUseSafeMilkdropWebGpuPath(new URL('http://localhost/'))).toBe(
    true,
  );
});

test('force-mode overrides still allow explicit safe and full MilkDrop paths', () => {
  setWebGpuForceMode('safe');
  expect(
    shouldUseSafeMilkdropWebGpuPath(
      new URL('http://localhost/?renderer=webgpu'),
    ),
  ).toBe(true);

  setWebGpuForceMode('full');
  expect(shouldUseSafeMilkdropWebGpuPath(new URL('http://localhost/'))).toBe(
    false,
  );
});

describe('browser WebGPU stability coverage', () => {
  const setUA = (userAgent: string) => {
    restoreUserAgent = replaceProperty(navigator, 'userAgent', userAgent);
  };

  test.each([
    [
      'Safari 26.0 (macOS)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      true,
    ],
    [
      'Safari 26.5 (iOS)',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
      true,
    ],
    [
      'Safari 18.4 (pre-WebGPU)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
      false,
    ],
    [
      'Opera 100 (Chromium)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/100.0.0.0',
      true,
    ],
    [
      'Opera 98 (pre-WebGPU)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/98.0.0.0',
      false,
    ],
    [
      'Samsung Internet 25',
      'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
      true,
    ],
    [
      'Samsung Internet 23 (pre-WebGPU)',
      'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/114.0.0.0 Mobile Safari/537.36',
      false,
    ],
    [
      'Chrome 121 desktop',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      true,
    ],
    [
      'Chrome 119 (below the stability floor)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      false,
    ],
    [
      'Edge 121 desktop',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
      true,
    ],
    [
      'Firefox 141 (WebGPU still disabled by default)',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0',
      false,
    ],
  ] as const)('treats %s as %s for WebGPU', (_label, userAgent, expected) => {
    setUA(userAgent);
    expect(isWebGPUStableInThisBrowser()).toBe(expected);
  });

  test('an unknown browser remains WebGL-preferred', () => {
    setUA('Mozilla/5.0 (compatible; SomeUnknownBrowser/1.0; WebKit/605.1.15)');
    expect(isWebGPUStableInThisBrowser()).toBe(false);
    expect(shouldPreferWebGLForKnownCompatibilityGaps()).toBe(true);
  });
});

describe('browser family recognition helpers', () => {
  const setUA = (userAgent: string) => {
    restoreUserAgent = replaceProperty(navigator, 'userAgent', userAgent);
  };

  test.each([
    [
      'Chrome',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      true,
    ],
    [
      'Edge',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
      true,
    ],
    [
      'Safari',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      true,
    ],
    [
      'Firefox',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0',
      true,
    ],
    [
      'Opera',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/100.0.0.0',
      true,
    ],
    [
      'Samsung Internet',
      'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
      true,
    ],
    [
      'Unknown engine',
      'Mozilla/5.0 (compatible; SomeUnknownBrowser/1.0; WebKit/605.1.15)',
      false,
    ],
    ['Empty UA', '', false],
  ] as const)('recognizes %s as %s', (_label, userAgent, expected) => {
    setUA(userAgent);
    expect(isRecognizedWebGPUBrowser()).toBe(expected);
  });

  test.each([
    [
      'Firefox desktop',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0',
      true,
    ],
    [
      'Firefox iOS',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/141.0 Mobile/15E148 Safari/605.1.15',
      true,
    ],
    [
      'Chrome',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      false,
    ],
    [
      'Unknown engine',
      'Mozilla/5.0 (compatible; SomeUnknownBrowser/1.0; WebKit/605.1.15)',
      false,
    ],
  ] as const)('classifies %s as Firefox=%s', (_label, userAgent, expected) => {
    setUA(userAgent);
    expect(isFirefoxUA()).toBe(expected);
  });
});
