import { afterEach, expect, test } from 'bun:test';
import {
  getActivePerformanceSettings,
  PERFORMANCE_SETTINGS_STORAGE_KEY,
  resetPerformanceSettingsStore,
  resetPerformanceSettingsToDefaults,
  setPerformanceSettings,
} from '../../src/js/core/state/performance-settings-store.ts';
import {
  resetQualityPresetState,
  setQualityPresetById,
} from '../../src/js/core/state/quality-preset-store.ts';
import { replaceProperty } from '../test-helpers.ts';

let restoreLocation = () => {};

afterEach(() => {
  restoreLocation();
  restoreLocation = () => {};
  window.localStorage.clear();
  resetPerformanceSettingsStore();
  resetQualityPresetState();
});

test('url performance settings override stored numeric settings', () => {
  window.localStorage.setItem(
    PERFORMANCE_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      maxPixelRatio: 2.5,
      particleBudget: 1.6,
      shaderQuality: 'high',
    }),
  );
  restoreLocation = replaceProperty(
    window,
    'location',
    new URL(
      'http://localhost/?maxPixelRatio=1.25&particleBudget=0.75&shaderQuality=low',
    ),
  );

  expect(getActivePerformanceSettings()).toMatchObject({
    maxPixelRatio: 1.25,
    particleBudget: 0.75,
    shaderQuality: 'low',
  });
});

test('default maxPixelRatio follows the active quality preset', () => {
  setQualityPresetById('ultra');
  expect(getActivePerformanceSettings().maxPixelRatio).toBe(2.5);

  setQualityPresetById('balanced');
  expect(getActivePerformanceSettings().maxPixelRatio).toBe(1.75);
});

test('a user-set maxPixelRatio stops following preset changes and persists', () => {
  setQualityPresetById('balanced');
  setPerformanceSettings({ maxPixelRatio: 1.5 });

  setQualityPresetById('ultra');
  expect(getActivePerformanceSettings().maxPixelRatio).toBe(1.5);

  const stored = JSON.parse(
    window.localStorage.getItem(PERFORMANCE_SETTINGS_STORAGE_KEY) ?? '{}',
  ) as { maxPixelRatio?: number };
  expect(stored.maxPixelRatio).toBe(1.5);
});

test('a preset-derived maxPixelRatio is never written to storage', () => {
  setQualityPresetById('ultra');
  setPerformanceSettings({ particleBudget: 1.3 });

  const stored = JSON.parse(
    window.localStorage.getItem(PERFORMANCE_SETTINGS_STORAGE_KEY) ?? '{}',
  ) as { maxPixelRatio?: number; particleBudget?: number };
  expect(stored.particleBudget).toBe(1.3);
  expect(stored.maxPixelRatio).toBeUndefined();
});

test('reset returns maxPixelRatio to preset-following mode', () => {
  setQualityPresetById('ultra');
  setPerformanceSettings({ maxPixelRatio: 1 });
  expect(getActivePerformanceSettings().maxPixelRatio).toBe(1);

  const reset = resetPerformanceSettingsToDefaults();
  expect(reset.maxPixelRatio).toBe(2.5);

  setQualityPresetById('balanced');
  expect(getActivePerformanceSettings().maxPixelRatio).toBe(1.75);

  const stored = JSON.parse(
    window.localStorage.getItem(PERFORMANCE_SETTINGS_STORAGE_KEY) ?? '{}',
  ) as { maxPixelRatio?: number };
  expect(stored.maxPixelRatio).toBeUndefined();
});
