import { afterEach, expect, test } from 'bun:test';
import {
  clearWebGPUCompatibilityGapOverride,
  setWebGPUCompatibilityGapOverride,
  shouldPreferWebGLForKnownCompatibilityGaps,
} from '../assets/js/core/renderer-query-override.ts';
import { shouldUseSafeMilkdropWebGpuPath } from '../assets/js/milkdrop/webgpu-query-override.ts';
import { replaceProperty } from './test-helpers.ts';

let restoreLocation = () => {};

afterEach(() => {
  restoreLocation();
  restoreLocation = () => {};
  clearWebGPUCompatibilityGapOverride();
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
