import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  getSettingsPanel,
  QUALITY_STORAGE_KEY,
  subscribeToQualityPreset,
} from '../assets/js/core/settings-panel.ts';

describe('quality preset subscriptions', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  test('notifies subscribers for initial and subsequent preset changes', () => {
    const panel = getSettingsPanel();
    const calls: string[] = [];
    const unsubscribe = subscribeToQualityPreset((preset) => calls.push(preset.id));

    panel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: 'balanced',
    });

    const select = document.querySelector('.control-panel select') as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    if (select) {
      select.value = 'hi-fi';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    expect(calls).toEqual(['balanced', 'hi-fi']);
    unsubscribe();
  });

  test('getActiveQualityPreset prefers stored value and memoizes', () => {
    localStorage.setItem(QUALITY_STORAGE_KEY, 'hi-fi');
    const initial = getActiveQualityPreset();
    expect(initial.id).toBe('hi-fi');

    localStorage.setItem(QUALITY_STORAGE_KEY, 'performance');
    const cached = getActiveQualityPreset();
    expect(cached.id).toBe('hi-fi');
  });

  test('getActiveQualityPreset falls back when cached preset is unavailable', () => {
    localStorage.setItem(QUALITY_STORAGE_KEY, 'hi-fi');
    getActiveQualityPreset();

    const presets = [
      { id: 'low', label: 'Low', maxPixelRatio: 1 },
      { id: 'max', label: 'Max', maxPixelRatio: 2.5 },
    ];

    const resolved = getActiveQualityPreset({ presets, defaultPresetId: 'low' });
    expect(resolved.id).toBe('low');
  });
});
