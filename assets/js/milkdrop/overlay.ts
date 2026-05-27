import type { QualityPreset } from '../core/settings-panel';
import type { EditorPanel } from './overlay/editor-panel';
import { InspectorPanel } from './overlay/inspector-panel';
import type { MilkdropPresetRenderPreview } from './preset-preview.ts';
import type {
  MilkdropCatalogEntry,
  MilkdropCompiledPreset,
  MilkdropEditorSessionState,
  MilkdropFrameState,
} from './types';

const OSD_HIDE_TIMEOUT_MS = 1800;

type OverlayCallbacks = {
  onSelectPreset: (id: string) => void;
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

type OverlayTab = 'editor' | 'inspector';

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
  private readonly editorPanelHost: HTMLElement;
  private readonly editorPanelLoadingState: HTMLElement;
  private readonly inspectorPanel: InspectorPanel;
  private readonly presetOsd: HTMLElement;
  private readonly presetOsdTitle: HTMLElement;
  private readonly presetOsdMeta: HTMLElement;
  private readonly osdBackendEl: HTMLElement;
  private readonly shortcutHud: HTMLElement;
  private readonly shortcutHudToggle: HTMLButtonElement;
  private activeTab: OverlayTab = 'editor';
  private osdHideTimeoutId: number | null = null;
  private editorPanel: EditorPanel | null = null;
  private editorPanelPromise: Promise<EditorPanel | null> | null = null;
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
    this.toggleButton.setAttribute('aria-expanded', 'false');
    this.toggleButton.addEventListener('click', () => this.toggleOpen());

    this.panel = document.createElement('aside');
    this.panel.className = 'milkdrop-overlay__panel';

    this.presetOsd = document.createElement('div');
    this.presetOsd.className = 'milkdrop-overlay__osd';
    this.presetOsd.hidden = true;
    this.presetOsdTitle = document.createElement('div');
    this.presetOsdTitle.className = 'milkdrop-overlay__osd-title';
    this.presetOsdMeta = document.createElement('div');
    this.presetOsdMeta.className = 'milkdrop-overlay__osd-meta';
    const osdBackend = document.createElement('span');
    osdBackend.className = 'milkdrop-overlay__osd-backend';
    osdBackend.textContent = '';
    this.osdBackendEl = osdBackend;
    this.presetOsd.append(this.presetOsdTitle, this.presetOsdMeta, osdBackend);

    this.shortcutHud = document.createElement('section');
    this.shortcutHud.className = 'milkdrop-overlay__shortcut-hud';
    this.shortcutHud.hidden = true;
    const shortcutHeading = document.createElement('div');
    shortcutHeading.className = 'milkdrop-overlay__shortcut-title';
    shortcutHeading.textContent = 'Keyboard shortcuts';
    const shortcutList = document.createElement('ul');
    shortcutList.className = 'milkdrop-overlay__shortcut-list';
    [
      'N / P: next or previous preset',
      'R / B: random or go back',
      'M: toggle overlay',
      'F / 1-5: favorite and rate',
      'H / W: transition and wave mode',
      '?: shortcut help',
    ].forEach((item) => {
      const row = document.createElement('li');
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
    headerActions.append(closeButton, this.shortcutHudToggle);
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
    this.blendSlider.setAttribute('aria-label', 'Blend duration');
    this.blendSlider.addEventListener('input', () => {
      const value = Number.parseFloat(this.blendSlider.value);
      this.blendValue.textContent = `${value.toFixed(2)}s`;
      this.blendSlider.setAttribute(
        'aria-valuetext',
        `${value.toFixed(2)} seconds`,
      );
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
    tabs.setAttribute('role', 'tablist');
    this.tabButtons = (['editor', 'inspector'] as OverlayTab[]).map((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'tab');
      button.dataset.tab = tab;
      button.textContent = tab === 'editor' ? 'Edit' : 'Inspect';
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
    panelBody.append(this.editorPanelHost, this.inspectorPanel.element);

    this.panel.append(header, toolbar, tabs, this.shortcutHud, panelBody);
    this.root.append(this.panel, this.presetOsd, this.fileInput);
    if (showToggle) {
      this.root.prepend(this.toggleButton);
    }
    host.appendChild(this.root);
    this.setActiveTab('editor');

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
    this.toggleButton.setAttribute('aria-expanded', String(this.isOpen()));
    this.syncRootSessionState();
  }

  isOpen() {
    return this.root.classList.contains('is-open');
  }

  openTab(tab: string) {
    this.setActiveTab(tab as OverlayTab);
    this.toggleOpen(true);
  }

  private setActiveTab(tab: OverlayTab) {
    this.activeTab = tab;
    setButtonActive(this.tabButtons, tab);

    this.editorPanelHost.hidden = tab !== 'editor';
    this.inspectorPanel.element.hidden = tab !== 'inspector';

    if (tab === 'editor') {
      this.loadEditorPanel();
    }
    this.syncRootSessionState();
  }

  private async loadEditorPanel() {
    if (this.editorPanelPromise) {
      return;
    }
    this.editorPanelLoadingState.hidden = false;

    this.editorPanelPromise = import('./overlay/editor-panel.ts')
      .then(({ EditorPanel }) => {
        if (this.disposed) {
          return null;
        }
        const panel = new EditorPanel({
          onEditorSourceChange: (source) =>
            this.callbacks.onEditorSourceChange(source),
          onRevertToActive: () => this.callbacks.onRevertToActive(),
          onExport: () => this.callbacks.onExport(),
          onDuplicatePreset: () => this.callbacks.onDuplicatePreset(),
          onDeletePreset: () => this.callbacks.onDeletePreset(),
          onRequestImport: () => this.fileInput.click(),
        });
        this.editorPanel = panel;
        this.editorPanelHost.append(panel.element);
        this.editorPanelLoadingState.hidden = true;
        if (this.pendingEditorDeleteEnabled !== undefined) {
          panel.setDeleteEnabled(this.pendingEditorDeleteEnabled);
        }
        if (this.pendingEditorSessionState) {
          panel.setSessionState(this.pendingEditorSessionState);
        }
        panel.setVisible(this.activeTab === 'editor');
        return panel;
      })
      .catch(() => {
        this.editorPanelLoadingState.textContent = 'Failed to load editor.';
        this.editorPanelLoadingState.hidden = false;
        return null;
      });
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
  }

  setActiveCollectionTag(collectionTag: string | null) {
    if (!collectionTag) {
      return;
    }
    this.syncRootSessionState();
  }

  setSessionState(state: MilkdropEditorSessionState) {
    this.pendingEditorSessionState = state;
    if (this.editorPanel) {
      this.editorPanel.setSessionState(state);
    }
  }

  setQualityPresets(_config: {
    presets: QualityPreset[];
    activePresetId: string;
    storageKey: string;
  }) {
    this.syncRootSessionState();
  }

  setCatalog(
    _presets: MilkdropCatalogEntry[],
    _activePresetId: string,
    _backend: string,
  ) {
    this.syncRootSessionState();
  }

  setPresetPreview(_preview: MilkdropPresetRenderPreview) {
    // browse panel handles previews — no-op
  }

  showPresetOsd(title: string, meta: string, backend: string) {
    this.presetOsdTitle.textContent = title;
    this.presetOsdMeta.textContent = meta;
    this.osdBackendEl.textContent = backend;
    this.presetOsd.hidden = false;
    if (this.osdHideTimeoutId !== null) {
      window.clearTimeout(this.osdHideTimeoutId);
    }
    this.osdHideTimeoutId = window.setTimeout(() => {
      this.presetOsd.hidden = true;
    }, OSD_HIDE_TIMEOUT_MS);
  }

  resetOsdTimer() {
    if (this.osdHideTimeoutId !== null) {
      window.clearTimeout(this.osdHideTimeoutId);
    }
    this.osdHideTimeoutId = window.setTimeout(() => {
      this.presetOsd.hidden = true;
    }, OSD_HIDE_TIMEOUT_MS);
  }

  toggleShortcutHud(open?: boolean) {
    if (typeof open === 'boolean') {
      this.shortcutHud.hidden = !open;
    } else {
      this.shortcutHud.hidden = !this.shortcutHud.hidden;
    }
  }

  setStatus(message: string) {
    this.statusLabel.textContent = message;
    this.statusLabel.hidden = !message;
  }

  setCurrentPresetTitle(title: string) {
    this.currentPresetLabel.textContent = title;
  }

  setInspectorState(state: {
    compiled?: MilkdropCompiledPreset | null;
    frameState?: MilkdropFrameState | null;
    backend?: string | null;
  }) {
    if (state.compiled) {
      this.inspectorPanel.setCompiledPreset(state.compiled);
    }
  }

  shouldRenderInspectorMetrics() {
    return this.activeTab === 'inspector';
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

    root.dataset.sessionDisplayMode = 'tools';
    root.dataset.sessionChrome = 'visible';
  }

  dispose() {
    this.disposed = true;
    this.editorPanel?.element.remove();
    this.root.remove();
    document.removeEventListener('keydown', this.shortcutListener);
  }
}

function setButtonActive(buttons: HTMLButtonElement[], activeId: string) {
  buttons.forEach((button) => {
    const isActive = button.dataset.tab === activeId;
    button.classList.toggle('is-active', isActive);
    button.dataset.active = String(isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
}
