import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import type {
  MilkdropCatalogEntry,
  MilkdropCompiledPreset,
  MilkdropEditorSessionState,
  MilkdropFrameState,
} from './types';

type OverlayCallbacks = {
  onSelectPreset: (id: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onToggleAutoplay: (enabled: boolean) => void;
  onRandomize: () => void;
  onBlendDurationChange: (value: number) => void;
  onImportFiles: (files: FileList) => void;
  onExport: () => void;
  onDuplicatePreset: () => void;
  onEditorSourceChange: (source: string) => void;
  onRevertToActive: () => void;
  onInspectorFieldChange: (key: string, value: string | number) => void;
  onRetryWebGL: () => void;
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
  private readonly browseList: HTMLElement;
  private readonly diagnosticsList: HTMLElement;
  private readonly editorStatus: HTMLElement;
  private readonly inspectorControls: HTMLElement;
  private readonly inspectorMetrics: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly autoplayToggle: HTMLInputElement;
  private readonly blendSlider: HTMLInputElement;
  private readonly blendValue: HTMLElement;
  private readonly retryButton: HTMLButtonElement;
  private readonly fileInput: HTMLInputElement;
  private readonly tabPanels: Record<string, HTMLElement>;
  private readonly tabButtons: HTMLButtonElement[];
  private editor: EditorView;
  private presets: MilkdropCatalogEntry[] = [];
  private activePresetId: string | null = null;
  private suppressEditorChange = false;
  private editorDebounceId: number | null = null;
  private lastInspectorSignature = '';

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
    this.toggleButton.addEventListener('click', () => {
      this.root.classList.toggle('is-open');
    });

    this.panel = document.createElement('aside');
    this.panel.className = 'milkdrop-overlay__panel';

    const header = document.createElement('div');
    header.className = 'milkdrop-overlay__header';
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
    closeButton.addEventListener('click', () => {
      this.root.classList.remove('is-open');
    });
    header.append(this.currentPresetLabel, this.statusLabel, closeButton);

    const toolbar = document.createElement('div');
    toolbar.className = 'milkdrop-overlay__toolbar';

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

    const randomButton = document.createElement('button');
    randomButton.type = 'button';
    randomButton.textContent = 'Random';
    randomButton.addEventListener('click', () => this.callbacks.onRandomize());

    const duplicateButton = document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.textContent = 'Duplicate';
    duplicateButton.addEventListener('click', () =>
      this.callbacks.onDuplicatePreset(),
    );

    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.textContent = 'Import';
    importButton.addEventListener('click', () => this.fileInput.click());

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = 'Export';
    exportButton.addEventListener('click', () => this.callbacks.onExport());

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

    this.retryButton = document.createElement('button');
    this.retryButton.type = 'button';
    this.retryButton.textContent = 'Retry in WebGL';
    this.retryButton.hidden = true;
    this.retryButton.addEventListener('click', () =>
      this.callbacks.onRetryWebGL(),
    );

    toolbar.append(
      autoplayLabel,
      randomButton,
      duplicateButton,
      importButton,
      exportButton,
      blendWrap,
      this.retryButton,
    );

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

    this.tabPanels = {
      browse: document.createElement('section'),
      editor: document.createElement('section'),
      inspector: document.createElement('section'),
    };
    Object.values(this.tabPanels).forEach((panel) => {
      panel.className = 'milkdrop-overlay__tab-panel';
    });

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.className = 'milkdrop-overlay__search';
    this.searchInput.placeholder = 'Search presets';
    this.searchInput.addEventListener('input', () => this.renderBrowseList());
    this.browseList = document.createElement('div');
    this.browseList.className = 'milkdrop-overlay__browse';
    this.tabPanels.browse.append(this.searchInput, this.browseList);

    const editorHost = document.createElement('div');
    editorHost.className = 'milkdrop-overlay__editor';
    this.editorStatus = document.createElement('div');
    this.editorStatus.className = 'milkdrop-overlay__editor-status';
    this.editorStatus.textContent = 'Editor ready';
    const revertButton = document.createElement('button');
    revertButton.type = 'button';
    revertButton.textContent = 'Revert to live';
    revertButton.addEventListener('click', () =>
      this.callbacks.onRevertToActive(),
    );
    this.diagnosticsList = document.createElement('div');
    this.diagnosticsList.className = 'milkdrop-overlay__diagnostics';
    this.tabPanels.editor.append(
      this.editorStatus,
      revertButton,
      editorHost,
      this.diagnosticsList,
    );

    this.inspectorControls = document.createElement('div');
    this.inspectorControls.className = 'milkdrop-overlay__inspector-controls';
    this.inspectorMetrics = document.createElement('div');
    this.inspectorMetrics.className = 'milkdrop-overlay__inspector-metrics';
    this.tabPanels.inspector.append(
      this.inspectorControls,
      this.inspectorMetrics,
    );

    const panelBody = document.createElement('div');
    panelBody.className = 'milkdrop-overlay__body';
    panelBody.append(
      this.tabPanels.browse,
      this.tabPanels.editor,
      this.tabPanels.inspector,
    );

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

    this.panel.append(header, toolbar, tabs, panelBody);
    this.root.append(this.toggleButton, this.panel, this.fileInput);
    host.appendChild(this.root);
    this.setActiveTab('browse');

    this.editor = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          history(),
          StreamLanguage.define(properties),
          oneDark,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || this.suppressEditorChange) {
              return;
            }
            if (this.editorDebounceId !== null) {
              window.clearTimeout(this.editorDebounceId);
            }
            this.editorDebounceId = window.setTimeout(() => {
              this.callbacks.onEditorSourceChange(update.state.doc.toString());
            }, 220);
          }),
        ],
      }),
      parent: editorHost,
    });
  }

  private setActiveTab(tab: string) {
    Object.entries(this.tabPanels).forEach(([id, panel]) => {
      panel.hidden = id !== tab;
    });
    setButtonActive(this.tabButtons, tab);
  }

  private renderBrowseList() {
    const query = this.searchInput.value.trim().toLowerCase();
    const filtered = this.presets.filter((preset) => {
      if (!query) {
        return true;
      }
      return (
        preset.title.toLowerCase().includes(query) ||
        preset.author?.toLowerCase().includes(query) ||
        preset.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });

    this.browseList.replaceChildren();
    filtered.forEach((preset) => {
      const row = document.createElement('div');
      row.className = 'milkdrop-overlay__preset';
      row.dataset.active = String(preset.id === this.activePresetId);

      const launch = document.createElement('button');
      launch.type = 'button';
      launch.className = 'milkdrop-overlay__preset-launch';
      launch.addEventListener('click', () =>
        this.callbacks.onSelectPreset(preset.id),
      );

      const title = document.createElement('div');
      title.className = 'milkdrop-overlay__preset-title';
      title.textContent = preset.title;
      const meta = document.createElement('div');
      meta.className = 'milkdrop-overlay__preset-meta';
      meta.textContent = [
        preset.author,
        preset.origin,
        ...preset.tags.slice(0, 2),
      ]
        .filter(Boolean)
        .join(' · ');
      launch.append(title, meta);

      const favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = 'milkdrop-overlay__favorite';
      favorite.textContent = preset.isFavorite ? 'Starred' : 'Star';
      favorite.addEventListener('click', (event) => {
        event.stopPropagation();
        this.callbacks.onToggleFavorite(preset.id, !preset.isFavorite);
      });

      row.append(launch, favorite);
      this.browseList.appendChild(row);
    });
  }

  private buildInspectorField(
    key: string,
    label: string,
    value: string | number,
    options: { min?: number; max?: number; step?: number } = {},
  ) {
    const wrap = document.createElement('label');
    wrap.className = 'milkdrop-overlay__field';
    const title = document.createElement('span');
    title.textContent = label;
    wrap.appendChild(title);

    if (typeof value === 'number') {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(options.min ?? 0);
      input.max = String(options.max ?? 2);
      input.step = String(options.step ?? 0.01);
      input.value = String(value);
      const valueLabel = document.createElement('strong');
      valueLabel.textContent = Number(value).toFixed(2);
      input.addEventListener('input', () => {
        const nextValue = Number.parseFloat(input.value);
        valueLabel.textContent = nextValue.toFixed(2);
        this.callbacks.onInspectorFieldChange(key, nextValue);
      });
      wrap.append(input, valueLabel);
      return wrap;
    }

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = value;
    textInput.addEventListener('change', () => {
      this.callbacks.onInspectorFieldChange(key, textInput.value);
    });
    wrap.appendChild(textInput);
    return wrap;
  }

  private renderInspectorControls(compiled: MilkdropCompiledPreset) {
    const signature = `${compiled.source.id}:${compiled.formattedSource}`;
    if (signature === this.lastInspectorSignature) {
      return;
    }
    this.lastInspectorSignature = signature;

    this.inspectorControls.replaceChildren(
      this.buildInspectorField('title', 'Title', compiled.title),
      this.buildInspectorField('author', 'Author', compiled.author ?? ''),
      this.buildInspectorField('zoom', 'Zoom', compiled.ir.numericFields.zoom, {
        min: 0.75,
        max: 1.4,
        step: 0.01,
      }),
      this.buildInspectorField(
        'rot',
        'Rotation',
        compiled.ir.numericFields.rot,
        {
          min: -0.2,
          max: 0.2,
          step: 0.0025,
        },
      ),
      this.buildInspectorField('warp', 'Warp', compiled.ir.numericFields.warp, {
        min: 0,
        max: 0.4,
        step: 0.005,
      }),
      this.buildInspectorField(
        'mesh_density',
        'Mesh density',
        compiled.ir.numericFields.mesh_density,
        { min: 8, max: 36, step: 1 },
      ),
      this.buildInspectorField(
        'wave_scale',
        'Wave scale',
        compiled.ir.numericFields.wave_scale,
        { min: 0.5, max: 2, step: 0.01 },
      ),
      this.buildInspectorField(
        'decay',
        'Decay',
        compiled.ir.numericFields.decay,
        {
          min: 0.72,
          max: 0.99,
          step: 0.005,
        },
      ),
    );
  }

  setCatalog(presets: MilkdropCatalogEntry[], activePresetId: string | null) {
    this.presets = presets;
    this.activePresetId = activePresetId;
    this.renderBrowseList();
  }

  setAutoplay(enabled: boolean) {
    this.autoplayToggle.checked = enabled;
  }

  setBlendDuration(value: number) {
    this.blendSlider.value = String(value);
    this.blendValue.textContent = `${value.toFixed(2)}s`;
  }

  setSessionState(state: MilkdropEditorSessionState) {
    const nextSource = state.source;
    if (nextSource !== this.editor.state.doc.toString()) {
      this.suppressEditorChange = true;
      this.editor.dispatch({
        changes: {
          from: 0,
          to: this.editor.state.doc.length,
          insert: nextSource,
        },
      });
      this.suppressEditorChange = false;
    }

    const errors = state.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error',
    );
    this.editorStatus.textContent = errors.length
      ? `${errors.length} issue${errors.length === 1 ? '' : 's'} keeping the last good preset live`
      : state.dirty
        ? 'Live preset updated from editor'
        : 'Editor synced with live preset';

    this.diagnosticsList.replaceChildren();
    state.diagnostics.slice(0, 8).forEach((diagnostic) => {
      const item = document.createElement('div');
      item.className = `milkdrop-overlay__diagnostic milkdrop-overlay__diagnostic--${diagnostic.severity}`;
      item.textContent = diagnostic.line
        ? `Line ${diagnostic.line}: ${diagnostic.message}`
        : diagnostic.message;
      this.diagnosticsList.appendChild(item);
    });

    if (state.activeCompiled) {
      this.renderInspectorControls(state.activeCompiled);
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
      this.currentPresetLabel.textContent = compiled.title;
      this.retryButton.hidden = !(
        backend === 'webgpu' && !compiled.ir.compatibility.webgpu
      );
    }

    if (!frameState) {
      this.inspectorMetrics.textContent = 'Waiting for preview frames...';
      return;
    }

    this.inspectorMetrics.innerHTML = `
      <div><strong>Backend:</strong> ${backend}</div>
      <div><strong>Frame:</strong> ${frameState.signals.frame}</div>
      <div><strong>Bass / mids / treble:</strong> ${frameState.signals.bass.toFixed(2)} / ${frameState.signals.mids.toFixed(2)} / ${frameState.signals.treble.toFixed(2)}</div>
      <div><strong>Beat pulse:</strong> ${frameState.signals.beatPulse.toFixed(2)}</div>
      <div><strong>Wave points:</strong> ${Math.floor(frameState.waveform.positions.length / 3)}</div>
      <div><strong>Mesh segments:</strong> ${Math.floor(frameState.mesh.positions.length / 6)}</div>
      <div><strong>Shapes:</strong> ${frameState.shapes.length}</div>
      <div><strong>Compatibility:</strong> ${frameState.compatibility.warnings.length ? frameState.compatibility.warnings.join(' ') : 'All bundled features supported.'}</div>
    `;
  }

  setStatus(message: string) {
    this.statusLabel.textContent = message;
  }

  dispose() {
    this.editor.destroy();
    if (this.editorDebounceId !== null) {
      window.clearTimeout(this.editorDebounceId);
    }
    this.root.remove();
  }
}
