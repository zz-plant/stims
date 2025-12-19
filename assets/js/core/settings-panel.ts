export type QualityPreset = {
  id: string;
  label: string;
  description?: string;
  maxPixelRatio: number;
  renderScale?: number;
  particleScale?: number;
};

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

export const QUALITY_STORAGE_KEY = 'stims:quality-preset';

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
  defaultPresetId = 'balanced',
  storageKey = QUALITY_STORAGE_KEY,
}: StoredPresetOptions = {}): QualityPreset {
  const storedId = getStorage()?.getItem(storageKey);
  const fromStorage = presets.find((preset) => preset.id === storedId);
  if (fromStorage) return fromStorage;

  return presets.find((preset) => preset.id === defaultPresetId) || presets[0];
}

class PersistentSettingsPanel {
  private container: HTMLDivElement;
  private heading: HTMLDivElement;
  private description?: HTMLParagraphElement;
  private qualityRow?: HTMLDivElement;
  private qualitySelect?: HTMLSelectElement;
  private qualityPresets: QualityPreset[] = [];
  private qualityChangeHandler?: (preset: QualityPreset) => void;
  private sectionHost: HTMLDivElement;
  private qualityStorageKey: string = QUALITY_STORAGE_KEY;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'control-panel control-panel--floating';

    this.heading = document.createElement('div');
    this.heading.className = 'control-panel__heading';
    this.container.appendChild(this.heading);

    this.sectionHost = document.createElement('div');
    this.container.appendChild(this.sectionHost);

    document.body.appendChild(this.container);
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
      defaultPresetId = 'balanced',
      onChange,
      storageKey = QUALITY_STORAGE_KEY,
    } = options;

    this.qualityStorageKey = storageKey;
    this.qualityPresets = presets;
    this.qualityChangeHandler = onChange;

    if (!this.qualityRow) {
      this.qualityRow = document.createElement('div');
      this.qualityRow.className = 'control-panel__row';

      const text = document.createElement('div');
      text.className = 'control-panel__text';

      const label = document.createElement('span');
      label.className = 'control-panel__label';
      label.textContent = 'Quality preset';

      const hint = document.createElement('small');
      hint.textContent = 'Adjust resolution and particle density.';

      text.append(label, hint);

      const select = document.createElement('select');
      select.addEventListener('change', () => this.handleQualityChange(select.value));

      this.qualitySelect = select;
      this.qualityRow.append(text, select);

      this.container.insertBefore(this.qualityRow, this.sectionHost);
    }

    if (!this.qualitySelect) return;

    this.qualitySelect.replaceChildren();
    presets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      this.qualitySelect?.appendChild(option);
    });

    const initialPreset = this.getInitialPreset(defaultPresetId);
    this.qualitySelect.value = initialPreset.id;
    this.handleQualityChange(initialPreset.id);
  }

  addSection(title: string, description?: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'control-panel__row';

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

    const actions = document.createElement('div');
    actions.className = 'control-panel__actions';

    row.append(text, actions);
    this.sectionHost.appendChild(row);
    return actions;
  }

  private getInitialPreset(defaultPresetId: string): QualityPreset {
    return getStoredQualityPreset({
      presets: this.qualityPresets,
      defaultPresetId,
      storageKey: this.qualityStorageKey,
    });
  }

  private handleQualityChange(presetId: string) {
    const preset = this.qualityPresets.find((entry) => entry.id === presetId);
    if (!preset) return;

    getStorage()?.setItem(this.qualityStorageKey, preset.id);
    this.qualityChangeHandler?.(preset);
  }
}

let singletonPanel: PersistentSettingsPanel | null = null;

export function getSettingsPanel() {
  if (!singletonPanel) {
    singletonPanel = new PersistentSettingsPanel();
  }
  return singletonPanel;
}
