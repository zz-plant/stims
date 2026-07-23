import { afterEach, expect, test } from 'bun:test';
import {
  clearWebGPUCompatibilityGapOverride,
  setWebGPUCompatibilityGapOverride,
  shouldPreferWebGLForKnownCompatibilityGaps,
} from '../../assets/js/core/renderer-query-override.ts';
import {
  setWebGpuForceMode,
  shouldUseSafeMilkdropWebGpuPath,
} from '../../assets/js/milkdrop/webgpu-query-override.ts';
import { replaceProperty } from '../test-helpers.ts';

let restoreLocation = () => {};
let restoreUserAgent = () => {};

afterEach(() => {
  restoreLocation();
  restoreLocation = () => {};
  restoreUserAgent();
  restoreUserAgent = () => {};
  clearWebGPUCompatibilityGapOverride();
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
