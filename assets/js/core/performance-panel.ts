export type ShaderQuality = 'low' | 'balanced' | 'high';

export type PerformanceSettings = {
  maxPixelRatio: number;
  particleBudget: number;
  shaderQuality: ShaderQuality;
};

export type PerformancePanelOptions = {
  title?: string;
  description?: string;
  storageKey?: string;
};

const DEFAULT_SETTINGS: PerformanceSettings = {
  maxPixelRatio: 2,
  particleBudget: 1,
  shaderQuality: 'balanced',
};

const STORAGE_KEY = 'stims:performance-settings';
const MIN_PIXEL_RATIO = 1;
const MAX_PIXEL_RATIO = 3;
const MIN_PARTICLE_BUDGET = 0.4;
const MAX_PARTICLE_BUDGET = 1.6;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const subscribers = new Set<(settings: PerformanceSettings) => void>();
let activeSettings: PerformanceSettings | null = null;
let activeStorageKey: string = STORAGE_KEY;
let singletonPanel: PerformancePanel | null = null;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (error) {
    console.debug('localStorage unavailable', error);
    return null;
  }
}

function parseShaderQuality(value: string): ShaderQuality | null {
  if (value === 'low' || value === 'balanced' || value === 'high') {
    return value;
  }
  return null;
}

function parseUrlSettings(): Partial<PerformanceSettings> {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);

  const urlMaxPixelRatio = params.get('maxPixelRatio');
  const urlParticleBudget = params.get('particleBudget');
  const urlShaderQuality = params.get('shaderQuality');

  const parsed: Partial<PerformanceSettings> = {};

  if (urlMaxPixelRatio) {
    const value = Number.parseFloat(urlMaxPixelRatio);
    if (!Number.isNaN(value)) {
      parsed.maxPixelRatio = clamp(value, MIN_PIXEL_RATIO, MAX_PIXEL_RATIO);
    }
  }

  if (urlParticleBudget) {
    const value = Number.parseFloat(urlParticleBudget);
    if (!Number.isNaN(value)) {
      parsed.particleBudget = clamp(
        value,
        MIN_PARTICLE_BUDGET,
        MAX_PARTICLE_BUDGET
      );
    }
  }

  if (urlShaderQuality) {
    const quality = parseShaderQuality(urlShaderQuality);
    if (quality) parsed.shaderQuality = quality;
  }

  return parsed;
}

function getStoredSettings(storageKey = STORAGE_KEY): PerformanceSettings {
  const overrides = parseUrlSettings();
  const storage = getStorage();

  if (!storage) {
    return { ...DEFAULT_SETTINGS, ...overrides };
  }

  const raw = storage.getItem(storageKey);
  if (!raw) {
    return { ...DEFAULT_SETTINGS, ...overrides };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PerformanceSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      ...overrides,
      maxPixelRatio: clamp(
        parsed.maxPixelRatio ?? overrides.maxPixelRatio ?? DEFAULT_SETTINGS.maxPixelRatio,
        MIN_PIXEL_RATIO,
        MAX_PIXEL_RATIO
      ),
      particleBudget: clamp(
        parsed.particleBudget ?? overrides.particleBudget ?? DEFAULT_SETTINGS.particleBudget,
        MIN_PARTICLE_BUDGET,
        MAX_PARTICLE_BUDGET
      ),
      shaderQuality:
        parseShaderQuality(parsed.shaderQuality ?? '') ||
        overrides.shaderQuality ||
        DEFAULT_SETTINGS.shaderQuality,
    };
  } catch (error) {
    console.debug('Unable to parse stored performance settings', error);
    return { ...DEFAULT_SETTINGS, ...overrides };
  }
}

export function getActivePerformanceSettings({
  storageKey = STORAGE_KEY,
}: { storageKey?: string } = {}): PerformanceSettings {
  if (activeSettings && activeStorageKey === storageKey) return activeSettings;

  activeSettings = getStoredSettings(storageKey);
  activeStorageKey = storageKey;
  return activeSettings;
}

export function subscribeToPerformanceSettings(
  subscriber: (settings: PerformanceSettings) => void
) {
  subscribers.add(subscriber);
  if (activeSettings) subscriber(activeSettings);
  return () => subscribers.delete(subscriber);
}

function persistSettings(settings: PerformanceSettings, storageKey = STORAGE_KEY) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(storageKey, JSON.stringify(settings));
}

function applySettings(settings: PerformanceSettings, storageKey = STORAGE_KEY) {
  activeSettings = settings;
  activeStorageKey = storageKey;
  subscribers.forEach((subscriber) => subscriber(settings));
  persistSettings(settings, storageKey);
}

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
    const { title = 'Performance', description, storageKey = STORAGE_KEY } = options;
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
      'Limit resolution on high-DPI displays to reduce GPU load.'
    );
    this.pixelRatioLabel = this.createValueLabel(pixelRow.actions);
    this.pixelRatioInput = document.createElement('input');
    this.pixelRatioInput.type = 'range';
    this.pixelRatioInput.min = MIN_PIXEL_RATIO.toString();
    this.pixelRatioInput.max = MAX_PIXEL_RATIO.toString();
    this.pixelRatioInput.step = '0.05';
    this.pixelRatioInput.addEventListener('input', () => this.handlePixelRatioInput());
    pixelRow.actions.appendChild(this.pixelRatioInput);

    const particleRow = this.createRow(
      'Particle budget',
      'Scale particle counts to fit your device. 1.0 keeps defaults.'
    );
    this.particleLabel = this.createValueLabel(particleRow.actions);
    this.particleInput = document.createElement('input');
    this.particleInput.type = 'range';
    this.particleInput.min = MIN_PARTICLE_BUDGET.toString();
    this.particleInput.max = MAX_PARTICLE_BUDGET.toString();
    this.particleInput.step = '0.05';
    this.particleInput.addEventListener('input', () => this.handleParticleInput());
    particleRow.actions.appendChild(this.particleInput);

    const shaderRow = this.createRow(
      'Shader quality',
      'Choose lighter or heavier shader paths.'
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
    this.shaderSelect.addEventListener('change', () => this.handleShaderChange());
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
        this.container.insertBefore(this.description, this.container.children[1]);
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
    const value = clamp(
      Number.parseFloat(this.pixelRatioInput.value),
      MIN_PIXEL_RATIO,
      MAX_PIXEL_RATIO
    );
    const next = { ...(activeSettings ?? DEFAULT_SETTINGS), maxPixelRatio: value };
    applySettings(next, this.storageKey);
  }

  private handleParticleInput() {
    const value = clamp(
      Number.parseFloat(this.particleInput.value),
      MIN_PARTICLE_BUDGET,
      MAX_PARTICLE_BUDGET
    );
    const next = { ...(activeSettings ?? DEFAULT_SETTINGS), particleBudget: value };
    applySettings(next, this.storageKey);
  }

  private handleShaderChange() {
    const quality = parseShaderQuality(this.shaderSelect.value) ?? DEFAULT_SETTINGS.shaderQuality;
    const next = { ...(activeSettings ?? DEFAULT_SETTINGS), shaderQuality: quality };
    applySettings(next, this.storageKey);
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
  if (options.storageKey && options.storageKey !== activeStorageKey) {
    singletonPanel.configure(options);
  }
  return singletonPanel;
}

export function setPerformanceSettings(settings: Partial<PerformanceSettings>) {
  const current =
    activeSettings ?? getActivePerformanceSettings({ storageKey: activeStorageKey });
  const merged: PerformanceSettings = {
    ...current,
    ...settings,
    maxPixelRatio: clamp(
      settings.maxPixelRatio ?? current.maxPixelRatio,
      MIN_PIXEL_RATIO,
      MAX_PIXEL_RATIO
    ),
    particleBudget: clamp(
      settings.particleBudget ?? current.particleBudget,
      MIN_PARTICLE_BUDGET,
      MAX_PARTICLE_BUDGET
    ),
    shaderQuality: parseShaderQuality(settings.shaderQuality ?? '') ?? current.shaderQuality,
  };
  applySettings(merged, activeStorageKey);
}

export function resetPerformancePanelState(options: { removePanel?: boolean } = {}) {
  activeSettings = null;
  activeStorageKey = STORAGE_KEY;
  subscribers.clear();

  if (options.removePanel && singletonPanel) {
    singletonPanel.getElement().remove();
    singletonPanel = null;
  }
}
