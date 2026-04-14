import { expect, test } from 'bun:test';
import { resolvePresetPerformanceOverride } from '../assets/js/milkdrop/runtime/preset-performance-overrides.ts';

test('resolves preset performance overrides for known outliers', () => {
  expect(resolvePresetPerformanceOverride('parity-legacy-wave-01')).toEqual({
    qualityPresetId: 'performance',
    disableBlendTransitions: true,
  });
  expect(resolvePresetPerformanceOverride('parity-legacy-shape-01')).toEqual({
    qualityPresetId: 'performance',
    disableBlendTransitions: true,
  });
});

test('returns null for presets without an override', () => {
  expect(resolvePresetPerformanceOverride('signal-bloom')).toBeNull();
  expect(resolvePresetPerformanceOverride('')).toBeNull();
});
