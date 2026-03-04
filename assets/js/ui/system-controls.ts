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
  includeAdvancedControls?: boolean;
  showDetailedQualitySummary?: boolean;
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

function createAdvancedControlsSection() {
  const section = document.createElement('details');
  section.className = 'control-panel__disclosure';
  const summary = document.createElement('summary');
  summary.textContent = 'Advanced rendering';
  section.appendChild(summary);

  const content = document.createElement('div');
  content.className = 'control-panel__advanced-content';
  section.appendChild(content);

  return { section, content };
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
    includeAdvancedControls = true,
    showDetailedQualitySummary = true,
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
    showScopeHint: showDetailedQualitySummary,
    showChangeSummary: showDetailedQualitySummary,
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

  if (includeAdvancedControls) {
    const advancedContainerRow = panel.addSection(
      'Fine tuning',
      'Optional controls for render sharpness and GPU load.',
    );
    const { section: advancedSection, content: advancedSectionContent } =
      createAdvancedControlsSection();
    advancedContainerRow.appendChild(advancedSection);

    const resolutionRow = document.createElement('div');
    resolutionRow.className = 'control-panel__row';
    advancedSectionContent.appendChild(resolutionRow);
    const resolutionText = document.createElement('div');
    resolutionText.className = 'control-panel__text';
    resolutionText.innerHTML = `
      <span class="control-panel__label">Resolution scale</span>
      <span class="control-panel__microcopy">Lower values ease GPU load; higher values sharpen detail.</span>
    `;
    resolutionRow.appendChild(resolutionText);

    const resolutionControl = document.createElement('div');
    resolutionControl.className =
      'control-panel__actions control-panel__actions--inline';
    resolutionRow.appendChild(resolutionControl);

    const pixelRatioRow = document.createElement('div');
    pixelRatioRow.className = 'control-panel__row';
    advancedSectionContent.appendChild(pixelRatioRow);
    const pixelText = document.createElement('div');
    pixelText.className = 'control-panel__text';
    pixelText.innerHTML = `
      <span class="control-panel__label">Pixel ratio cap</span>
      <span class="control-panel__microcopy">Caps effective DPI to balance clarity and thermal load.</span>
    `;
    pixelRatioRow.appendChild(pixelText);
    const pixelControl = document.createElement('div');
    pixelControl.className =
      'control-panel__actions control-panel__actions--inline';
    pixelRatioRow.appendChild(pixelControl);

    const resetRow = document.createElement('div');
    resetRow.className = 'control-panel__row';
    advancedSectionContent.appendChild(resetRow);
    const resetText = document.createElement('div');
    resetText.className = 'control-panel__text';
    resetText.innerHTML =
      '<span class="control-panel__label">Custom overrides</span>';
    resetRow.appendChild(resetText);

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
    resolutionControl.append(resolutionSlider, resolutionValue);

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
    pixelControl.append(pixelRatioSlider, pixelRatioValue);

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
  }

  return panel.getElement();
}
