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
  MilkdropSupportStatus,
} from './types';

type OverlayCallbacks = {
  onSelectPreset: (id: string) => void;
  onToggleFavorite: (id: string, favorite: boolean) => void;
  onSetRating: (id: string, rating: number) => void;
  onToggleAutoplay: (enabled: boolean) => void;
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

function supportLabel(status: MilkdropSupportStatus) {
  if (status === 'supported') {
    return 'Supported';
  }
  if (status === 'partial') {
    return 'Partial';
  }
  return 'Fallback';
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
  private readonly fileInput: HTMLInputElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly activeRating: HTMLSelectElement;
  private readonly tabPanels: Record<string, HTMLElement>;
  private readonly tabButtons: HTMLButtonElement[];
  private editor: EditorView;
  private presets: MilkdropCatalogEntry[] = [];
  private activePresetId: string | null = null;
  private activeBackend: 'webgl' | 'webgpu' = 'webgl';
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
    this.toggleButton.addEventListener('click', () => this.toggleOpen());

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
    closeButton.addEventListener('click', () =>
      this.root.classList.remove('is-open'),
    );
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

    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.textContent = 'Back';
    backButton.addEventListener('click', () => this.callbacks.onGoBackPreset());

    const previousButton = document.createElement('button');
    previousButton.type = 'button';
    previousButton.textContent = 'Prev';
    previousButton.addEventListener('click', () =>
      this.callbacks.onPreviousPreset(),
    );

    const nextButton = document.createElement('button');
    nextButton.type = 'button';
    nextButton.textContent = 'Next';
    nextButton.addEventListener('click', () => this.callbacks.onNextPreset());

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

    this.deleteButton = document.createElement('button');
    this.deleteButton.type = 'button';
    this.deleteButton.textContent = 'Delete';
    this.deleteButton.hidden = true;
    this.deleteButton.addEventListener('click', () =>
      this.callbacks.onDeletePreset(),
    );

    this.activeRating = document.createElement('select');
    this.activeRating.className = 'milkdrop-overlay__rating-select';
    [0, 1, 2, 3, 4, 5].forEach((value) => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = value === 0 ? 'Rate' : `${value}★`;
      this.activeRating.appendChild(option);
    });
    this.activeRating.addEventListener('change', () => {
      if (!this.activePresetId) {
        return;
      }
      this.callbacks.onSetRating(
        this.activePresetId,
        Number.parseInt(this.activeRating.value, 10),
      );
    });

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

    toolbar.append(
      autoplayLabel,
      backButton,
      previousButton,
      nextButton,
      randomButton,
      duplicateButton,
      importButton,
      exportButton,
      this.deleteButton,
      this.activeRating,
      blendWrap,
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
        preset.rating > 0 ? `${preset.rating}★` : null,
        preset.historyIndex !== undefined ? 'recent' : null,
        ...preset.tags.slice(0, 2),
      ]
        .filter(Boolean)
        .join(' · ');

      const support = preset.supports[this.activeBackend];
      const supportBadge = document.createElement('span');
      supportBadge.className = `milkdrop-overlay__support milkdrop-overlay__support--${support.status}`;
      supportBadge.textContent = supportLabel(support.status);
      launch.append(title, meta, supportBadge);

      const actions = document.createElement('div');
      actions.className = 'milkdrop-overlay__preset-actions';

      const favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = 'milkdrop-overlay__favorite';
      favorite.textContent = preset.isFavorite ? 'Starred' : 'Star';
      favorite.addEventListener('click', (event) => {
        event.stopPropagation();
        this.callbacks.onToggleFavorite(preset.id, !preset.isFavorite);
      });

      const rating = document.createElement('select');
      rating.className = 'milkdrop-overlay__rating-select';
      [0, 1, 2, 3, 4, 5].forEach((value) => {
        const option = document.createElement('option');
        option.value = String(value);
        option.textContent = value === 0 ? 'Rate' : `${value}★`;
        rating.appendChild(option);
      });
      rating.value = String(preset.rating);
      rating.addEventListener('change', (event) => {
        event.stopPropagation();
        this.callbacks.onSetRating(
          preset.id,
          Number.parseInt(rating.value, 10),
        );
      });

      actions.append(favorite, rating);

      if (preset.origin !== 'bundled') {
        const removable = document.createElement('span');
        removable.className = 'milkdrop-overlay__preset-flag';
        removable.textContent = 'Delete from toolbar';
        actions.appendChild(removable);
      }

      row.append(launch, actions);

      if (support.reasons.length > 0) {
        const reasons = document.createElement('div');
        reasons.className = 'milkdrop-overlay__preset-warning';
        reasons.textContent = support.reasons[0] as string;
        row.appendChild(reasons);
      }

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

    const fields: HTMLElement[] = [
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
        max: 0.45,
        step: 0.005,
      }),
      this.buildInspectorField(
        'blend_duration',
        'Blend seconds',
        compiled.ir.numericFields.blend_duration,
        {
          min: 0,
          max: 8,
          step: 0.25,
        },
      ),
      this.buildInspectorField(
        'mesh_density',
        'Mesh density',
        compiled.ir.numericFields.mesh_density,
        { min: 8, max: 36, step: 1 },
      ),
      this.buildInspectorField(
        'wave_scale',
        'Main wave scale',
        compiled.ir.numericFields.wave_scale,
        { min: 0.5, max: 2, step: 0.01 },
      ),
      this.buildInspectorField(
        'ob_size',
        'Outer border',
        compiled.ir.numericFields.ob_size,
        {
          min: 0,
          max: 0.3,
          step: 0.005,
        },
      ),
      this.buildInspectorField(
        'ib_size',
        'Inner border',
        compiled.ir.numericFields.ib_size,
        {
          min: 0,
          max: 0.3,
          step: 0.005,
        },
      ),
    ];

    compiled.ir.customWaves.forEach((wave) => {
      fields.push(
        this.buildInspectorField(
          `wavecode_${wave.index - 1}_enabled`,
          `Wave ${wave.index} enabled`,
          wave.fields.enabled ?? 0,
          { min: 0, max: 1, step: 1 },
        ),
      );
      fields.push(
        this.buildInspectorField(
          `wavecode_${wave.index - 1}_samples`,
          `Wave ${wave.index} samples`,
          wave.fields.samples ?? 64,
          { min: 8, max: 192, step: 1 },
        ),
      );
    });

    compiled.ir.customShapes.forEach((shape) => {
      fields.push(
        this.buildInspectorField(
          `shapecode_${shape.index - 1}_enabled`,
          `Shape ${shape.index} enabled`,
          shape.fields.enabled ?? 0,
          { min: 0, max: 1, step: 1 },
        ),
      );
      fields.push(
        this.buildInspectorField(
          `shapecode_${shape.index - 1}_rad`,
          `Shape ${shape.index} radius`,
          shape.fields.rad ?? 0.15,
          { min: 0.04, max: 0.8, step: 0.01 },
        ),
      );
    });

    this.inspectorControls.replaceChildren(...fields);
  }

  setCatalog(
    presets: MilkdropCatalogEntry[],
    activePresetId: string | null,
    backend: 'webgl' | 'webgpu',
  ) {
    this.presets = presets;
    this.activePresetId = activePresetId;
    this.activeBackend = backend;
    this.renderBrowseList();
    const activePreset = this.presets.find(
      (entry) => entry.id === activePresetId,
    );
    this.deleteButton.hidden =
      !activePreset || activePreset.origin === 'bundled';
    this.activeRating.value = String(activePreset?.rating ?? 0);
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
    state.diagnostics.slice(0, 10).forEach((diagnostic) => {
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
    this.activeBackend = backend;
    if (compiled) {
      this.currentPresetLabel.textContent = compiled.title;
    }

    if (!frameState || !compiled) {
      this.inspectorMetrics.textContent = 'Waiting for preview frames...';
      return;
    }

    const support = compiled.ir.compatibility.backends[backend];
    this.inspectorMetrics.innerHTML = `
      <div><strong>Backend:</strong> ${backend}</div>
      <div><strong>Support:</strong> ${supportLabel(support.status)}</div>
      <div><strong>Features:</strong> ${compiled.ir.compatibility.featureAnalysis.featuresUsed.join(', ') || 'base-globals'}</div>
      <div><strong>Frame:</strong> ${frameState.signals.frame}</div>
      <div><strong>Bass / mid / treb:</strong> ${frameState.signals.bass.toFixed(2)} / ${frameState.signals.mid.toFixed(2)} / ${frameState.signals.treb.toFixed(2)}</div>
      <div><strong>Beat pulse:</strong> ${frameState.signals.beatPulse.toFixed(2)}</div>
      <div><strong>Main wave points:</strong> ${Math.floor(frameState.mainWave.positions.length / 3)}</div>
      <div><strong>Custom waves:</strong> ${frameState.customWaves.length}</div>
      <div><strong>Shapes:</strong> ${frameState.shapes.length}</div>
      <div><strong>Borders:</strong> ${frameState.borders.length}</div>
      <div><strong>Register pressure:</strong> q${compiled.ir.compatibility.featureAnalysis.registerUsage.q} / t${compiled.ir.compatibility.featureAnalysis.registerUsage.t}</div>
      <div><strong>Notes:</strong> ${support.reasons[0] ?? 'Validated for the active backend.'}</div>
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
