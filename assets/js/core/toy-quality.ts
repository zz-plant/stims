import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  getSettingsPanel,
  type PersistentSettingsPanel,
  type QualityPreset,
} from './settings-panel';

export type QualityPresetManagerOptions = {
  presets?: QualityPreset[];
  defaultPresetId?: string;
  storageKey?: string;
  onChange?: (preset: QualityPreset) => void;
  panel?: PersistentSettingsPanel;
};

export type QualityPresetManager = {
  readonly activeQuality: QualityPreset;
  applyQualityPreset: (preset: QualityPreset) => void;
  configureQualityPresets: (
    panel?: PersistentSettingsPanel,
  ) => PersistentSettingsPanel;
};

export type RendererQualityManagerOptions = QualityPresetManagerOptions & {
  getRuntime?: () =>
    | {
        toy: {
          updateRendererSettings: (
            settings: Partial<{
              maxPixelRatio: number;
              renderScale: number;
            }>,
          ) => void;
        };
      }
    | null
    | undefined;
  getRendererSettings?: (preset: QualityPreset) =>
    | Partial<{
        maxPixelRatio: number;
        renderScale: number;
      }>
    | undefined;
  onChange?: (preset: QualityPreset) => void;
};

export function createQualityPresetManager(
  options: QualityPresetManagerOptions = {},
): QualityPresetManager {
  const {
    presets = DEFAULT_QUALITY_PRESETS,
    defaultPresetId = 'balanced',
    storageKey,
    onChange,
    panel,
  } = options;

  let activeQuality = getActiveQualityPreset({
    presets,
    defaultPresetId,
    storageKey,
  });

  const applyQualityPreset = (preset: QualityPreset) => {
    activeQuality = preset;
    onChange?.(preset);
  };

  const configureQualityPresets = (
    targetPanel: PersistentSettingsPanel = panel ?? getSettingsPanel(),
  ) => {
    targetPanel.setQualityPresets({
      presets,
      defaultPresetId: activeQuality.id,
      onChange: applyQualityPreset,
      storageKey,
    });
    return targetPanel;
  };

  return {
    get activeQuality() {
      return activeQuality;
    },
    applyQualityPreset,
    configureQualityPresets,
  };
}

export function createRendererQualityManager(
  options: RendererQualityManagerOptions = {},
): QualityPresetManager {
  const { getRuntime, getRendererSettings, onChange, ...rest } = options;
  return createQualityPresetManager({
    ...rest,
    onChange: (preset) => {
      const runtime = getRuntime?.();
      const rendererSettings = getRendererSettings?.(preset) ?? {
        maxPixelRatio: preset.maxPixelRatio,
        renderScale: preset.renderScale,
      };

      if (runtime && rendererSettings) {
        runtime.toy.updateRendererSettings(rendererSettings);
      }
      onChange?.(preset);
    },
  });
}
