import { afterEach, expect, test } from 'bun:test';
import {
  getActivePerformanceSettings,
  PERFORMANCE_SETTINGS_STORAGE_KEY,
  resetPerformanceSettingsStore,
} from '../assets/js/core/state/performance-settings-store.ts';
import { replaceProperty } from './test-helpers.ts';

let restoreLocation = () => {};

afterEach(() => {
  restoreLocation();
  restoreLocation = () => {};
  window.localStorage.clear();
  resetPerformanceSettingsStore();
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
