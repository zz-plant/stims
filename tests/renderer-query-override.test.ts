import { afterEach, expect, test } from 'bun:test';
import { shouldPreferWebGLForKnownCompatibilityGaps } from '../assets/js/core/renderer-query-override.ts';
import { replaceProperty } from './test-helpers.ts';

let restoreLocation = () => {};

afterEach(() => {
  restoreLocation();
  restoreLocation = () => {};
});

test('renderer query override allows webgpu certification sessions to bypass the live webgl preference', () => {
  restoreLocation = replaceProperty(
    window,
    'location',
    new URL('http://localhost/?renderer=webgpu'),
  );
  expect(shouldPreferWebGLForKnownCompatibilityGaps()).toBe(false);
});

test('renderer query override keeps the live visualizer on webgl-preferred mode by default', () => {
  restoreLocation = replaceProperty(
    window,
    'location',
    new URL('http://localhost/'),
  );
  expect(shouldPreferWebGLForKnownCompatibilityGaps()).toBe(true);
});
