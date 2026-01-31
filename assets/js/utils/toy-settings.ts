import {
  getPerformancePanel,
  type PerformancePanelOptions,
} from '../core/performance-panel';
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

type RendererQualityManagerOptions = QualityPresetManagerOptions & {
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

export type ToyQualityControlsOptions = RendererQualityManagerOptions & {
  title: string;
  description?: string;
  panel?: PersistentSettingsPanel;
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

export function createToyQualityControls({
  title,
  description,
  panel,
  ...qualityOptions
}: ToyQualityControlsOptions) {
  const quality = createRendererQualityManager(qualityOptions);

  const configurePanel = () =>
    configureToySettingsPanel({
      title,
      description,
      panel,
      quality,
    });

  return { quality, configurePanel };
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

type StatefulControlPanelButtonGroupOptions = Omit<
  ControlPanelButtonGroupOptions,
  'onSelect'
> & {
  onChange: (id: string) => void;
  syncOnChange?: boolean;
};

export function createStatefulControlPanelButtonGroup({
  onChange,
  syncOnChange = true,
  ...options
}: StatefulControlPanelButtonGroupOptions) {
  const group = createControlPanelButtonGroup({
    ...options,
    onSelect: (id) => {
      onChange(id);
      if (syncOnChange) {
        group.setActive(options.getActiveId());
      }
    },
  });

  const sync = () => group.setActive(options.getActiveId());

  return { ...group, sync };
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

export type PanelSelectOption = {
  value: string;
  label: string;
};

type ButtonGroupControl = Omit<
  StatefulControlPanelButtonGroupOptions,
  'panel'
> & {
  type: 'button-group';
};

type SelectControl = {
  type: 'select';
  options: PanelSelectOption[];
  getValue: () => string;
  onChange: (value: string) => void;
  selectClassName?: string;
};

export type ToySettingsSection = {
  title: string;
  description?: string;
  controls: Array<ButtonGroupControl | SelectControl>;
};

type BuildToySettingsPanelOptions = ToySettingsPanelOptions & {
  sections: ToySettingsSection[];
};

export type SingleSelectPanelOptions = ToySettingsPanelOptions & {
  section: {
    title: string;
    description?: string;
  };
  select: SelectControl;
};

export type SingleButtonGroupPanelOptions = ToySettingsPanelOptions & {
  section: {
    title: string;
    description?: string;
  };
  buttonGroup: ButtonGroupControl;
};

type BuildToySettingsPanelWithPerformanceOptions =
  BuildToySettingsPanelOptions & {
    performance?: PerformancePanelOptions;
  };

export function buildToySettingsPanel({
  sections,
  ...panelOptions
}: BuildToySettingsPanelOptions): PersistentSettingsPanel {
  const panel = configureToySettingsPanel(panelOptions);

  sections.forEach((section, sectionIndex) => {
    const sectionPanel = panel.addSection(section.title, section.description);

    section.controls.forEach((control, controlIndex) => {
      if (control.type === 'button-group') {
        createStatefulControlPanelButtonGroup({
          ...control,
          panel: sectionPanel,
        });
        return;
      }

      if (control.type === 'select') {
        const select = document.createElement('select');
        select.className = control.selectClassName ?? 'control-panel__select';
        const selectId = `control-select-${sectionIndex}-${controlIndex}`;
        select.id = selectId;

        control.options.forEach((option) => {
          const optionElement = document.createElement('option');
          optionElement.value = option.value;
          optionElement.textContent = option.label;
          select.appendChild(optionElement);
        });

        select.value = control.getValue();
        select.addEventListener('change', () => control.onChange(select.value));

        sectionPanel.appendChild(select);
      }
    });
  });

  return panel;
}

export function buildToySettingsPanelWithPerformance({
  performance,
  ...options
}: BuildToySettingsPanelWithPerformanceOptions): PersistentSettingsPanel {
  const panel = buildToySettingsPanel(options);
  if (performance) {
    getPerformancePanel(performance);
  }
  return panel;
}

export function buildSingleSelectPanel({
  section,
  select,
  ...panelOptions
}: SingleSelectPanelOptions): PersistentSettingsPanel {
  return buildToySettingsPanel({
    ...panelOptions,
    sections: [
      {
        title: section.title,
        description: section.description,
        controls: [
          {
            type: 'select',
            options: select.options,
            getValue: select.getValue,
            onChange: select.onChange,
            selectClassName: select.selectClassName,
          },
        ],
      },
    ],
  });
}

export function buildSingleButtonGroupPanel({
  section,
  buttonGroup,
  ...panelOptions
}: SingleButtonGroupPanelOptions): PersistentSettingsPanel {
  return buildToySettingsPanel({
    ...panelOptions,
    sections: [
      {
        title: section.title,
        description: section.description,
        controls: [
          {
            type: 'button-group',
            options: buttonGroup.options,
            getActiveId: buttonGroup.getActiveId,
            onChange: buttonGroup.onChange,
            rowClassName: buttonGroup.rowClassName,
            rowStyle: buttonGroup.rowStyle,
            buttonClassName: buttonGroup.buttonClassName,
            buttonStyle: buttonGroup.buttonStyle,
            activeClassName: buttonGroup.activeClassName,
            setDisabledOnActive: buttonGroup.setDisabledOnActive,
            setAriaPressed: buttonGroup.setAriaPressed,
            dataAttribute: buttonGroup.dataAttribute,
          },
        ],
      },
    ],
  });
}
