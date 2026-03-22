import type { QualityPreset } from '../core/settings-panel';
import { BrowsePanel } from './overlay/browse-panel';
import { EditorPanel } from './overlay/editor-panel';
import { InspectorPanel } from './overlay/inspector-panel';
import type {
  MilkdropCatalogEntry,
  MilkdropCompiledPreset,
  MilkdropEditorSessionState,
  MilkdropFrameState,
} from './types';

type OverlayCallbacks = {
  onSelectPreset: (id: string) => void;
  onSelectQualityPreset: (presetId: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onSetRating: (id: string, rating: number) => void;
  onToggleAutoplay: (enabled: boolean) => void;
  onTransitionModeChange: (mode: 'blend' | 'cut') => void;
  onGoBackPreset: () => void;
  onNextPreset: () => void;
  onPreviousPreset: () => void;
  onRandomize: () => void;
  onBlendDurationChange: (value: number) => void;
  onImportFiles: (files: FileList) => void;
  onExport: () => void;
  onDuplicatePreset: () => void;
  onDeletePreset: () => void;
  onEditorSourceChange: (source: string) => void;
  onRevertToActive: () => void;
  onInspectorFieldChange: (key: string, value: string | number) => void;
};

function setButtonActive(buttons: HTMLButtonElement[], activeId: string) {
  buttons.forEach((button) => {
    const isActive = button.dataset.tab === activeId;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

export class MilkdropOverlay {
  private readonly callbacks: OverlayCallbacks;
  private readonly root: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly currentPresetLabel: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly autoplayToggle: HTMLInputElement;
  private readonly transitionModeSelect: HTMLSelectElement;
  private readonly blendSlider: HTMLInputElement;
  private readonly blendValue: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly tabButtons: HTMLButtonElement[];
  private readonly browsePanel: BrowsePanel;
  private readonly editorPanel: EditorPanel;
  private readonly inspectorPanel: InspectorPanel;
  private activeTab: 'browse' | 'editor' | 'inspector' = 'browse';

  constructor({
    host = document.body,
    callbacks,
  }: {
    host?: HTMLElement;
    callbacks: OverlayCallbacks;
  }) {
    this.callbacks = callbacks;
    this.root = document.createElement('div');
    this.root.className = 'milkdrop-overlay';

    this.toggleButton = document.createElement('button');
    this.toggleButton.type = 'button';
    this.toggleButton.className = 'milkdrop-overlay__toggle';
    this.toggleButton.textContent = 'Presets';
    this.toggleButton.addEventListener('click', () => this.toggleOpen());

    this.panel = document.createElement('aside');
    this.panel.className = 'milkdrop-overlay__panel';

    const header = document.createElement('div');
    header.className = 'milkdrop-overlay__header';
    const titleBlock = document.createElement('div');
    titleBlock.className = 'milkdrop-overlay__title-block';
    this.currentPresetLabel = document.createElement('div');
    this.currentPresetLabel.className = 'milkdrop-overlay__title';
    this.currentPresetLabel.textContent = 'MilkDrop Visualizer';
    this.statusLabel = document.createElement('div');
    this.statusLabel.className = 'milkdrop-overlay__status';
    this.statusLabel.textContent = 'Loading catalog...';
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'milkdrop-overlay__close';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () =>
      this.root.classList.remove('is-open'),
    );
    titleBlock.append(this.currentPresetLabel, this.statusLabel);
    header.append(titleBlock, closeButton);

    const toolbar = document.createElement('div');
    toolbar.className = 'milkdrop-overlay__toolbar';

    const sessionGroup = document.createElement('div');
    sessionGroup.className = 'milkdrop-overlay__toolbar-group';

    this.autoplayToggle = document.createElement('input');
    this.autoplayToggle.type = 'checkbox';
    this.autoplayToggle.addEventListener('change', () => {
      this.callbacks.onToggleAutoplay(this.autoplayToggle.checked);
    });

    const autoplayLabel = document.createElement('label');
    autoplayLabel.className = 'milkdrop-overlay__checkbox';
    autoplayLabel.append(
      this.autoplayToggle,
      document.createTextNode('Autoplay'),
    );
    sessionGroup.appendChild(autoplayLabel);

    this.transitionModeSelect = document.createElement('select');
    this.transitionModeSelect.className = 'milkdrop-overlay__rating-select';
    (
      [
        { value: 'blend', label: 'Blend' },
        { value: 'cut', label: 'Hard cut' },
      ] satisfies Array<{ value: 'blend' | 'cut'; label: string }>
    ).forEach((optionConfig) => {
      const option = document.createElement('option');
      option.value = optionConfig.value;
      option.textContent = optionConfig.label;
      this.transitionModeSelect.appendChild(option);
    });
    this.transitionModeSelect.addEventListener('change', () => {
      const mode = this.transitionModeSelect.value === 'cut' ? 'cut' : 'blend';
      this.callbacks.onTransitionModeChange(mode);
    });

    const transitionWrap = document.createElement('label');
    transitionWrap.className = 'milkdrop-overlay__toolbar-field';
    const transitionLabel = document.createElement('span');
    transitionLabel.textContent = 'Transition';
    transitionWrap.append(transitionLabel, this.transitionModeSelect);
    sessionGroup.appendChild(transitionWrap);

    const navigationGroup = document.createElement('div');
    navigationGroup.className =
      'milkdrop-overlay__toolbar-group milkdrop-overlay__toolbar-group--transport';

    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.textContent = 'Back';
    backButton.addEventListener('click', () => this.callbacks.onGoBackPreset());
    navigationGroup.appendChild(backButton);

    const previousButton = document.createElement('button');
    previousButton.type = 'button';
    previousButton.textContent = 'Prev';
    previousButton.addEventListener('click', () =>
      this.callbacks.onPreviousPreset(),
    );
    navigationGroup.appendChild(previousButton);

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.textContent = 'Next';
    nextButton.addEventListener('click', () => this.callbacks.onNextPreset());
    navigationGroup.appendChild(nextButton);

    const randomButton = document.createElement('button');
    randomButton.type = 'button';
    randomButton.textContent = 'Random';
    randomButton.addEventListener('click', () => this.callbacks.onRandomize());
    navigationGroup.appendChild(randomButton);

    this.blendSlider = document.createElement('input');
    this.blendSlider.type = 'range';
    this.blendSlider.min = '0';
    this.blendSlider.max = '8';
    this.blendSlider.step = '0.25';
    this.blendSlider.value = '2.5';
    this.blendSlider.addEventListener('input', () => {
      const value = Number.parseFloat(this.blendSlider.value);
      this.blendValue.textContent = `${value.toFixed(2)}s`;
      this.callbacks.onBlendDurationChange(value);
    });
    this.blendValue = document.createElement('span');
    this.blendValue.className = 'milkdrop-overlay__blend-value';
    this.blendValue.textContent = '2.50s';

    const blendWrap = document.createElement('label');
    blendWrap.className = 'milkdrop-overlay__blend';
    blendWrap.append(
      document.createTextNode('Blend'),
      this.blendSlider,
      this.blendValue,
    );

    toolbar.append(sessionGroup, navigationGroup, blendWrap);

    const tabs = document.createElement('div');
    tabs.className = 'milkdrop-overlay__tabs';
    this.tabButtons = ['browse', 'editor', 'inspector'].map((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tab = tab;
      button.textContent = tab[0].toUpperCase() + tab.slice(1);
      button.addEventListener('click', () => this.setActiveTab(tab));
      tabs.appendChild(button);
      return button;
    });

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.milk,.txt,text/plain';
    this.fileInput.multiple = true;
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files?.length) {
        this.callbacks.onImportFiles(this.fileInput.files);
      }
      this.fileInput.value = '';
    });

    this.browsePanel = new BrowsePanel({
      onSelectPreset: (id) => this.callbacks.onSelectPreset(id),
      onSelectQualityPreset: (presetId) =>
        this.callbacks.onSelectQualityPreset(presetId),
      onToggleFavorite: (id, favorite) =>
        this.callbacks.onToggleFavorite(id, favorite),
      onSetRating: (id, rating) => this.callbacks.onSetRating(id, rating),
    });
    this.editorPanel = new EditorPanel({
      onEditorSourceChange: (source) =>
        this.callbacks.onEditorSourceChange(source),
      onRevertToActive: () => this.callbacks.onRevertToActive(),
      onDuplicatePreset: () => this.callbacks.onDuplicatePreset(),
      onExport: () => this.callbacks.onExport(),
      onDeletePreset: () => this.callbacks.onDeletePreset(),
      onRequestImport: () => this.fileInput.click(),
    });
    this.inspectorPanel = new InspectorPanel({
      onInspectorFieldChange: (key, value) =>
        this.callbacks.onInspectorFieldChange(key, value),
    });

    const panelBody = document.createElement('div');
    panelBody.className = 'milkdrop-overlay__body';
    panelBody.append(
      this.browsePanel.element,
      this.editorPanel.element,
      this.inspectorPanel.element,
    );

    this.panel.append(header, toolbar, tabs, panelBody);
    this.root.append(this.toggleButton, this.panel, this.fileInput);
    host.appendChild(this.root);
    this.setActiveTab('browse');
  }

  toggleOpen(force?: boolean) {
    if (typeof force === 'boolean') {
      this.root.classList.toggle('is-open', force);
      return;
    }
    this.root.classList.toggle('is-open');
  }

  isOpen() {
    return this.root.classList.contains('is-open');
  }

  openTab(tab: string) {
    this.setActiveTab(tab);
    this.toggleOpen(true);
  }

  shouldRenderInspectorMetrics() {
    return this.inspectorPanel.shouldRenderMetrics(this.isOpen());
  }

  setCurrentPresetTitle(title: string) {
    if (this.currentPresetLabel.textContent !== title) {
      this.currentPresetLabel.textContent = title;
    }
  }

  setQualityPresets({
    presets,
    activePresetId,
    storageKey,
  }: {
    presets: QualityPreset[];
    activePresetId: string;
    storageKey?: string;
  }) {
    this.browsePanel.setQualityPresets({ presets, activePresetId, storageKey });
  }

  setCatalog(
    presets: MilkdropCatalogEntry[],
    activePresetId: string | null,
    backend: 'webgl' | 'webgpu',
  ) {
    this.browsePanel.setCatalog(presets, activePresetId, backend);
    const activePreset = presets.find((entry) => entry.id === activePresetId);
    this.editorPanel.setDeleteEnabled(
      Boolean(activePreset && activePreset.origin !== 'bundled'),
    );
  }

  setAutoplay(enabled: boolean) {
    this.autoplayToggle.checked = enabled;
  }

  setBlendDuration(value: number) {
    this.blendSlider.value = String(value);
    this.blendValue.textContent = `${value.toFixed(2)}s`;
  }

  setTransitionMode(mode: 'blend' | 'cut') {
    this.transitionModeSelect.value = mode;
    this.blendSlider.disabled = mode === 'cut';
  }

  setSessionState(state: MilkdropEditorSessionState) {
    this.editorPanel.setSessionState(state);
    if (state.activeCompiled) {
      this.inspectorPanel.setCompiledPreset(state.activeCompiled);
    }
  }

  setInspectorState({
    compiled,
    frameState,
    backend,
  }: {
    compiled: MilkdropCompiledPreset | null;
    frameState: MilkdropFrameState | null;
    backend: 'webgl' | 'webgpu';
  }) {
    if (compiled) {
      this.setCurrentPresetTitle(compiled.title);
      this.inspectorPanel.setCompiledPreset(compiled);
    }
    this.inspectorPanel.renderMetrics({
      compiled,
      frameState,
      backend,
      isOpen: this.isOpen(),
    });
  }

  setStatus(message: string) {
    this.statusLabel.textContent = message;
  }

  dispose() {
    this.editorPanel.dispose();
    this.browsePanel.dispose();
    this.root.remove();
  }

  private setActiveTab(tab: string) {
    this.activeTab = tab === 'editor' || tab === 'inspector' ? tab : 'browse';
    this.browsePanel.setVisible(this.activeTab === 'browse');
    this.editorPanel.setVisible(this.activeTab === 'editor');
    this.inspectorPanel.setVisible(this.activeTab === 'inspector');
    setButtonActive(this.tabButtons, this.activeTab);
  }
}
