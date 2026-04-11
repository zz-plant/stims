import type { QualityPreset } from '../core/settings-panel';
import { BrowsePanel } from './overlay/browse-panel';
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

type OverlayPrimaryView = 'browse' | 'tools';
type OverlayToolView = 'editor' | 'inspector';
type OverlayTab = 'browse' | 'editor' | 'inspector';
type EditorPanelInstance = import('./overlay/editor-panel').EditorPanel;

function setButtonActive(buttons: HTMLButtonElement[], activeId: string) {
  buttons.forEach((button) => {
    const isActive = button.dataset.tab === activeId;
    button.classList.toggle('is-active', isActive);
    button.dataset.active = String(isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
}

function isShortcutToggleEvent(event: KeyboardEvent) {
  return event.key === '?' || (event.key === '/' && event.shiftKey);
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
  private readonly editorPanelHost: HTMLElement;
  private readonly editorPanelLoadingState: HTMLElement;
  private readonly inspectorPanel: InspectorPanel;
  private readonly presetOsd: HTMLElement;
  private readonly presetOsdTitle: HTMLElement;
  private readonly presetOsdMeta: HTMLElement;
  private readonly shortcutHud: HTMLElement;
  private readonly shortcutHudToggle: HTMLButtonElement;
  private activeTab: OverlayTab = 'browse';
  private activePresetId: string | null = null;
  private activePresetEntry: MilkdropCatalogEntry | null = null;
  private osdHideTimeoutId: number | null = null;
  private editorPanel: EditorPanelInstance | null = null;
  private editorPanelPromise: Promise<EditorPanelInstance | null> | null = null;
  private pendingEditorDeleteEnabled = false;
  private pendingEditorSessionState: MilkdropEditorSessionState | null = null;
  private disposed = false;
  private readonly shortcutListener: (event: KeyboardEvent) => void;

  constructor({
    host = document.body,
    callbacks,
    showToggle = true,
  }: {
    host?: HTMLElement;
    callbacks: OverlayCallbacks;
    showToggle?: boolean;
  }) {
    this.callbacks = callbacks;
    this.root = document.createElement('div');
    this.root.className = 'milkdrop-overlay';

    this.toggleButton = document.createElement('button');
    this.toggleButton.type = 'button';
    this.toggleButton.className = 'milkdrop-overlay__toggle';
    this.toggleButton.textContent = 'Controls';
    this.toggleButton.addEventListener('click', () => this.toggleOpen());

    this.panel = document.createElement('aside');
    this.panel.className = 'milkdrop-overlay__panel';

    this.syncOverlayDatasets(this.activeTab);

    this.presetOsd = document.createElement('div');
    this.presetOsd.className = 'milkdrop-overlay__osd';
    this.presetOsd.hidden = true;
    this.presetOsdTitle = document.createElement('div');
    this.presetOsdTitle.className = 'milkdrop-overlay__osd-title';
    this.presetOsdMeta = document.createElement('div');
    this.presetOsdMeta.className = 'milkdrop-overlay__osd-meta';
    this.presetOsd.append(this.presetOsdTitle, this.presetOsdMeta);

    this.shortcutHud = document.createElement('section');
    this.shortcutHud.className = 'milkdrop-overlay__shortcut-hud';
    this.shortcutHud.hidden = true;
    const shortcutHeading = document.createElement('div');
    shortcutHeading.className = 'milkdrop-overlay__shortcut-title';
    shortcutHeading.textContent = 'Keyboard shortcuts';
    const shortcutList = document.createElement('div');
    shortcutList.className = 'milkdrop-overlay__shortcut-list';
    [
      'N / P: next or previous preset',
      'R / B: random or go back',
      'M: toggle overlay',
      'F / 1-5: favorite and rate',
      'H / W: transition and wave mode',
      '?: shortcut help',
    ].forEach((item) => {
      const row = document.createElement('div');
      row.className = 'milkdrop-overlay__shortcut-item';
      row.textContent = item;
      shortcutList.appendChild(row);
    });
    this.shortcutHud.append(shortcutHeading, shortcutList);

    const header = document.createElement('div');
    header.className = 'milkdrop-overlay__header';
    const titleBlock = document.createElement('div');
    titleBlock.className = 'milkdrop-overlay__title-block';
    this.currentPresetLabel = document.createElement('div');
    this.currentPresetLabel.className = 'milkdrop-overlay__title';
    this.currentPresetLabel.textContent = 'MilkDrop Visualizer';
    this.statusLabel = document.createElement('div');
    this.statusLabel.className = 'milkdrop-overlay__status';
    this.statusLabel.hidden = true;
    titleBlock.append(this.currentPresetLabel, this.statusLabel);

    const headerActions = document.createElement('div');
    headerActions.className = 'milkdrop-overlay__header-actions';
    this.shortcutHudToggle = document.createElement('button');
    this.shortcutHudToggle.type = 'button';
    this.shortcutHudToggle.className = 'milkdrop-overlay__hud-toggle';
    this.shortcutHudToggle.textContent = 'Shortcuts';
    this.shortcutHudToggle.addEventListener('click', () =>
      this.toggleShortcutHud(),
    );
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'milkdrop-overlay__close';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => this.toggleOpen(false));
    headerActions.append(this.shortcutHudToggle, closeButton);
    header.append(titleBlock, headerActions);

    const toolbar = document.createElement('div');
    toolbar.className = 'milkdrop-overlay__toolbar';

    const transportGroup = document.createElement('div');
    transportGroup.className =
      'milkdrop-overlay__toolbar-group milkdrop-overlay__toolbar-group--transport';
    [
      {
        label: 'Prev',
        className: 'milkdrop-overlay__transport-button',
        action: () => this.callbacks.onPreviousPreset(),
      },
      {
        label: 'Next',
        className: 'milkdrop-overlay__transport-button',
        action: () => this.callbacks.onNextPreset(),
      },
    ].forEach(({ label, className, action }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.textContent = label;
      button.addEventListener('click', action);
      transportGroup.appendChild(button);
    });

    const sessionGroup = document.createElement('div');
    sessionGroup.className = 'milkdrop-overlay__toolbar-group';

    this.autoplayToggle = document.createElement('input');
    this.autoplayToggle.type = 'checkbox';
    this.autoplayToggle.addEventListener('change', () => {
      this.callbacks.onToggleAutoplay(this.autoplayToggle.checked);
    });

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

    toolbar.append(transportGroup, sessionGroup, blendWrap);

    const tabs = document.createElement('div');
    tabs.className = 'milkdrop-overlay__tabs';
    this.tabButtons = ['browse', 'editor', 'inspector'].map((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.tab = tab;
      button.textContent =
        tab === 'browse' ? 'Presets' : tab === 'editor' ? 'Edit' : 'Inspect';
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
    this.inspectorPanel = new InspectorPanel({
      onInspectorFieldChange: (key, value) =>
        this.callbacks.onInspectorFieldChange(key, value),
    });

    this.editorPanelHost = document.createElement('div');
    this.editorPanelHost.className = 'milkdrop-overlay__editor-host';
    this.editorPanelHost.hidden = true;
    this.editorPanelLoadingState = document.createElement('div');
    this.editorPanelLoadingState.className = 'milkdrop-overlay__editor-loading';
    this.editorPanelLoadingState.textContent = 'Loading editor...';
    this.editorPanelLoadingState.hidden = true;
    this.editorPanelHost.appendChild(this.editorPanelLoadingState);

    const panelBody = document.createElement('div');
    panelBody.className = 'milkdrop-overlay__body';
    panelBody.append(
      this.browsePanel.element,
      this.editorPanelHost,
      this.inspectorPanel.element,
    );

    this.panel.append(header, toolbar, tabs, this.shortcutHud, panelBody);
    this.root.append(this.panel, this.presetOsd, this.fileInput);
    if (showToggle) {
      this.root.prepend(this.toggleButton);
    }
    host.appendChild(this.root);
    this.setActiveTab('browse');

    this.shortcutListener = (event) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLElement &&
        (target.closest('.cm-editor') ||
          /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))
      ) {
        return;
      }

      if (isShortcutToggleEvent(event)) {
        this.toggleShortcutHud();
        event.preventDefault();
        return;
      }

      if (event.key === 'Escape' && !this.shortcutHud.hidden) {
        this.shortcutHud.hidden = true;
      }
    };
    document.addEventListener('keydown', this.shortcutListener);
  }

  toggleOpen(force?: boolean) {
    if (typeof force === 'boolean') {
      this.root.classList.toggle('is-open', force);
    } else {
      this.root.classList.toggle('is-open');
    }
    if (!this.isOpen()) {
      this.shortcutHud.hidden = true;
    }
    this.syncRootSessionState();
  }

  isOpen() {
    return this.root.classList.contains('is-open');
  }

  openTab(tab: string) {
    this.setActiveTab(tab);
    this.toggleOpen(true);
  }

  shouldRenderInspectorMetrics() {
    return (
      this.activeTab === 'inspector' &&
      this.inspectorPanel.shouldRenderMetrics(this.isOpen())
    );
  }

  setCurrentPresetTitle(title: string) {
    const previousTitle = this.currentPresetLabel.textContent ?? '';
    if (previousTitle !== title) {
      this.currentPresetLabel.textContent = title;
      this.showPresetOsd(this.activePresetEntry, title);
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

  setActiveCollectionTag(collectionTag: string) {
    this.browsePanel.setActiveCollectionTag(collectionTag);
  }

  setCatalog(
    presets: MilkdropCatalogEntry[],
    activePresetId: string | null,
    backend: 'webgl' | 'webgpu',
  ) {
    const previousActivePresetId = this.activePresetId;
    this.activePresetId = activePresetId;
    this.activePresetEntry =
      presets.find((entry) => entry.id === activePresetId) ?? null;
    this.browsePanel.setCatalog(presets, activePresetId, backend);
    this.pendingEditorDeleteEnabled = Boolean(
      this.activePresetEntry && this.activePresetEntry.origin !== 'bundled',
    );
    this.syncEditorPanelState();
    if (this.activePresetEntry && previousActivePresetId !== activePresetId) {
      this.showPresetOsd(this.activePresetEntry, this.activePresetEntry.title);
    }
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
    this.pendingEditorSessionState = state;
    this.syncEditorPanelState();
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
      presetEntry: this.activePresetEntry,
      isOpen: this.isOpen(),
    });
  }

  setStatus(message: string) {
    const nextMessage = message.trim();
    this.statusLabel.textContent = nextMessage;
    this.statusLabel.hidden = nextMessage.length === 0;
  }

  dispose() {
    this.disposed = true;
    this.editorPanel?.dispose();
    this.browsePanel.dispose();
    if (this.osdHideTimeoutId !== null) {
      window.clearTimeout(this.osdHideTimeoutId);
    }
    document.removeEventListener('keydown', this.shortcutListener);
    this.root.remove();
  }

  toggleShortcutHud(force?: boolean) {
    const shouldOpen =
      typeof force === 'boolean' ? force : this.shortcutHud.hidden;
    this.shortcutHud.hidden = !shouldOpen;
    if (!this.shortcutHud.hidden) {
      this.toggleOpen(true);
    }
  }

  private showPresetOsd(
    preset: MilkdropCatalogEntry | null,
    fallbackTitle: string | null = null,
  ) {
    const title = preset?.title ?? fallbackTitle?.trim();
    if (!title) {
      return;
    }
    this.presetOsdTitle.textContent = title;
    const meta = [
      preset?.author,
      preset?.isFavorite ? 'Favorite' : null,
      preset?.rating ? `${preset.rating}★` : null,
      preset?.origin === 'bundled' ? null : 'Imported',
    ]
      .filter(Boolean)
      .join(' · ');
    this.presetOsdMeta.textContent = meta;
    this.presetOsd.hidden = false;
    if (this.osdHideTimeoutId !== null) {
      window.clearTimeout(this.osdHideTimeoutId);
    }
    this.osdHideTimeoutId = window.setTimeout(() => {
      this.presetOsd.hidden = true;
      this.osdHideTimeoutId = null;
    }, 1800);
  }

  private setActiveTab(tab: string) {
    this.activeTab = tab === 'editor' || tab === 'inspector' ? tab : 'browse';
    this.syncOverlayDatasets(this.activeTab);
    this.browsePanel.setVisible(this.activeTab === 'browse');
    if (this.activeTab === 'editor') {
      this.editorPanelHost.hidden = false;
      this.editorPanelLoadingState.hidden = false;
      void this.ensureEditorPanel();
    } else {
      this.editorPanelHost.hidden = true;
      this.editorPanelLoadingState.hidden = true;
      this.editorPanel?.setVisible(false);
    }
    this.inspectorPanel.setVisible(this.activeTab === 'inspector');
    setButtonActive(this.tabButtons, this.activeTab);
    this.syncRootSessionState();
  }

  private async ensureEditorPanel() {
    if (this.editorPanel || this.editorPanelPromise) {
      return this.editorPanelPromise ?? Promise.resolve(this.editorPanel);
    }
    if (this.disposed) {
      return Promise.resolve(null);
    }

    const isEditorTabActive = this.activeTab === 'editor';
    this.editorPanelLoadingState.hidden = false;
    this.editorPanelPromise = import('./overlay/editor-panel')
      .then(({ EditorPanel }) => {
        if (this.disposed) {
          return null;
        }

        const panel = new EditorPanel({
          onEditorSourceChange: (source) =>
            this.callbacks.onEditorSourceChange(source),
          onRevertToActive: () => this.callbacks.onRevertToActive(),
          onDuplicatePreset: () => this.callbacks.onDuplicatePreset(),
          onExport: () => this.callbacks.onExport(),
          onDeletePreset: () => this.callbacks.onDeletePreset(),
          onRequestImport: () => this.fileInput.click(),
        });

        this.editorPanel = panel;
        this.editorPanelHost.hidden = !isEditorTabActive;
        this.editorPanelHost.replaceChildren(
          this.editorPanelLoadingState,
          panel.element,
        );
        panel.setVisible(isEditorTabActive);
        panel.setDeleteEnabled(this.pendingEditorDeleteEnabled);
        if (this.pendingEditorSessionState) {
          panel.setSessionState(this.pendingEditorSessionState);
        }
        this.editorPanelLoadingState.hidden = true;
        return panel;
      })
      .catch((error) => {
        this.editorPanelPromise = null;
        throw error;
      });

    return this.editorPanelPromise;
  }

  private syncEditorPanelState() {
    const panel = this.editorPanel;
    if (!panel || this.disposed) {
      return;
    }

    panel.setDeleteEnabled(this.pendingEditorDeleteEnabled);
    if (this.pendingEditorSessionState) {
      panel.setSessionState(this.pendingEditorSessionState);
    }
    panel.setVisible(this.activeTab === 'editor');
  }

  private syncOverlayDatasets(tab: OverlayTab) {
    const activeView: OverlayPrimaryView =
      tab === 'browse' ? 'browse' : 'tools';
    const activeToolView: OverlayToolView =
      tab === 'inspector' ? 'inspector' : 'editor';
    this.root.dataset.activeView = activeView;
    this.root.dataset.activeToolView = activeToolView;
    this.panel.dataset.activeView = activeView;
    this.panel.dataset.activeToolView = activeToolView;
  }

  private syncRootSessionState() {
    const root = document.documentElement;
    if (!this.isOpen()) {
      if (
        root.dataset.focusedSession === 'live' &&
        root.dataset.sessionDisplayMode !== 'setup'
      ) {
        root.dataset.sessionDisplayMode = 'immersive';
      }
      return;
    }

    root.dataset.sessionDisplayMode =
      this.activeTab === 'browse' ? 'immersive' : 'tools';
    root.dataset.sessionChrome = 'visible';
  }
}
