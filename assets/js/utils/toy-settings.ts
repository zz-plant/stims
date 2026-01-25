import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  getSettingsPanel,
  type PersistentSettingsPanel,
  type QualityPreset,
} from '../core/settings-panel';

type QualityPresetManagerOptions = {
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

type ToySettingsPanelOptions = {
  title: string;
  description?: string;
  panel?: PersistentSettingsPanel;
  quality?: QualityPresetManager;
};

export function configureToySettingsPanel({
  title,
  description,
  panel = getSettingsPanel(),
  quality,
}: ToySettingsPanelOptions): PersistentSettingsPanel {
  panel.configure({ title, description });
  quality?.configureQualityPresets(panel);
  return panel;
}
