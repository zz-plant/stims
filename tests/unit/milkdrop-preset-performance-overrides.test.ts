import { expect, test } from 'bun:test';
import { resolvePresetPerformanceOverride } from '../../src/js/milkdrop/runtime/preset-performance-overrides.ts';

test('does not shortcut parity certification fixtures through performance overrides', () => {
  expect(resolvePresetPerformanceOverride('parity-legacy-wave-01')).toBeNull();
  expect(resolvePresetPerformanceOverride('parity-legacy-shape-01')).toBeNull();
});

test('returns null for presets without an override', () => {
  expect(resolvePresetPerformanceOverride('signal-bloom')).toBeNull();
  expect(resolvePresetPerformanceOverride('')).toBeNull();
});
