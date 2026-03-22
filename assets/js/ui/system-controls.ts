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
import { isMobileDevice, isSmartTvDevice } from '../utils/device-detect.ts';

export type VisualBehaviorState = {
  idleEnabled: boolean;
  paletteCycle: boolean;
  mobilePreset: boolean;
};

type VisualBehaviorKey = keyof VisualBehaviorState;

type SystemControlOptions = {
  title?: string;
  description?: string;
  qualityPresets?: QualityPreset[];
  defaultPresetId?: string;
  variant?: 'floating' | 'inline' | 'embedded';
  includeAdvancedControls?: boolean;
  showDetailedQualitySummary?: boolean;
  onQualityPresetChange?: (preset: QualityPreset) => void;
  includeVisualBehaviorControls?: boolean;
  visualBehaviorInitial?: Partial<VisualBehaviorState>;
  onVisualBehaviorChange?: (state: VisualBehaviorState) => void;
};

type SystemControlsHandle = {
  element: HTMLElement;
  getVisualBehaviorState: () => VisualBehaviorState;
  onVisualBehaviorChange: (
    listener: (state: VisualBehaviorState) => void,
  ) => void;
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

function createSectionHost(
  panel: PersistentSettingsPanel,
  title: string,
  description?: string,
  collapsed = false,
) {
  const details = document.createElement('details');
  details.className = 'control-panel__details';
  details.open = !collapsed;

  const summary = document.createElement('summary');
  summary.className = 'control-panel__row';

  const text = document.createElement('div');
  text.className = 'control-panel__text';

  const label = document.createElement('span');
  label.className = 'control-panel__label';
  label.textContent = title;
  text.appendChild(label);

  if (description) {
    const hint = document.createElement('small');
    hint.textContent = description;
    text.appendChild(hint);
  }

  summary.appendChild(text);

  const body = document.createElement('div');
  body.className = 'control-panel__section';

  details.append(summary, body);
  panel.appendSectionContent(details);
  return body;
}

export function initSystemControls(
  host: HTMLElement,
  options: SystemControlOptions = {},
): SystemControlsHandle {
  const {
    title = 'Tune',
    description = 'Adjust quality, motion, and compatibility for this visualizer session.',
    qualityPresets = DEFAULT_QUALITY_PRESETS,
    defaultPresetId,
    variant = 'floating',
    includeAdvancedControls = true,
    showDetailedQualitySummary = false,
    onQualityPresetChange,
    includeVisualBehaviorControls = false,
    visualBehaviorInitial,
    onVisualBehaviorChange,
  } = options;

  const resolvedDefaultPresetId = resolveDefaultPresetId(defaultPresetId);
  applySmartTvDefaults();

  const panel = new PersistentSettingsPanel(host);
  const panelElement = panel.getElement();
  if (variant === 'inline') {
    panelElement.classList.add('control-panel--inline');
  } else if (variant === 'embedded') {
    panelElement.classList.add('control-panel--embedded');
  }
  panel.configure({ title, description });

  panel.setQualityPresets({
    presets: qualityPresets,
    defaultPresetId: resolvedDefaultPresetId,
    label: 'Look',
    hint: 'Balance fidelity and frame rate.',
    showScopeHint: showDetailedQualitySummary,
    showChangeSummary: showDetailedQualitySummary,
    onChange: onQualityPresetChange,
  });

  const renderPreferences = getActiveRenderPreferences();
  const activeQuality = getActiveQualityPreset({
    presets: qualityPresets,
    defaultPresetId: resolvedDefaultPresetId,
  });

  const isMobile = isMobileDevice();
  const visualBehaviorState: VisualBehaviorState = {
    idleEnabled: visualBehaviorInitial?.idleEnabled ?? !isMobile,
    paletteCycle: visualBehaviorInitial?.paletteCycle ?? true,
    mobilePreset: visualBehaviorInitial?.mobilePreset ?? isMobile,
  };
  const visualBehaviorListeners = new Set<
    (state: VisualBehaviorState) => void
  >();
  if (onVisualBehaviorChange) {
    visualBehaviorListeners.add(onVisualBehaviorChange);
  }

  const emitVisualBehaviorChange = () => {
    const next = { ...visualBehaviorState };
    visualBehaviorListeners.forEach((listener) => listener(next));
  };

  if (includeVisualBehaviorControls) {
    const visualToggles: Array<{ key: VisualBehaviorKey; label: string }> = [
      { key: 'idleEnabled', label: 'Idle visuals' },
      { key: 'paletteCycle', label: 'Palette drift' },
      { key: 'mobilePreset', label: 'Mobile-friendly idle' },
    ];

    visualToggles.forEach(({ key, label }) => {
      panel.addToggle({
        label,
        defaultValue: visualBehaviorState[key],
        description:
          key === 'idleEnabled'
            ? 'Keep motion active when audio is quiet.'
            : key === 'paletteCycle'
              ? 'Slowly shift colors over time.'
              : 'Reduce background drift on phones and tablets.',
        onChange: (value) => {
          visualBehaviorState[key] = value;
          emitVisualBehaviorChange();
        },
      });
    });
  }

  panel.addToggle({
    label: 'Safe mode',
    description: 'Use safer rendering for older hardware.',
    defaultValue: renderPreferences.compatibilityMode,
    onChange: (value) => {
      setCompatibilityMode(value);
    },
  });

  panel.addToggle({
    label: 'Tilt',
    description: 'Enable tilt controls on supported visualizers.',
    defaultValue: getActiveMotionPreference().enabled,
    onChange: (value) => {
      setMotionPreference({ enabled: value });
    },
  });

  if (includeAdvancedControls) {
    const advancedHost = createSectionHost(
      panel,
      'Rendering',
      'Fine-tune rendering when needed.',
      true,
    );
    const resolutionRow = panel.addSection(
      'Resolution scale',
      'Lower values ease GPU load; higher values sharpen detail.',
      undefined,
      advancedHost,
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
      undefined,
      advancedHost,
    );
    const pixelRatioValue = createValueLabel('');
    const pixelRatioSlider = document.createElement('input');
    pixelRatioSlider.type = 'range';
    pixelRatioSlider.min = '0.75';
    pixelRatioSlider.max = '2.5';
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

    const resetRow = panel.addSection(
      'Reset overrides',
      undefined,
      undefined,
      advancedHost,
    );
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

  return {
    element: panel.getElement(),
    getVisualBehaviorState: () => ({ ...visualBehaviorState }),
    onVisualBehaviorChange: (listener) => {
      visualBehaviorListeners.add(listener);
    },
  };
}
