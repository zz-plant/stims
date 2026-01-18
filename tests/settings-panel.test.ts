import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  getSettingsPanel,
  QUALITY_STORAGE_KEY,
  resetSettingsPanelState,
  subscribeToQualityPreset,
} from '../assets/js/core/settings-panel.ts';

describe('quality preset subscriptions', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    resetSettingsPanelState({ removePanel: true });
  });

  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    resetSettingsPanelState({ removePanel: true });
  });

  test('notifies subscribers for initial and subsequent preset changes', () => {
    const panel = getSettingsPanel();
    const calls: string[] = [];
    const unsubscribe = subscribeToQualityPreset((preset) =>
      calls.push(preset.id),
    );

    panel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: 'balanced',
    });

    const select = document.querySelector(
      '.control-panel select',
    ) as HTMLSelectElement | null;
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

    const resolved = getActiveQualityPreset({
      presets,
      defaultPresetId: 'low',
    });
    expect(resolved.id).toBe('low');
  });

  test('quality selection persists across panel reuse for different toys', () => {
    const panel = getSettingsPanel();
    const calls: string[] = [];

    subscribeToQualityPreset((preset) => calls.push(preset.id));

    panel.configure({ title: 'Grid visualizer' });
    panel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: 'balanced',
    });

    const select = document.querySelector(
      '.control-panel select',
    ) as HTMLSelectElement | null;
    expect(select?.value).toBe('balanced');

    if (select) {
      select.value = 'hi-fi';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    panel.configure({ title: 'Cosmic particles' });
    panel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: 'balanced',
    });

    expect(select?.value).toBe('hi-fi');
    expect(localStorage.getItem(QUALITY_STORAGE_KEY)).toBe('hi-fi');
    expect(calls).toEqual(['balanced', 'hi-fi']);
  });
});
