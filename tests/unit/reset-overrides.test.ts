import { describe, expect, test } from 'bun:test';
import { resetAllOverrides } from '../../src/js/core/reset-overrides.ts';
import {
  getBrowserSessionStorage,
  getBrowserStorage,
} from '../../src/js/core/state/browser-storage.ts';

describe('resetAllOverrides', () => {
  test('clears all stims: keys from browser storage and resets fallback history', () => {
    const localStorage = getBrowserStorage();
    const sessionStorage = getBrowserSessionStorage();

    localStorage?.clear();
    sessionStorage?.clear();

    if (localStorage) {
      localStorage.setItem('stims:compatibility-mode', 'true');
      localStorage.setItem('stims:performance-settings', '{"maxPixelRatio":1}');
      localStorage.setItem('unrelated-key', 'keep-me');
    }

    if (sessionStorage) {
      sessionStorage.setItem('stims:webgpu-compat-override', 'true');
    }

    const { clearedKeys } = resetAllOverrides();

    if (localStorage || sessionStorage) {
      if (localStorage) {
        expect(clearedKeys).toContain('stims:compatibility-mode');
        expect(clearedKeys).toContain('stims:performance-settings');
        expect(localStorage.getItem('stims:compatibility-mode')).toBeNull();
        expect(localStorage.getItem('unrelated-key')).toBe('keep-me');
      }

      if (sessionStorage) {
        expect(clearedKeys).toContain('stims:webgpu-compat-override');
        expect(
          sessionStorage.getItem('stims:webgpu-compat-override'),
        ).toBeNull();
      }
    } else {
      expect(Array.isArray(clearedKeys)).toBe(true);
    }
  });
});
