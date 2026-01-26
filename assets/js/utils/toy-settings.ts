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

export type ControlPanelButtonOption = {
  id: string;
  label: string;
};

export type ControlPanelButtonGroupOptions = {
  panel: HTMLElement;
  options: ControlPanelButtonOption[];
  getActiveId: () => string;
  onSelect: (id: string) => void;
  rowClassName?: string;
  rowStyle?: string;
  buttonClassName?: string;
  buttonStyle?: string;
  activeClassName?: string;
  setDisabledOnActive?: boolean;
  setAriaPressed?: boolean;
  dataAttribute?: string;
};

export function createControlPanelButtonGroup({
  panel,
  options,
  getActiveId,
  onSelect,
  rowClassName = 'control-panel__row',
  rowStyle,
  buttonClassName,
  buttonStyle,
  activeClassName = 'active',
  setDisabledOnActive = false,
  setAriaPressed = true,
  dataAttribute = 'data-control-option',
}: ControlPanelButtonGroupOptions) {
  const row = document.createElement('div');
  row.className = rowClassName;
  if (rowStyle) {
    row.style.cssText = rowStyle;
  }

  const buttons = options.map((option) => {
    const button = document.createElement('button');
    button.textContent = option.label;
    button.setAttribute(dataAttribute, option.id);
    if (buttonClassName) {
      button.className = buttonClassName;
    }
    if (buttonStyle) {
      button.style.cssText = buttonStyle;
    }
    button.addEventListener('click', () => onSelect(option.id));
    row.appendChild(button);
    return button;
  });

  const setActive = (activeId: string) => {
    buttons.forEach((button) => {
      const id = button.getAttribute(dataAttribute);
      const isActive = id === activeId;
      button.classList.toggle(activeClassName, isActive);
      if (setDisabledOnActive) {
        button.toggleAttribute('disabled', isActive);
      }
      if (setAriaPressed) {
        button.setAttribute('aria-pressed', String(isActive));
      }
    });
  };

  setActive(getActiveId());
  panel.appendChild(row);

  return { row, buttons, setActive };
}

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
