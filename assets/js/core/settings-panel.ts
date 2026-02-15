export type QualityPreset = {
  id: string;
  label: string;
  description?: string;
  maxPixelRatio: number;
  renderScale?: number;
  particleScale?: number;
};

type QualitySubscriber = (preset: QualityPreset) => void;

export const DEFAULT_QUALITY_PRESETS: QualityPreset[] = [
  {
    id: 'performance',
    label: 'Battery saver',
    description: 'Lower pixel ratio and fewer particles for older GPUs.',
    maxPixelRatio: 1.25,
    renderScale: 0.9,
    particleScale: 0.65,
  },
  {
    id: 'low-motion',
    label: 'Low motion',
    description: 'Reduce particle density and shimmer for calmer motion.',
    maxPixelRatio: 1.5,
    renderScale: 0.95,
    particleScale: 0.5,
  },
  {
    id: 'tv',
    label: 'TV balanced',
    description:
      'Comfortable 10-foot visuals with lower DPI for steady frame pacing.',
    maxPixelRatio: 1.25,
    renderScale: 0.9,
    particleScale: 0.75,
  },
  {
    id: 'balanced',
    label: 'Balanced (default)',
    description: 'Native look with capped DPI for most laptops and desktops.',
    maxPixelRatio: 2,
    renderScale: 1,
    particleScale: 1,
  },
  {
    id: 'hi-fi',
    label: 'Hi-fi visuals',
    description: 'Higher fidelity for beefy GPUs. May increase thermal load.',
    maxPixelRatio: 2.5,
    renderScale: 1,
    particleScale: 1.35,
  },
];

type PanelConfig = {
  title?: string;
  description?: string;
};

type QualityOptions = {
  presets?: QualityPreset[];
  defaultPresetId?: string;
  onChange?: (preset: QualityPreset) => void;
  storageKey?: string;
};

type ToggleOptions = {
  label: string;
  description?: string;
  defaultValue?: boolean;
  onChange?: (checked: boolean) => void;
};

export const QUALITY_STORAGE_KEY = 'stims:quality-preset';
const DEFAULT_PRESET_ID = 'balanced';
const DEFAULT_QUALITY_HINT = 'Adjust resolution and particle density.';

const qualitySubscribers = new Set<QualitySubscriber>();
let activeQualityPreset: QualityPreset | null = null;
let activeQualityPresetStorageKey: string | null = null;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (error) {
    console.debug('localStorage unavailable', error);
    return null;
  }
}

type StoredPresetOptions = {
  presets?: QualityPreset[];
  defaultPresetId?: string;
  storageKey?: string;
};

export function getStoredQualityPreset({
  presets = DEFAULT_QUALITY_PRESETS,
  defaultPresetId = DEFAULT_PRESET_ID,
  storageKey = QUALITY_STORAGE_KEY,
}: StoredPresetOptions = {}): QualityPreset {
  const storedId = getStorage()?.getItem(storageKey);
  const fromStorage = presets.find((preset) => preset.id === storedId);
  if (fromStorage) return fromStorage;

  return presets.find((preset) => preset.id === defaultPresetId) || presets[0];
}

export function getActiveQualityPreset({
  presets = DEFAULT_QUALITY_PRESETS,
  defaultPresetId = DEFAULT_PRESET_ID,
  storageKey = QUALITY_STORAGE_KEY,
}: StoredPresetOptions = {}): QualityPreset {
  if (activeQualityPreset && activeQualityPresetStorageKey === storageKey) {
    const match = presets.find(
      (preset) => preset.id === activeQualityPreset?.id,
    );
    if (match) return match;
  }

  activeQualityPreset = getStoredQualityPreset({
    presets,
    defaultPresetId,
    storageKey,
  });
  activeQualityPresetStorageKey = storageKey;
  return activeQualityPreset;
}

export function subscribeToQualityPreset(subscriber: QualitySubscriber) {
  qualitySubscribers.add(subscriber);
  if (activeQualityPreset) {
    subscriber(activeQualityPreset);
  }
  return () => {
    qualitySubscribers.delete(subscriber);
  };
}

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
    const { title = 'Toy settings', description } = config;
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
    } = options;

    const hadActivePreset =
      !!activeQualityPreset && activeQualityPresetStorageKey === storageKey;

    this.qualityStorageKey = storageKey;
    this.qualityPresets = presets;
    this.qualityChangeHandler = onChange;

    if (!this.qualityRow) {
      this.qualityRow = document.createElement('div');
      this.qualityRow.className = 'control-panel__row';

      const text = document.createElement('div');
      text.className = 'control-panel__text';

      const selectId = 'quality-preset-select';
      const label = document.createElement('label');
      label.className = 'control-panel__label';
      label.textContent = 'Quality preset';
      label.htmlFor = selectId;

      const hint = document.createElement('small');
      hint.textContent = DEFAULT_QUALITY_HINT;
      this.qualityHint = hint;

      const scopeHint = document.createElement('small');
      scopeHint.textContent = this.getScopeHint(storageKey);
      this.qualityScopeHint = scopeHint;

      const changeSummary = document.createElement('small');
      changeSummary.className = 'control-panel__microcopy';
      this.qualityChangeSummary = changeSummary;

      text.append(label, hint, scopeHint, changeSummary);

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
    this.sectionHost.appendChild(row);
    return actions;
  }

  addToggle(options: ToggleOptions) {
    const { label, description, defaultValue = false, onChange } = options;
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
    this.sectionHost.appendChild(row);
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
    if (storageKey === QUALITY_STORAGE_KEY) {
      return 'Saved on this device and shared across toys.';
    }
    return 'Saved on this device for this toy profile.';
  }

  private createHint(content: string): HTMLElement {
    const hint = document.createElement('small');
    hint.textContent = content;
    return hint;
  }

  private describePresetImpact(preset: QualityPreset): string {
    const render = preset.renderScale ?? 1;
    const particles = preset.particleScale ?? 1;
    return `What changes: pixel ratio up to ${preset.maxPixelRatio.toFixed(2)}x, render scale ${render.toFixed(2)}x, particle density ${particles.toFixed(2)}x.`;
  }

  private handleQualityChange(presetId: string) {
    const preset = this.qualityPresets.find((entry) => entry.id === presetId);
    if (!preset) return;

    getStorage()?.setItem(this.qualityStorageKey, preset.id);
    activeQualityPreset = preset;
    activeQualityPresetStorageKey = this.qualityStorageKey;
    qualitySubscribers.forEach((subscriber) => subscriber(preset));
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
  activeQualityPreset = null;
  activeQualityPresetStorageKey = null;
  qualitySubscribers.clear();

  if (options.removePanel && singletonPanel) {
    singletonPanel.getElement().remove();
    singletonPanel = null;
  }
}
