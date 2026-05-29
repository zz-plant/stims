import type { MilkdropPresetRenderPreview } from './preset-preview.ts';
import type {
  MilkdropCompiledPreset,
  MilkdropEditorSessionState,
  MilkdropFrameState,
} from './types';

const OSD_HIDE_TIMEOUT_MS = 1800;

export class MilkdropOverlay {
  readonly root: HTMLElement;
  private readonly autoplayToggle: HTMLInputElement;
  private readonly transitionModeSelect: HTMLSelectElement;
  private readonly blendSlider: HTMLInputElement;
  private readonly blendValue: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly currentPresetLabel: HTMLElement;
  private readonly presetOsd: HTMLElement;
  private readonly presetOsdTitle: HTMLElement;
  private readonly presetOsdMeta: HTMLElement;
  private readonly osdBackendEl: HTMLElement;
  private osdHideTimeoutId: number | null = null;
  private disposed = false;

  constructor({
    host = document.body,
    callbacks,
  }: {
    host?: HTMLElement;
    callbacks: {
      onToggleAutoplay: (enabled: boolean) => void;
      onTransitionModeChange: (mode: 'blend' | 'cut') => void;
      onNextPreset: () => void;
      onPreviousPreset: () => void;
      onBlendDurationChange: (value: number) => void;
    };
  }) {
    this.root = document.createElement('div');
    this.root.className = 'milkdrop-overlay milkdrop-overlay--compact';

    this.presetOsd = document.createElement('div');
    this.presetOsd.className = 'milkdrop-overlay__osd';
    this.presetOsd.hidden = true;
    this.presetOsdTitle = document.createElement('div');
    this.presetOsdTitle.className = 'milkdrop-overlay__osd-title';
    this.presetOsdMeta = document.createElement('div');
    this.presetOsdMeta.className = 'milkdrop-overlay__osd-meta';
    const osdBackend = document.createElement('span');
    osdBackend.className = 'milkdrop-overlay__osd-backend';
    this.osdBackendEl = osdBackend;
    this.presetOsd.append(this.presetOsdTitle, this.presetOsdMeta, osdBackend);

    const toolbar = document.createElement('div');
    toolbar.className = 'milkdrop-overlay__toolbar';

    const transportGroup = document.createElement('div');
    transportGroup.className = 'milkdrop-overlay__toolbar-group milkdrop-overlay__toolbar-group--transport';
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button'; prevBtn.textContent = 'Prev';
    prevBtn.addEventListener('click', () => callbacks.onPreviousPreset());
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button'; nextBtn.textContent = 'Next';
    nextBtn.addEventListener('click', () => callbacks.onNextPreset());
    transportGroup.append(prevBtn, nextBtn);

    const sessionGroup = document.createElement('div');
    sessionGroup.className = 'milkdrop-overlay__toolbar-group';

    this.autoplayToggle = document.createElement('input');
    this.autoplayToggle.type = 'checkbox';
    this.autoplayToggle.addEventListener('change', () => {
      callbacks.onToggleAutoplay(this.autoplayToggle.checked);
      this.updateUrlParams();
    });
    const autoplayLabel = document.createElement('label');
    autoplayLabel.append('Auto', this.autoplayToggle);

    this.transitionModeSelect = document.createElement('select');
    this.transitionModeSelect.className = 'milkdrop-overlay__rating-select';
    (['blend', 'cut'] as const).forEach((mode) => {
      const opt = document.createElement('option');
      opt.value = mode;
      opt.textContent = mode === 'blend' ? 'Blend' : 'Cut';
      this.transitionModeSelect.appendChild(opt);
    });
    this.transitionModeSelect.addEventListener('change', () => {
      const mode = this.transitionModeSelect.value === 'cut' ? 'cut' : 'blend';
      callbacks.onTransitionModeChange(mode);
      this.updateUrlParams();
    });

    this.blendSlider = document.createElement('input');
    this.blendSlider.type = 'range';
    this.blendSlider.min = '0'; this.blendSlider.max = '8';
    this.blendSlider.step = '0.25'; this.blendSlider.value = '2.5';
    this.blendSlider.addEventListener('input', () => {
      const v = Number.parseFloat(this.blendSlider.value);
      this.blendValue.textContent = `${v.toFixed(2)}s`;
      callbacks.onBlendDurationChange(v);
      this.updateUrlParams();
    });
    this.blendValue = document.createElement('span');
    this.blendValue.className = 'milkdrop-overlay__blend-value';
    this.blendValue.textContent = '2.50s';

    const blendWrap = document.createElement('label');
    blendWrap.className = 'milkdrop-overlay__blend';
    blendWrap.append('Blend', this.blendSlider, this.blendValue);

    sessionGroup.append(autoplayLabel, this.transitionModeSelect, blendWrap);
    toolbar.append(transportGroup, sessionGroup);

    this.currentPresetLabel = document.createElement('div');
    this.currentPresetLabel.className = 'milkdrop-overlay__title';

    this.statusLabel = document.createElement('div');
    this.statusLabel.className = 'milkdrop-overlay__status';
    this.statusLabel.hidden = true;

    this.root.append(this.presetOsd, toolbar, this.currentPresetLabel, this.statusLabel);
    host.appendChild(this.root);

    // Read URL state on startup
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const paramAutoplay = searchParams.get('autoplay');
      const paramBlend = searchParams.get('blend');
      const paramTransition = searchParams.get('transition');

      if (paramAutoplay !== null) {
        const isAutoplay = paramAutoplay === 'true';
        this.autoplayToggle.checked = isAutoplay;
        setTimeout(() => callbacks.onToggleAutoplay(isAutoplay), 0);
      }
      if (paramBlend !== null) {
        const blend = Number.parseFloat(paramBlend);
        if (!Number.isNaN(blend)) {
          this.blendSlider.value = String(blend);
          this.blendValue.textContent = `${blend.toFixed(2)}s`;
          setTimeout(() => callbacks.onBlendDurationChange(blend), 0);
        }
      }
      if (paramTransition !== null && (paramTransition === 'blend' || paramTransition === 'cut')) {
        this.transitionModeSelect.value = paramTransition;
        setTimeout(() => callbacks.onTransitionModeChange(paramTransition as 'blend' | 'cut'), 0);
      }
    } catch (_err) {}
  }

  private updateUrlParams() {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      searchParams.set('autoplay', String(this.autoplayToggle.checked));
      searchParams.set('blend', Number.parseFloat(this.blendSlider.value).toFixed(2));
      searchParams.set('transition', this.transitionModeSelect.value);
      const newRelativePathQuery = `${window.location.pathname}?${searchParams.toString()}${window.location.hash}`;
      window.history.replaceState(null, '', newRelativePathQuery);
    } catch (_err) {}
  }

  showPresetOsd(title: string, meta: string, backend: string) {
    this.presetOsdTitle.textContent = title;
    this.presetOsdMeta.textContent = meta;
    this.osdBackendEl.textContent = backend;
    this.presetOsd.hidden = false;
    if (this.osdHideTimeoutId !== null) window.clearTimeout(this.osdHideTimeoutId);
    this.osdHideTimeoutId = window.setTimeout(() => {
      this.presetOsd.hidden = true;
    }, OSD_HIDE_TIMEOUT_MS);
  }

  setCurrentPresetTitle(title: string) {
    this.currentPresetLabel.textContent = title;
  }

  setStatus(message: string) {
    this.statusLabel.textContent = message;
    this.statusLabel.hidden = !message;
  }

  setAutoplay(enabled: boolean) {
    this.autoplayToggle.checked = enabled;
    this.updateUrlParams();
  }
  
  setBlendDuration(value: number) {
    this.blendSlider.value = String(value);
    this.blendValue.textContent = `${value.toFixed(2)}s`;
    this.updateUrlParams();
  }
  
  setTransitionMode(mode: 'blend' | 'cut') {
    this.transitionModeSelect.value = mode;
    this.updateUrlParams();
  }

  isOpen() { return true; }
  toggleOpen(_force?: boolean) {}
  toggleShortcutHud(_open?: boolean) {}
  openTab(_tab: string) {}
  setActiveCollectionTag(_tag: string | null) {}
  setCatalog(..._args: unknown[]) {}
  setPresetPreview(..._args: unknown[]) {}
  setSessionState(..._args: unknown[]) {}
  setQualityPresets(..._args: unknown[]) {}
  setInspectorState(..._args: unknown[]) {}
  shouldRenderInspectorMetrics() { return false; }

  dispose() {
    this.disposed = true;
    this.root.remove();
  }
}
