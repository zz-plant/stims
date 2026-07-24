import {
  applyPerformanceSettings,
  clampPerformanceValue,
  DEFAULT_PERFORMANCE_SETTINGS,
  getActivePerformanceSettings,
  getActivePerformanceStorageKey,
  MAX_PARTICLE_BUDGET,
  MAX_PIXEL_RATIO,
  MIN_PARTICLE_BUDGET,
  MIN_PIXEL_RATIO,
  PERFORMANCE_SETTINGS_STORAGE_KEY,
  type PerformanceSettings,
  parseShaderQuality,
  resetPerformanceSettingsStore,
  subscribeToPerformanceSettings,
} from './state/performance-settings-store.ts';

export {
  getActivePerformanceSettings,
  type PerformanceSettings,
  type ShaderQuality,
  setPerformanceSettings,
  subscribeToPerformanceSettings,
} from './state/performance-settings-store.ts';

export type PerformancePanelOptions = {
  title?: string;
  description?: string;
  storageKey?: string;
};

const STORAGE_KEY = PERFORMANCE_SETTINGS_STORAGE_KEY;
let singletonPanel: PerformancePanel | null = null;

class PerformancePanel {
  private container: HTMLDivElement;
  private heading: HTMLDivElement;
  private description?: HTMLParagraphElement;
  private pixelRatioLabel: HTMLSpanElement;
  private pixelRatioInput: HTMLInputElement;
  private particleLabel: HTMLSpanElement;
  private particleInput: HTMLInputElement;
  private shaderSelect: HTMLSelectElement;
  private storageKey: string;

  constructor(options: PerformancePanelOptions = {}) {
    const {
      title = 'Performance',
      description,
      storageKey = STORAGE_KEY,
    } = options;
    this.storageKey = storageKey;

    this.container = document.createElement('div');
    this.container.className = 'control-panel control-panel--floating';

    this.heading = document.createElement('div');
    this.heading.className = 'control-panel__heading';
    this.heading.textContent = title;
    this.container.appendChild(this.heading);

    if (description) {
      this.description = document.createElement('p');
      this.description.className = 'control-panel__description';
      this.description.textContent = description;
      this.container.appendChild(this.description);
    }

    const pixelRow = this.createRow(
      'Pixel ratio cap',
      'Limit resolution on high-DPI displays to reduce GPU load.',
    );
    this.pixelRatioLabel = this.createValueLabel(pixelRow.actions);
    this.pixelRatioInput = document.createElement('input');
    this.pixelRatioInput.type = 'range';
    this.pixelRatioInput.min = MIN_PIXEL_RATIO.toString();
    this.pixelRatioInput.max = MAX_PIXEL_RATIO.toString();
    this.pixelRatioInput.step = '0.05';
    this.pixelRatioInput.addEventListener('input', () =>
      this.handlePixelRatioInput(),
    );
    pixelRow.actions.appendChild(this.pixelRatioInput);

    const particleRow = this.createRow(
      'Particle budget',
      'Scale particle counts to fit your device. 1.0 keeps defaults.',
    );
    this.particleLabel = this.createValueLabel(particleRow.actions);
    this.particleInput = document.createElement('input');
    this.particleInput.type = 'range';
    this.particleInput.min = MIN_PARTICLE_BUDGET.toString();
    this.particleInput.max = MAX_PARTICLE_BUDGET.toString();
    this.particleInput.step = '0.05';
    this.particleInput.addEventListener('input', () =>
      this.handleParticleInput(),
    );
    particleRow.actions.appendChild(this.particleInput);

    const shaderRow = this.createRow(
      'Shader quality',
      'Choose lighter or heavier shader paths.',
    );
    this.shaderSelect = document.createElement('select');
    ['low', 'balanced', 'high'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent =
        value === 'low'
          ? 'Low (faster)'
          : value === 'high'
            ? 'High (detailed)'
            : 'Balanced';
      this.shaderSelect.appendChild(option);
    });
    this.shaderSelect.addEventListener('change', () =>
      this.handleShaderChange(),
    );
    shaderRow.actions.appendChild(this.shaderSelect);

    document.body.appendChild(this.container);

    subscribeToPerformanceSettings((settings) => this.syncUi(settings));
    this.syncUi(getActivePerformanceSettings({ storageKey }));
  }

  getElement() {
    return this.container;
  }

  configure(options: PerformancePanelOptions = {}) {
    const { title, description, storageKey = STORAGE_KEY } = options;
    if (title) this.heading.textContent = title;
    if (description) {
      if (!this.description) {
        this.description = document.createElement('p');
        this.description.className = 'control-panel__description';
        this.container.insertBefore(
          this.description,
          this.container.children[1],
        );
      }
      this.description.textContent = description;
    }
    this.storageKey = storageKey;
    this.syncUi(getActivePerformanceSettings({ storageKey }));
  }

  private createRow(title: string, description?: string) {
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
    this.container.appendChild(row);

    return { row, actions };
  }

  private createValueLabel(parent: HTMLElement) {
    const badge = document.createElement('span');
    badge.className = 'control-panel__pill';
    parent.appendChild(badge);
    return badge;
  }

  private handlePixelRatioInput() {
    const value = clampPerformanceValue(
      Number.parseFloat(this.pixelRatioInput.value),
      MIN_PIXEL_RATIO,
      MAX_PIXEL_RATIO,
    );
    const next = {
      ...getActivePerformanceSettings({ storageKey: this.storageKey }),
      maxPixelRatio: value,
    };
    applyPerformanceSettings(next, this.storageKey);
  }

  private handleParticleInput() {
    const value = clampPerformanceValue(
      Number.parseFloat(this.particleInput.value),
      MIN_PARTICLE_BUDGET,
      MAX_PARTICLE_BUDGET,
    );
    const next = {
      ...getActivePerformanceSettings({ storageKey: this.storageKey }),
      particleBudget: value,
    };
    applyPerformanceSettings(next, this.storageKey);
  }

  private handleShaderChange() {
    const quality =
      parseShaderQuality(this.shaderSelect.value) ??
      DEFAULT_PERFORMANCE_SETTINGS.shaderQuality;
    const next = {
      ...getActivePerformanceSettings({ storageKey: this.storageKey }),
      shaderQuality: quality,
    };
    applyPerformanceSettings(next, this.storageKey);
  }

  private syncUi(settings: PerformanceSettings) {
    this.pixelRatioInput.value = settings.maxPixelRatio.toFixed(2);
    this.pixelRatioLabel.textContent = `${settings.maxPixelRatio.toFixed(2)}x`;

    this.particleInput.value = settings.particleBudget.toFixed(2);
    this.particleLabel.textContent = `${(settings.particleBudget * 100).toFixed(0)}%`;

    this.shaderSelect.value = settings.shaderQuality;
  }
}

export function getPerformancePanel(options: PerformancePanelOptions = {}) {
  if (!singletonPanel) {
    singletonPanel = new PerformancePanel(options);
  } else if (!document.body.contains(singletonPanel.getElement())) {
    document.body.appendChild(singletonPanel.getElement());
  }
  if (
    options.storageKey &&
    options.storageKey !== getActivePerformanceStorageKey()
  ) {
    singletonPanel.configure(options);
  }
  return singletonPanel;
}

export function resetPerformancePanelState(
  options: { removePanel?: boolean } = {},
) {
  resetPerformanceSettingsStore();

  if (options.removePanel && singletonPanel) {
    singletonPanel.getElement().remove();
    singletonPanel = null;
  }
}
