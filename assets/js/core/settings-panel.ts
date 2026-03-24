import {
  DEFAULT_QUALITY_PRESETS,
  describeQualityPresetImpact,
  getActiveQualityPreset,
  getQualityPresetScopeHint,
  hasStoredQualityPreset,
  QUALITY_STORAGE_KEY,
  type QualityPreset,
  resetQualityPresetState,
  setQualityPresetById,
} from './state/quality-preset-store.ts';

export {
  DEFAULT_QUALITY_PRESETS,
  describeQualityPresetImpact,
  getActiveQualityPreset,
  getQualityPresetScopeHint,
  getStoredQualityPreset,
  QUALITY_STORAGE_KEY,
  type QualityPreset,
  type SetQualityPresetOptions,
  type StoredPresetOptions,
  setQualityPresetById,
  subscribeToQualityPreset,
} from './state/quality-preset-store.ts';

type PanelConfig = {
  title?: string;
  description?: string;
};

type QualityOptions = {
  presets?: QualityPreset[];
  defaultPresetId?: string;
  onChange?: (preset: QualityPreset) => void;
  storageKey?: string;
  showScopeHint?: boolean;
  showChangeSummary?: boolean;
  label?: string;
  hint?: string;
};

type ToggleOptions = {
  label: string;
  description?: string;
  defaultValue?: boolean;
  onChange?: (checked: boolean) => void;
  parent?: HTMLElement;
};

const DEFAULT_PRESET_ID = 'balanced';
const DEFAULT_QUALITY_HINT = 'Adjust resolution and particle density.';

export class PersistentSettingsPanel {
  private container: HTMLDivElement;
  private heading: HTMLDivElement;
  private description?: HTMLParagraphElement;
  private qualityRow?: HTMLDivElement;
  private qualitySelect?: HTMLSelectElement;
  private qualityHint?: HTMLElement;
  private qualityScopeHint?: HTMLElement;
  private qualityChangeSummary?: HTMLElement;
  private qualityPresets: QualityPreset[] = [];
  private qualityChangeHandler?: (preset: QualityPreset) => void;
  private sectionHost: HTMLDivElement;
  private qualityStorageKey: string = QUALITY_STORAGE_KEY;
  private toggleCount = 0;

  constructor(root: HTMLElement = document.body) {
    this.container = document.createElement('div');
    this.container.className = 'control-panel control-panel--floating';

    this.heading = document.createElement('div');
    this.heading.className = 'control-panel__heading';
    this.container.appendChild(this.heading);

    this.sectionHost = document.createElement('div');
    this.container.appendChild(this.sectionHost);

    root.appendChild(this.container);
  }

  getElement() {
    return this.container;
  }

  configure(config: PanelConfig = {}) {
    const { title = 'Visualizer settings', description } = config;
    this.heading.textContent = title;

    if (description) {
      if (!this.description) {
        this.description = document.createElement('p');
        this.description.className = 'control-panel__description';
        this.container.insertBefore(this.description, this.sectionHost);
      }
      this.description.textContent = description;
    } else if (this.description) {
      this.description.remove();
      this.description = undefined;
    }

    this.sectionHost.replaceChildren();
  }

  setQualityPresets(options: QualityOptions = {}) {
    const {
      presets = DEFAULT_QUALITY_PRESETS,
      defaultPresetId = DEFAULT_PRESET_ID,
      onChange,
      storageKey = QUALITY_STORAGE_KEY,
      showScopeHint = true,
      showChangeSummary = true,
      label: qualityLabel = 'Quality preset',
      hint: qualityHint = DEFAULT_QUALITY_HINT,
    } = options;

    const hadActivePreset = hasStoredQualityPreset(storageKey);

    this.qualityStorageKey = storageKey;
    this.qualityPresets = presets;
    this.qualityChangeHandler = onChange;

    if (!this.qualityRow) {
      this.qualityRow = document.createElement('div');
      this.qualityRow.className = 'control-panel__row';

      const text = document.createElement('div');
      text.className = 'control-panel__text';

      const selectId = 'quality-preset-select';
      const labelElement = document.createElement('label');
      labelElement.className = 'control-panel__label';
      labelElement.textContent = qualityLabel;
      labelElement.htmlFor = selectId;

      const hintElement = document.createElement('small');
      hintElement.textContent = qualityHint;
      this.qualityHint = hintElement;

      if (showScopeHint) {
        const scopeHint = document.createElement('small');
        scopeHint.textContent = this.getScopeHint(storageKey);
        this.qualityScopeHint = scopeHint;
      }

      if (showChangeSummary) {
        const changeSummary = document.createElement('small');
        changeSummary.className = 'control-panel__microcopy';
        this.qualityChangeSummary = changeSummary;
      }

      text.append(labelElement, hintElement);
      if (this.qualityScopeHint) {
        text.append(this.qualityScopeHint);
      }
      if (this.qualityChangeSummary) {
        text.append(this.qualityChangeSummary);
      }

      const select = document.createElement('select');
      select.id = selectId;
      select.addEventListener('change', () =>
        this.handleQualityChange(select.value),
      );

      this.qualitySelect = select;
      this.qualityRow.append(text, select);

      this.container.insertBefore(this.qualityRow, this.sectionHost);
    }

    if (!this.qualitySelect) return;

    const qualitySelect = this.qualitySelect;
    qualitySelect.replaceChildren();
    presets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      qualitySelect.appendChild(option);
    });

    const initialPreset = this.getInitialPreset(defaultPresetId);
    this.qualitySelect.value = initialPreset.id;
    this.updateQualityHint(initialPreset, this.qualityStorageKey);

    if (!hadActivePreset) {
      this.handleQualityChange(initialPreset.id);
    }
  }

  addSection(
    title: string,
    description?: string,
    labelFor?: string,
    parent?: HTMLElement,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'control-panel__row';

    const text = document.createElement('div');
    text.className = 'control-panel__text';

    const label = document.createElement(labelFor ? 'label' : 'span');
    label.className = 'control-panel__label';
    label.textContent = title;
    if (labelFor && label instanceof HTMLLabelElement) {
      label.htmlFor = labelFor;
    }
    text.appendChild(label);

    if (description) {
      text.appendChild(this.createHint(description));
    }

    const actions = document.createElement('div');
    actions.className = 'control-panel__actions';

    row.append(text, actions);
    (parent ?? this.sectionHost).appendChild(row);
    return actions;
  }

  appendSectionContent(element: HTMLElement) {
    this.sectionHost.appendChild(element);
  }

  addToggle(options: ToggleOptions) {
    const {
      label,
      description,
      defaultValue = false,
      onChange,
      parent,
    } = options;
    const row = document.createElement('label');
    row.className = 'control-panel__row control-panel__row--toggle';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = defaultValue;

    const toggleId = `settings-toggle-${this.toggleCount++}`;
    input.id = toggleId;
    input.setAttribute('aria-label', label);

    const text = document.createElement('div');
    text.className = 'control-panel__text';

    const labelText = document.createElement('span');
    labelText.className = 'control-panel__label';
    labelText.textContent = label;
    text.appendChild(labelText);

    if (description) {
      text.appendChild(this.createHint(description));
    }

    const actions = document.createElement('div');
    actions.className = 'control-panel__actions control-panel__actions--inline';

    input.addEventListener('change', () => onChange?.(input.checked));

    actions.appendChild(input);
    row.append(text, actions);
    (parent ?? this.sectionHost).appendChild(row);
    return input;
  }

  private getInitialPreset(defaultPresetId: string): QualityPreset {
    return getActiveQualityPreset({
      presets: this.qualityPresets,
      defaultPresetId,
      storageKey: this.qualityStorageKey,
    });
  }

  private getScopeHint(storageKey: string): string {
    return getQualityPresetScopeHint(storageKey);
  }

  private createHint(content: string): HTMLElement {
    const hint = document.createElement('small');
    hint.textContent = content;
    return hint;
  }

  private describePresetImpact(preset: QualityPreset): string {
    return describeQualityPresetImpact(preset);
  }

  private handleQualityChange(presetId: string) {
    const preset = setQualityPresetById(presetId, {
      presets: this.qualityPresets,
      storageKey: this.qualityStorageKey,
    });
    if (!preset) return;

    this.updateQualityHint(preset, this.qualityStorageKey);
    this.qualityChangeHandler?.(preset);
  }

  private updateQualityHint(preset: QualityPreset, storageKey: string) {
    if (this.qualityHint) {
      this.qualityHint.textContent = preset.description ?? DEFAULT_QUALITY_HINT;
    }
    if (this.qualityScopeHint) {
      this.qualityScopeHint.textContent = this.getScopeHint(storageKey);
    }
    if (this.qualityChangeSummary) {
      this.qualityChangeSummary.textContent = this.describePresetImpact(preset);
    }
  }
}

let singletonPanel: PersistentSettingsPanel | null = null;

export function getSettingsPanel() {
  if (!singletonPanel) {
    singletonPanel = new PersistentSettingsPanel();
  } else if (!document.body.contains(singletonPanel.getElement())) {
    document.body.appendChild(singletonPanel.getElement());
  }
  return singletonPanel;
}

export function resetSettingsPanelState(
  options: { removePanel?: boolean } = {},
) {
  resetQualityPresetState();

  if (options.removePanel && singletonPanel) {
    singletonPanel.getElement().remove();
    singletonPanel = null;
  }
}
