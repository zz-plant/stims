import {
  getActiveMotionPreference,
  setMotionPreference,
} from '../core/motion-preferences.ts';
import {
  clearRenderOverrides,
  getActiveRenderPreferences,
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

type SystemControlOptions = {
  title?: string;
  description?: string;
  qualityPresets?: QualityPreset[];
  defaultPresetId?: string;
};

function createValueLabel(label: string) {
  const value = document.createElement('span');
  value.className = 'control-panel__value';
  value.textContent = label;
  return value;
}

export function initSystemControls(
  host: HTMLElement,
  options: SystemControlOptions = {},
) {
  const {
    title = 'Performance & compatibility',
    description = 'Adjust visual fidelity, GPU mode, and motion preferences. Changes persist for this device.',
    qualityPresets = DEFAULT_QUALITY_PRESETS,
    defaultPresetId = 'balanced',
  } = options;

  const panel = new PersistentSettingsPanel(host);
  panel.configure({ title, description });

  panel.setQualityPresets({
    presets: qualityPresets,
    defaultPresetId,
  });

  const renderPreferences = getActiveRenderPreferences();
  const activeQuality = getActiveQualityPreset({
    presets: qualityPresets,
    defaultPresetId,
  });

  panel.addToggle({
    label: 'Compatibility mode (force WebGL)',
    description:
      'Disable WebGPU and favor the most compatible renderer for older hardware.',
    defaultValue: renderPreferences.compatibilityMode,
    onChange: (value) => {
      setCompatibilityMode(value);
    },
  });

  panel.addToggle({
    label: 'Allow motion input',
    description: 'Enable device tilt controls for toys that support motion.',
    defaultValue: getActiveMotionPreference().enabled,
    onChange: (value) => {
      setMotionPreference({ enabled: value });
    },
  });

  const resolutionRow = panel.addSection(
    'Resolution scale',
    'Lower values reduce GPU load; higher values sharpen details.',
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
    'Max pixel ratio',
    'Caps the effective DPI to balance clarity and thermal load.',
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
  resetButton.textContent = 'Reset overrides to preset';
  resetButton.addEventListener('click', () => {
    clearRenderOverrides();
    const preset = getActiveQualityPreset({
      presets: qualityPresets,
      defaultPresetId,
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
