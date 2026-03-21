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

  test('getActiveQualityPreset honors a new default when no preset is stored', () => {
    const initial = getActiveQualityPreset();
    expect(initial.id).toBe('balanced');

    localStorage.removeItem(QUALITY_STORAGE_KEY);

    const resolved = getActiveQualityPreset({
      defaultPresetId: 'performance',
    });
    expect(resolved.id).toBe('performance');
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

  test('quality panels persist their default preset when no preset is stored yet', () => {
    const panel = getSettingsPanel();

    panel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: 'performance',
    });

    const select = document.querySelector(
      '.control-panel select',
    ) as HTMLSelectElement | null;

    expect(select?.value).toBe('performance');
    expect(localStorage.getItem(QUALITY_STORAGE_KEY)).toBe('performance');
  });

  test('quality presets include global scope hint and impact summary', () => {
    const panel = getSettingsPanel();

    panel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: 'balanced',
    });

    expect(panel.getElement().textContent).toContain(
      'Saved on this device and shared across toys.',
    );
    expect(panel.getElement().textContent).toContain(
      'What changes: pixel ratio',
    );
  });

  test('quality presets can hide scope and impact copy for compact contexts', () => {
    const panel = getSettingsPanel();

    panel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: 'balanced',
      showScopeHint: false,
      showChangeSummary: false,
    });

    expect(panel.getElement().textContent).not.toContain(
      'Saved on this device and shared across toys.',
    );
    expect(panel.getElement().textContent).not.toContain(
      'What changes: pixel ratio',
    );
  });
  test('includes a tv-friendly quality preset', () => {
    const preset = DEFAULT_QUALITY_PRESETS.find((entry) => entry.id === 'tv');
    expect(preset).toBeDefined();
    expect(preset?.label).toBe('TV balanced');
  });

  test('quality presets stay intentionally differentiated', () => {
    const performance = DEFAULT_QUALITY_PRESETS.find(
      (entry) => entry.id === 'performance',
    );
    const lowMotion = DEFAULT_QUALITY_PRESETS.find(
      (entry) => entry.id === 'low-motion',
    );
    const balanced = DEFAULT_QUALITY_PRESETS.find(
      (entry) => entry.id === 'balanced',
    );
    const hiFi = DEFAULT_QUALITY_PRESETS.find((entry) => entry.id === 'hi-fi');

    expect(performance).toBeDefined();
    expect(lowMotion).toBeDefined();
    expect(balanced).toBeDefined();
    expect(hiFi).toBeDefined();

    if (!(performance && lowMotion && balanced && hiFi)) {
      throw new Error('Expected shared quality presets to exist');
    }

    expect(performance.renderScale).toBeLessThan(balanced.renderScale ?? 1);
    expect(performance.particleScale).toBeGreaterThan(
      lowMotion.particleScale ?? 1,
    );
    expect(lowMotion.maxPixelRatio).toBeGreaterThan(performance.maxPixelRatio);
    expect(lowMotion.renderScale).toBe(balanced.renderScale);
    expect(hiFi.maxPixelRatio).toBeGreaterThan(balanced.maxPixelRatio);
    expect(hiFi.renderScale).toBeGreaterThan(balanced.renderScale ?? 1);
    expect(hiFi.particleScale).toBeGreaterThan(balanced.particleScale ?? 1);
  });

  test('quality presets show profile-specific scope for custom storage keys', () => {
    const panel = getSettingsPanel();

    panel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: 'balanced',
      storageKey: 'stims:quality-preset:demo-toy',
    });

    expect(panel.getElement().textContent).toContain(
      'Saved on this device for this toy profile.',
    );
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
