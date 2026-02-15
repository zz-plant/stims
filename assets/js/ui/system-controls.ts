import {
  getActiveMotionPreference,
  setMotionPreference,
} from '../core/motion-preferences.ts';
import {
  COMPATIBILITY_MODE_KEY,
  clearRenderOverrides,
  getActiveRenderPreferences,
  MAX_PIXEL_RATIO_KEY,
  RENDER_SCALE_KEY,
  setCompatibilityMode,
  setRenderPreferences,
} from '../core/render-preferences.ts';
import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  PersistentSettingsPanel,
  type QualityPreset,
  subscribeToQualityPreset,
} from '../core/settings-panel.ts';
import { isSmartTvDevice } from '../utils/device-detect.ts';

type SystemControlOptions = {
  title?: string;
  description?: string;
  qualityPresets?: QualityPreset[];
  defaultPresetId?: string;
  variant?: 'floating' | 'inline';
};

const formatQualityLabel = (label: string) =>
  label.replace(/\s*\(.*?\)\s*/g, '').trim();

type PerformanceSummaryOptions = {
  qualityPresets?: QualityPreset[];
  defaultPresetId?: string;
};

export const getPerformanceSummaryLabel = (
  options: PerformanceSummaryOptions = {},
) => {
  const { qualityPresets = DEFAULT_QUALITY_PRESETS, defaultPresetId } = options;
  const preset = getActiveQualityPreset({
    presets: qualityPresets,
    defaultPresetId: resolveDefaultPresetId(defaultPresetId),
  });
  return formatQualityLabel(preset.label);
};

export const subscribeToPerformanceSummary = (
  subscriber: (label: string) => void,
) => {
  return subscribeToQualityPreset((preset) => {
    subscriber(formatQualityLabel(preset.label));
  });
};

function createValueLabel(label: string) {
  const value = document.createElement('span');
  value.className = 'control-panel__value';
  value.textContent = label;
  return value;
}

function resolveDefaultPresetId(defaultPresetId?: string) {
  if (defaultPresetId) return defaultPresetId;
  return isSmartTvDevice() ? 'tv' : 'balanced';
}

function applySmartTvDefaults() {
  if (!isSmartTvDevice()) return;

  try {
    const hasCompatibilityPreference =
      window.localStorage.getItem(COMPATIBILITY_MODE_KEY) !== null;
    const hasPixelRatioPreference =
      window.localStorage.getItem(MAX_PIXEL_RATIO_KEY) !== null;
    const hasRenderScalePreference =
      window.localStorage.getItem(RENDER_SCALE_KEY) !== null;

    if (!hasCompatibilityPreference) {
      setCompatibilityMode(true);
    }

    if (!hasPixelRatioPreference) {
      setRenderPreferences({ maxPixelRatio: 1.25 });
    }

    if (!hasRenderScalePreference) {
      setRenderPreferences({ renderScale: 0.9 });
    }
  } catch (_error) {
    // Ignore unavailable storage environments.
  }
}

export function initSystemControls(
  host: HTMLElement,
  options: SystemControlOptions = {},
) {
  const {
    title = 'Performance controls',
    description = 'Tune visuals, renderer mode, and motion settings for this device.',
    qualityPresets = DEFAULT_QUALITY_PRESETS,
    defaultPresetId,
    variant = 'floating',
  } = options;

  const resolvedDefaultPresetId = resolveDefaultPresetId(defaultPresetId);
  applySmartTvDefaults();

  const panel = new PersistentSettingsPanel(host);
  const panelElement = panel.getElement();
  if (variant === 'inline') {
    panelElement.classList.add('control-panel--inline');
  }
  panel.configure({ title, description });

  panel.setQualityPresets({
    presets: qualityPresets,
    defaultPresetId: resolvedDefaultPresetId,
  });

  const renderPreferences = getActiveRenderPreferences();
  const activeQuality = getActiveQualityPreset({
    presets: qualityPresets,
    defaultPresetId: resolvedDefaultPresetId,
  });

  panel.addToggle({
    label: 'Compatibility mode (WebGL)',
    description: 'Favor the most compatible renderer for older hardware.',
    defaultValue: renderPreferences.compatibilityMode,
    onChange: (value) => {
      setCompatibilityMode(value);
    },
  });

  panel.addToggle({
    label: 'Enable motion input',
    description: 'Allow device tilt controls on toys that support motion.',
    defaultValue: getActiveMotionPreference().enabled,
    onChange: (value) => {
      setMotionPreference({ enabled: value });
    },
  });

  const resolutionRow = panel.addSection(
    'Resolution scale',
    'Lower values ease GPU load; higher values sharpen detail.',
  );
  const resolutionValue = createValueLabel('');
  const resolutionSlider = document.createElement('input');
  resolutionSlider.type = 'range';
  resolutionSlider.min = '0.6';
  resolutionSlider.max = '1';
  resolutionSlider.step = '0.05';
  resolutionSlider.value = String(
    renderPreferences.renderScale ?? activeQuality.renderScale ?? 1,
  );
  resolutionSlider.setAttribute('aria-label', 'Resolution scale');
  resolutionSlider.className = 'control-panel__slider';
  const updateResolutionValue = (value: number) => {
    resolutionValue.textContent = `${Math.round(value * 100)}%`;
  };
  updateResolutionValue(Number(resolutionSlider.value));
  resolutionSlider.addEventListener('input', (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    updateResolutionValue(value);
    setRenderPreferences({ renderScale: value });
  });
  resolutionRow.append(resolutionSlider, resolutionValue);

  const pixelRatioRow = panel.addSection(
    'Pixel ratio cap',
    'Caps effective DPI to balance clarity and thermal load.',
  );
  const pixelRatioValue = createValueLabel('');
  const pixelRatioSlider = document.createElement('input');
  pixelRatioSlider.type = 'range';
  pixelRatioSlider.min = '0.75';
  pixelRatioSlider.max = '3';
  pixelRatioSlider.step = '0.05';
  pixelRatioSlider.value = String(
    renderPreferences.maxPixelRatio ?? activeQuality.maxPixelRatio,
  );
  pixelRatioSlider.setAttribute('aria-label', 'Maximum pixel ratio');
  pixelRatioSlider.className = 'control-panel__slider';
  const updatePixelRatioValue = (value: number) => {
    pixelRatioValue.textContent = value.toFixed(2);
  };
  updatePixelRatioValue(Number(pixelRatioSlider.value));
  pixelRatioSlider.addEventListener('input', (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    updatePixelRatioValue(value);
    setRenderPreferences({ maxPixelRatio: value });
  });
  pixelRatioRow.append(pixelRatioSlider, pixelRatioValue);

  const resetRow = panel.addSection('Custom overrides', undefined);
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'cta-button ghost';
  resetButton.textContent = 'Reset to preset';
  resetButton.addEventListener('click', () => {
    clearRenderOverrides();
    const preset = getActiveQualityPreset({
      presets: qualityPresets,
      defaultPresetId: resolvedDefaultPresetId,
    });
    resolutionSlider.value = String(preset.renderScale ?? 1);
    pixelRatioSlider.value = String(preset.maxPixelRatio);
    updateResolutionValue(Number(resolutionSlider.value));
    updatePixelRatioValue(Number(pixelRatioSlider.value));
  });
  resetRow.appendChild(resetButton);

  subscribeToQualityPreset((preset) => {
    const preferences = getActiveRenderPreferences();
    if (
      preferences.renderScale === null ||
      preferences.renderScale === undefined
    ) {
      resolutionSlider.value = String(preset.renderScale ?? 1);
      updateResolutionValue(Number(resolutionSlider.value));
    }
    if (
      preferences.maxPixelRatio === null ||
      preferences.maxPixelRatio === undefined
    ) {
      pixelRatioSlider.value = String(preset.maxPixelRatio);
      updatePixelRatioValue(Number(pixelRatioSlider.value));
    }
  });

  return panel.getElement();
}
