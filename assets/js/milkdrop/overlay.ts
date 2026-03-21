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
import {
  describeQualityPresetImpact,
  getQualityPresetScopeHint,
  QUALITY_STORAGE_KEY,
  type QualityPreset,
} from '../core/settings-panel';
import type {
  MilkdropCatalogEntry,
  MilkdropCompatibilityIssueCategory,
  MilkdropCompiledPreset,
  MilkdropEditorSessionState,
  MilkdropFidelityClass,
  MilkdropFrameState,
  MilkdropSupportStatus,
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

const COLLECTION_TAG_PREFIX = 'collection:';

const COLLECTION_LABELS: Record<string, string> = {
  'collection:classic-milkdrop': 'Classic MilkDrop',
  'collection:feedback-lab': 'Feedback Lab',
  'collection:low-motion': 'Low Motion',
  'collection:touch-friendly': 'Touch Friendly',
};

type BrowseMode = 'featured' | 'all' | 'recent' | 'favorites';
type BrowseSort = 'recommended' | 'title' | 'rating' | 'recent';
type BrowseFidelityFilter = 'all' | MilkdropFidelityClass;

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

function fidelityLabel(fidelity: MilkdropFidelityClass) {
  switch (fidelity) {
    case 'exact':
      return 'Exact';
    case 'near-exact':
      return 'Near exact';
    case 'partial':
      return 'Partial';
    default:
      return 'Fallback';
  }
}

function compatibilityCategoryLabel(
  category: MilkdropCompatibilityIssueCategory,
) {
  switch (category) {
    case 'unsupported-syntax':
      return 'Unsupported syntax';
    case 'unsupported-shader':
      return 'Unsupported shader';
    case 'runtime-divergence':
      return 'Runtime divergence';
    case 'backend-degradation':
      return 'Backend degradation';
    default:
      return 'Approximation';
  }
}

function compatibilityCategoryPriority(
  category: MilkdropCompatibilityIssueCategory,
) {
  switch (category) {
    case 'unsupported-syntax':
      return 0;
    case 'unsupported-shader':
      return 1;
    case 'backend-degradation':
      return 2;
    case 'runtime-divergence':
      return 3;
    default:
      return 4;
  }
}

function getPrimaryDegradationReason(compiled: MilkdropCompiledPreset | null) {
  if (!compiled) {
    return null;
  }
  return [...compiled.ir.compatibility.parity.degradationReasons].sort(
    (left, right) => {
      if (left.blocking !== right.blocking) {
        return left.blocking ? -1 : 1;
      }
      return (
        compatibilityCategoryPriority(left.category) -
        compatibilityCategoryPriority(right.category)
      );
    },
  )[0];
}

export class MilkdropOverlay {
  private readonly callbacks: OverlayCallbacks;
  private readonly root: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly currentPresetLabel: HTMLElement;
  private readonly statusLabel: HTMLElement;
  private readonly browseList: HTMLElement;
  private readonly browseActiveLabel: HTMLElement;
  private readonly browseMetaLabel: HTMLElement;
  private readonly browseQualitySelect: HTMLSelectElement;
  private readonly browseQualityHint: HTMLElement;
  private readonly browseQualityScopeHint: HTMLElement;
  private readonly browseQualityImpact: HTMLElement;
  private readonly diagnosticsList: HTMLElement;
  private readonly editorStatus: HTMLElement;
  private readonly inspectorControls: HTMLElement;
  private readonly inspectorMetrics: HTMLElement;
  private readonly searchInput: HTMLInputElement;
  private readonly collectionFilters: HTMLElement;
  private readonly browseModeSelect: HTMLSelectElement;
  private readonly browseSupportSelect: HTMLSelectElement;
  private readonly browseSortSelect: HTMLSelectElement;
  private readonly autoplayToggle: HTMLInputElement;
  private readonly transitionModeSelect: HTMLSelectElement;
  private readonly blendSlider: HTMLInputElement;
  private readonly blendValue: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly tabPanels: Record<string, HTMLElement>;
  private readonly tabButtons: HTMLButtonElement[];
  private editor: EditorView;
  private presets: MilkdropCatalogEntry[] = [];
  private activePresetId: string | null = null;
  private activeBackend: 'webgl' | 'webgpu' = 'webgl';
  private activeCollectionTag = '';
  private browseMode: BrowseMode = 'featured';
  private browseSort: BrowseSort = 'recommended';
  private browseSupportFilter: BrowseFidelityFilter = 'all';
  private browseQualityPresets: QualityPreset[] = [];
  private browseQualityStorageKey = QUALITY_STORAGE_KEY;
  private suppressEditorChange = false;
  private editorDebounceId: number | null = null;
  private browseRenderDebounceId: number | null = null;
  private browseDirty = true;
  private lastCatalogSignature = '';
  private lastBrowseRenderSignature = '';
  private readonly presetRowCache = new Map<
    string,
    { signature: string; row: HTMLElement }
  >();
  private lastInspectorSignature = '';
  private lastInspectorRenderAt = 0;
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

    this.tabPanels = {
      browse: document.createElement('section'),
      editor: document.createElement('section'),
      inspector: document.createElement('section'),
    };
    Object.values(this.tabPanels).forEach((panel) => {
      panel.className = 'milkdrop-overlay__tab-panel';
    });

    const browseHero = document.createElement('section');
    browseHero.className = 'milkdrop-overlay__browse-hero';

    const browseCopy = document.createElement('div');
    browseCopy.className = 'milkdrop-overlay__browse-copy';

    const browseEyebrow = document.createElement('p');
    browseEyebrow.className = 'milkdrop-overlay__browse-eyebrow';
    browseEyebrow.textContent = 'Preset chooser';

    this.browseActiveLabel = document.createElement('div');
    this.browseActiveLabel.className = 'milkdrop-overlay__browse-active';
    this.browseActiveLabel.textContent = 'Loading presets...';

    this.browseMetaLabel = document.createElement('p');
    this.browseMetaLabel.className = 'milkdrop-overlay__browse-meta';
    this.browseMetaLabel.textContent =
      'Keep playback moving while you browse and tune quality here.';

    browseCopy.append(
      browseEyebrow,
      this.browseActiveLabel,
      this.browseMetaLabel,
    );

    const qualityCard = document.createElement('div');
    qualityCard.className = 'milkdrop-overlay__quality';

    const qualityLabel = document.createElement('label');
    qualityLabel.className = 'milkdrop-overlay__quality-label';
    qualityLabel.textContent = 'Quality preset';

    this.browseQualitySelect = document.createElement('select');
    this.browseQualitySelect.className =
      'milkdrop-overlay__rating-select milkdrop-overlay__quality-select';
    this.browseQualitySelect.setAttribute('aria-label', 'Quality preset');
    this.browseQualitySelect.addEventListener('change', () => {
      this.updateBrowseQualityDetails(this.browseQualitySelect.value);
      this.callbacks.onSelectQualityPreset(this.browseQualitySelect.value);
    });
    qualityLabel.appendChild(this.browseQualitySelect);

    this.browseQualityHint = document.createElement('p');
    this.browseQualityHint.className = 'milkdrop-overlay__quality-hint';

    this.browseQualityScopeHint = document.createElement('p');
    this.browseQualityScopeHint.className = 'milkdrop-overlay__quality-meta';

    this.browseQualityImpact = document.createElement('p');
    this.browseQualityImpact.className = 'milkdrop-overlay__quality-meta';

    qualityCard.append(
      qualityLabel,
      this.browseQualityHint,
      this.browseQualityScopeHint,
      this.browseQualityImpact,
    );

    browseHero.append(browseCopy, qualityCard);

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.className = 'milkdrop-overlay__search';
    this.searchInput.placeholder = 'Search presets';
    this.searchInput.setAttribute('aria-label', 'Search presets');
    this.searchInput.addEventListener('input', () =>
      this.scheduleBrowseRender(),
    );

    this.browseModeSelect = document.createElement('select');
    this.browseModeSelect.className = 'milkdrop-overlay__rating-select';
    (
      [
        ['featured', 'Featured'],
        ['all', 'All presets'],
        ['recent', 'Recent'],
        ['favorites', 'Favorites'],
      ] satisfies Array<[BrowseMode, string]>
    ).forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this.browseModeSelect.appendChild(option);
    });
    this.browseModeSelect.addEventListener('change', () => {
      this.browseMode = this.browseModeSelect.value as BrowseMode;
      this.scheduleBrowseRender(0);
    });

    this.browseSupportSelect = document.createElement('select');
    this.browseSupportSelect.className = 'milkdrop-overlay__rating-select';
    (
      [
        ['all', 'Any fidelity'],
        ['exact', 'Exact'],
        ['near-exact', 'Near exact'],
        ['partial', 'Partial'],
        ['fallback', 'Fallback'],
      ] satisfies Array<[BrowseFidelityFilter, string]>
    ).forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this.browseSupportSelect.appendChild(option);
    });
    this.browseSupportSelect.addEventListener('change', () => {
      this.browseSupportFilter = this.browseSupportSelect
        .value as BrowseFidelityFilter;
      this.scheduleBrowseRender(0);
    });

    this.browseSortSelect = document.createElement('select');
    this.browseSortSelect.className = 'milkdrop-overlay__rating-select';
    (
      [
        ['recommended', 'Recommended'],
        ['recent', 'Recently used'],
        ['rating', 'Top rated'],
        ['title', 'Title'],
      ] satisfies Array<[BrowseSort, string]>
    ).forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this.browseSortSelect.appendChild(option);
    });
    this.browseSortSelect.addEventListener('change', () => {
      this.browseSort = this.browseSortSelect.value as BrowseSort;
      this.scheduleBrowseRender(0);
    });

    const browseControls = document.createElement('div');
    browseControls.className = 'milkdrop-overlay__browse-controls';
    browseControls.append(
      this.buildBrowseControl('Search', this.searchInput, true),
      this.buildBrowseControl('View', this.browseModeSelect),
      this.buildBrowseControl('Fidelity', this.browseSupportSelect),
      this.buildBrowseControl('Sort', this.browseSortSelect),
    );

    this.collectionFilters = document.createElement('div');
    this.collectionFilters.className = 'milkdrop-overlay__collection-filters';
    this.browseList = document.createElement('div');
    this.browseList.className = 'milkdrop-overlay__browse';
    this.tabPanels.browse.append(
      browseHero,
      browseControls,
      this.collectionFilters,
      this.browseList,
    );

    const editorHost = document.createElement('div');
    editorHost.className = 'milkdrop-overlay__editor';
    this.editorStatus = document.createElement('div');
    this.editorStatus.className = 'milkdrop-overlay__editor-status';
    this.editorStatus.textContent = 'Editor ready';

    const editorActions = document.createElement('div');
    editorActions.className = 'milkdrop-overlay__editor-actions';

    const revertButton = document.createElement('button');
    revertButton.type = 'button';
    revertButton.textContent = 'Revert to live';
    revertButton.addEventListener('click', () =>
      this.callbacks.onRevertToActive(),
    );
    editorActions.appendChild(revertButton);

    const duplicateButton = document.createElement('button');
    duplicateButton.type = 'button';
    duplicateButton.textContent = 'Duplicate';
    duplicateButton.addEventListener('click', () =>
      this.callbacks.onDuplicatePreset(),
    );
    editorActions.appendChild(duplicateButton);

    editorActions.append(importButton, exportButton, this.deleteButton);

    this.diagnosticsList = document.createElement('div');
    this.diagnosticsList.className = 'milkdrop-overlay__diagnostics';
    this.tabPanels.editor.append(
      this.editorStatus,
      editorActions,
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

  openTab(tab: string) {
    this.setActiveTab(tab);
    this.toggleOpen(true);
  }

  shouldRenderInspectorMetrics() {
    return this.isOpen() && this.activeTab === 'inspector';
  }

  setCurrentPresetTitle(title: string) {
    if (this.currentPresetLabel.textContent !== title) {
      this.currentPresetLabel.textContent = title;
    }
  }

  private setActiveTab(tab: string) {
    this.activeTab = tab === 'editor' || tab === 'inspector' ? tab : 'browse';
    Object.entries(this.tabPanels).forEach(([id, panel]) => {
      panel.hidden = id !== tab;
    });
    setButtonActive(this.tabButtons, tab);
    if (this.activeTab === 'browse' && this.browseDirty) {
      this.renderCollectionFilters();
      this.renderBrowseList();
    }
  }

  private buildBrowseControl(
    label: string,
    control: HTMLInputElement | HTMLSelectElement,
    isSearch = false,
  ) {
    const wrap = document.createElement('label');
    wrap.className = `milkdrop-overlay__browse-control${isSearch ? ' milkdrop-overlay__browse-control--search' : ''}`;

    const title = document.createElement('span');
    title.className = 'milkdrop-overlay__browse-control-label';
    title.textContent = label;

    wrap.append(title, control);
    return wrap;
  }

  private updateBrowseQualityDetails(presetId: string) {
    const preset = this.browseQualityPresets.find(
      (entry) => entry.id === presetId,
    );
    if (!preset) {
      return;
    }

    this.browseQualitySelect.value = preset.id;
    this.browseQualityHint.textContent = preset.description ?? '';
    this.browseQualityScopeHint.textContent = getQualityPresetScopeHint(
      this.browseQualityStorageKey,
    );
    this.browseQualityImpact.textContent = describeQualityPresetImpact(preset);
  }

  private renderBrowseSummary(filteredCount = this.presets.length) {
    const activePreset = this.presets.find(
      (entry) => entry.id === this.activePresetId,
    );
    this.browseActiveLabel.textContent = activePreset
      ? `Now playing ${activePreset.title}`
      : 'Preset chooser';
    this.browseMetaLabel.textContent = [
      `${filteredCount} shown`,
      `${this.presets.length} total`,
      this.activeBackend.toUpperCase(),
    ].join(' · ');
  }

  private matchesBrowseFilters(preset: MilkdropCatalogEntry, query: string) {
    const collectionTag = this.activeCollectionTag;
    if (collectionTag && !preset.tags.includes(collectionTag)) {
      return false;
    }

    if (
      this.browseSupportFilter !== 'all' &&
      preset.fidelityClass !== this.browseSupportFilter
    ) {
      return false;
    }

    if (this.browseMode === 'recent' && preset.historyIndex === undefined) {
      return false;
    }
    if (this.browseMode === 'favorites' && !preset.isFavorite) {
      return false;
    }

    if (!query) {
      return true;
    }

    return (
      preset.title.toLowerCase().includes(query) ||
      preset.author?.toLowerCase().includes(query) ||
      preset.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  }

  private sortBrowsePresets(presets: MilkdropCatalogEntry[]) {
    const sorted = [...presets];
    sorted.sort((left, right) => {
      if (this.browseSort === 'title') {
        return left.title.localeCompare(right.title);
      }
      if (this.browseSort === 'rating') {
        if (left.rating !== right.rating) {
          return right.rating - left.rating;
        }
        return left.title.localeCompare(right.title);
      }
      if (this.browseSort === 'recent') {
        const leftRecent = left.historyIndex ?? Number.MAX_SAFE_INTEGER;
        const rightRecent = right.historyIndex ?? Number.MAX_SAFE_INTEGER;
        if (leftRecent !== rightRecent) {
          return leftRecent - rightRecent;
        }
        return left.title.localeCompare(right.title);
      }

      if (left.isFavorite !== right.isFavorite) {
        return left.isFavorite ? -1 : 1;
      }
      if (
        (left.curatedRank ?? Number.MAX_SAFE_INTEGER) !==
        (right.curatedRank ?? Number.MAX_SAFE_INTEGER)
      ) {
        return (
          (left.curatedRank ?? Number.MAX_SAFE_INTEGER) -
          (right.curatedRank ?? Number.MAX_SAFE_INTEGER)
        );
      }
      if (left.rating !== right.rating) {
        return right.rating - left.rating;
      }
      return left.title.localeCompare(right.title);
    });
    return sorted;
  }

  private buildPresetRow(preset: MilkdropCatalogEntry) {
    const row = document.createElement('div');
    row.className = 'milkdrop-overlay__preset';
    row.dataset.active = String(preset.id === this.activePresetId);

    const launch = document.createElement('button');
    launch.type = 'button';
    launch.className = 'milkdrop-overlay__preset-launch';
    launch.addEventListener('click', () =>
      this.callbacks.onSelectPreset(preset.id),
    );

    const titleRow = document.createElement('div');
    titleRow.className = 'milkdrop-overlay__preset-header';

    const title = document.createElement('div');
    title.className = 'milkdrop-overlay__preset-title';
    title.textContent = preset.title;

    const badges = document.createElement('div');
    badges.className = 'milkdrop-overlay__preset-badges';

    if (preset.id === this.activePresetId) {
      const activeBadge = document.createElement('span');
      activeBadge.className =
        'milkdrop-overlay__preset-tag milkdrop-overlay__preset-tag--active';
      activeBadge.textContent = 'Live';
      badges.appendChild(activeBadge);
    }

    if (preset.isFavorite) {
      const favoriteBadge = document.createElement('span');
      favoriteBadge.className = 'milkdrop-overlay__preset-tag';
      favoriteBadge.textContent = 'Saved';
      badges.appendChild(favoriteBadge);
    }

    const support = preset.supports[this.activeBackend];
    const supportBadge = document.createElement('span');
    supportBadge.className = `milkdrop-overlay__support milkdrop-overlay__support--${preset.fidelityClass}`;
    supportBadge.textContent = fidelityLabel(preset.fidelityClass);
    badges.appendChild(supportBadge);

    titleRow.append(title, badges);

    const meta = document.createElement('div');
    meta.className = 'milkdrop-overlay__preset-meta';
    meta.textContent = [
      preset.author,
      preset.origin,
      preset.certification,
      preset.rating > 0 ? `${preset.rating}★` : null,
      preset.historyIndex !== undefined ? 'recent' : null,
      ...preset.tags
        .filter((tag) => !tag.startsWith(COLLECTION_TAG_PREFIX))
        .slice(0, 2),
    ]
      .filter(Boolean)
      .join(' · ');

    launch.append(titleRow, meta);

    const actions = document.createElement('div');
    actions.className = 'milkdrop-overlay__preset-actions';

    const favorite = document.createElement('button');
    favorite.type = 'button';
    favorite.className = 'milkdrop-overlay__favorite';
    favorite.textContent = preset.isFavorite ? 'Saved' : 'Save';
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
      this.callbacks.onSetRating(preset.id, Number.parseInt(rating.value, 10));
    });

    actions.append(favorite, rating);

    if (preset.origin !== 'bundled') {
      const removable = document.createElement('span');
      removable.className = 'milkdrop-overlay__preset-flag';
      removable.textContent = 'Delete from toolbar';
      actions.appendChild(removable);
    }

    row.append(launch, actions);

    if (
      preset.parity.degradationReasons.length > 0 ||
      support.reasons.length > 0
    ) {
      const reasons = document.createElement('div');
      reasons.className = 'milkdrop-overlay__preset-warning';
      const primaryReason = [...preset.parity.degradationReasons].sort(
        (left, right) => {
          if (left.blocking !== right.blocking) {
            return left.blocking ? -1 : 1;
          }
          return (
            compatibilityCategoryPriority(left.category) -
            compatibilityCategoryPriority(right.category)
          );
        },
      )[0];
      reasons.textContent = primaryReason
        ? `${compatibilityCategoryLabel(primaryReason.category)}: ${primaryReason.message}`
        : (support.reasons[0] ?? 'Preset has fidelity degradations.');
      row.appendChild(reasons);
    }

    return row;
  }

  private getPresetRowSignature(preset: MilkdropCatalogEntry) {
    const support = preset.supports[this.activeBackend];
    const primaryReason = [...preset.parity.degradationReasons].sort(
      (left, right) => {
        if (left.blocking !== right.blocking) {
          return left.blocking ? -1 : 1;
        }
        return (
          compatibilityCategoryPriority(left.category) -
          compatibilityCategoryPriority(right.category)
        );
      },
    )[0];
    return [
      preset.id,
      preset.title,
      preset.author ?? '',
      preset.origin,
      preset.certification,
      preset.rating,
      preset.isFavorite ? 1 : 0,
      preset.historyIndex ?? -1,
      preset.tags.join(','),
      this.activePresetId === preset.id ? 1 : 0,
      this.activeBackend,
      support.status,
      support.reasons[0] ?? '',
      primaryReason?.category ?? '',
      primaryReason?.message ?? '',
    ].join('|');
  }

  private getPresetRow(preset: MilkdropCatalogEntry) {
    const signature = this.getPresetRowSignature(preset);
    const cached = this.presetRowCache.get(preset.id);
    if (cached && cached.signature === signature) {
      return cached.row;
    }
    const row = this.buildPresetRow(preset);
    this.presetRowCache.set(preset.id, { signature, row });
    return row;
  }

  private appendPresetSection(
    title: string,
    presets: MilkdropCatalogEntry[],
    target: DocumentFragment | HTMLElement = this.browseList,
  ) {
    if (presets.length === 0) {
      return;
    }
    const section = document.createElement('section');
    section.className = 'milkdrop-overlay__browse-section';
    const heading = document.createElement('div');
    heading.className = 'milkdrop-overlay__browse-heading';
    heading.textContent = title;
    const count = document.createElement('span');
    count.className = 'milkdrop-overlay__browse-count';
    count.textContent = String(presets.length);
    heading.appendChild(count);
    section.appendChild(heading);
    presets.forEach((preset) => {
      section.appendChild(this.getPresetRow(preset));
    });
    target.appendChild(section);
  }

  private scheduleBrowseRender(delayMs = 120) {
    this.browseDirty = true;
    if (this.activeTab !== 'browse') {
      return;
    }
    if (this.browseRenderDebounceId !== null) {
      window.clearTimeout(this.browseRenderDebounceId);
    }
    this.browseRenderDebounceId = window.setTimeout(() => {
      this.browseRenderDebounceId = null;
      this.renderBrowseList();
    }, delayMs);
  }

  private renderBrowseList() {
    const query = this.searchInput.value.trim().toLowerCase();
    const renderSignature = [
      this.lastCatalogSignature,
      this.activePresetId ?? '',
      this.activeBackend,
      this.activeCollectionTag,
      this.browseMode,
      this.browseSupportFilter,
      this.browseSort,
      query,
    ].join('|');
    if (
      renderSignature === this.lastBrowseRenderSignature &&
      !this.browseDirty
    ) {
      return;
    }
    this.lastBrowseRenderSignature = renderSignature;
    this.browseDirty = false;
    const filtered = this.sortBrowsePresets(
      this.presets.filter((preset) => this.matchesBrowseFilters(preset, query)),
    );

    const fragment = document.createDocumentFragment();
    this.renderBrowseSummary(filtered.length);
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'milkdrop-overlay__browse-empty';
      empty.textContent = 'No presets match the current filters.';
      this.browseList.replaceChildren(empty);
      return;
    }

    const useSections =
      this.browseMode === 'featured' &&
      !query &&
      !this.activeCollectionTag &&
      this.browseSupportFilter === 'all' &&
      this.browseSort === 'recommended';

    if (!useSections) {
      filtered.forEach((preset) => {
        fragment.appendChild(this.getPresetRow(preset));
      });
      this.browseList.replaceChildren(fragment);
      return;
    }

    const recent = filtered
      .filter((preset) => preset.historyIndex !== undefined)
      .slice(0, 6);
    const favorites = filtered
      .filter((preset) => preset.isFavorite)
      .slice(0, 6);
    const classic = filtered
      .filter((preset) => preset.tags.includes('collection:classic-milkdrop'))
      .slice(0, 8);
    const feedback = filtered
      .filter((preset) => preset.tags.includes('collection:feedback-lab'))
      .slice(0, 8);
    const lowMotion = filtered
      .filter((preset) => preset.tags.includes('collection:low-motion'))
      .slice(0, 6);

    const seen = new Set<string>();
    const dedupe = (presets: MilkdropCatalogEntry[]) =>
      presets.filter((preset) => {
        if (seen.has(preset.id)) {
          return false;
        }
        seen.add(preset.id);
        return true;
      });

    this.appendPresetSection('Jump back in', dedupe(recent), fragment);
    this.appendPresetSection('Favorites', dedupe(favorites), fragment);
    this.appendPresetSection('Classic MilkDrop', dedupe(classic), fragment);
    this.appendPresetSection('Feedback Lab', dedupe(feedback), fragment);
    this.appendPresetSection('Low Motion', dedupe(lowMotion), fragment);
    this.appendPresetSection(
      'More presets',
      dedupe(filtered).slice(0, 12),
      fragment,
    );
    this.browseList.replaceChildren(fragment);
  }

  private renderCollectionFilters() {
    const collectionTags = [
      ...new Set(
        this.presets.flatMap((preset) =>
          preset.tags.filter((tag) => tag.startsWith(COLLECTION_TAG_PREFIX)),
        ),
      ),
    ].sort((left, right) => {
      return (COLLECTION_LABELS[left] ?? left).localeCompare(
        COLLECTION_LABELS[right] ?? right,
      );
    });

    const fragment = document.createDocumentFragment();
    const options = [
      { tag: '', label: 'All presets' },
      ...collectionTags.map((tag) => ({
        tag,
        label:
          COLLECTION_LABELS[tag] ??
          tag.slice(COLLECTION_TAG_PREFIX.length).replace(/-/gu, ' '),
      })),
    ];

    options.forEach((option) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'milkdrop-overlay__collection-filter';
      button.textContent = option.label;
      button.dataset.active = String(option.tag === this.activeCollectionTag);
      button.addEventListener('click', () => {
        this.activeCollectionTag = option.tag;
        this.browseDirty = true;
        this.renderCollectionFilters();
        this.renderBrowseList();
      });
      fragment.appendChild(button);
    });
    this.collectionFilters.replaceChildren(fragment);
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

  setQualityPresets({
    presets,
    activePresetId,
    storageKey = QUALITY_STORAGE_KEY,
  }: {
    presets: QualityPreset[];
    activePresetId: string;
    storageKey?: string;
  }) {
    this.browseQualityPresets = presets;
    this.browseQualityStorageKey = storageKey;

    this.browseQualitySelect.replaceChildren();
    presets.forEach((preset) => {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.label;
      this.browseQualitySelect.appendChild(option);
    });

    const initialPreset =
      presets.find((preset) => preset.id === activePresetId) ?? presets[0];
    if (!initialPreset) {
      this.browseQualitySelect.disabled = true;
      this.browseQualityHint.textContent = '';
      this.browseQualityScopeHint.textContent = '';
      this.browseQualityImpact.textContent = '';
      return;
    }

    this.browseQualitySelect.disabled = false;
    this.updateBrowseQualityDetails(initialPreset.id);
  }

  setCatalog(
    presets: MilkdropCatalogEntry[],
    activePresetId: string | null,
    backend: 'webgl' | 'webgpu',
  ) {
    const catalogSignature = presets
      .map((preset) =>
        [
          preset.id,
          preset.rating,
          preset.isFavorite ? 1 : 0,
          preset.historyIndex ?? -1,
          preset.tags.join(','),
          preset.supports[backend].status,
        ].join(':'),
      )
      .join('|');
    const activeChanged =
      this.activePresetId !== activePresetId || this.activeBackend !== backend;
    this.presets = presets;
    this.activePresetId = activePresetId;
    this.activeBackend = backend;
    this.browseDirty =
      this.browseDirty ||
      activeChanged ||
      this.lastCatalogSignature !== catalogSignature;
    this.lastCatalogSignature = catalogSignature;
    const validIds = new Set(presets.map((preset) => preset.id));
    Array.from(this.presetRowCache.keys()).forEach((id) => {
      if (!validIds.has(id)) {
        this.presetRowCache.delete(id);
      }
    });
    if (this.activeTab === 'browse') {
      this.renderCollectionFilters();
      this.renderBrowseList();
    }
    const activePreset = this.presets.find(
      (entry) => entry.id === activePresetId,
    );
    this.deleteButton.hidden =
      !activePreset || activePreset.origin === 'bundled';
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
    const primaryReason = getPrimaryDegradationReason(state.latestCompiled);
    const activeCompatibility = state.latestCompiled?.ir.compatibility.parity;
    const latestWebglStatus =
      state.latestCompiled?.ir.compatibility.backends.webgl.status;
    const latestWebgpuStatus =
      state.latestCompiled?.ir.compatibility.backends.webgpu.status;
    const baseStatus = errors.length
      ? `${errors.length} issue${errors.length === 1 ? '' : 's'} keeping the last good preset live`
      : state.dirty
        ? 'Live preset updated from editor'
        : 'Editor synced with live preset';
    const fidelityStatus = activeCompatibility
      ? `Fidelity ${fidelityLabel(activeCompatibility.fidelityClass)} · WebGL ${latestWebglStatus} · WebGPU ${latestWebgpuStatus}`
      : null;
    this.editorStatus.textContent = [baseStatus, fidelityStatus]
      .filter(Boolean)
      .join(' | ');

    this.diagnosticsList.replaceChildren();
    const derivedNotices = [
      primaryReason
        ? {
            severity: primaryReason.blocking ? 'warning' : 'info',
            message: `${compatibilityCategoryLabel(primaryReason.category)}: ${primaryReason.message}`,
          }
        : null,
    ].filter(Boolean) as Array<{
      severity: 'warning' | 'info';
      message: string;
    }>;

    [...state.diagnostics.slice(0, 8), ...derivedNotices]
      .slice(0, 10)
      .forEach((diagnostic) => {
        const item = document.createElement('div');
        item.className = `milkdrop-overlay__diagnostic milkdrop-overlay__diagnostic--${diagnostic.severity}`;
        item.textContent =
          'line' in diagnostic && diagnostic.line
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
      this.setCurrentPresetTitle(compiled.title);
    }

    if (!frameState || !compiled) {
      if (this.shouldRenderInspectorMetrics()) {
        this.inspectorMetrics.textContent = 'Waiting for preview frames...';
      }
      return;
    }

    if (!this.shouldRenderInspectorMetrics()) {
      return;
    }

    const support = compiled.ir.compatibility.backends[backend];
    const parity = compiled.ir.compatibility.parity;
    const primaryReason = getPrimaryDegradationReason(compiled);
    const degradationCategorySummary =
      parity.degradationReasons.length > 0
        ? [
            ...new Set(
              parity.degradationReasons.map((reason) =>
                compatibilityCategoryLabel(reason.category),
              ),
            ),
          ].join(', ')
        : 'None';
    const metricsMarkup = `
      <div><strong>Backend:</strong> ${backend}</div>
      <div><strong>Transport support:</strong> ${supportLabel(support.status)}</div>
      <div><strong>Fidelity:</strong> ${fidelityLabel(parity.fidelityClass)}</div>
      <div><strong>Certification:</strong> ${compiled.source.origin === 'bundled' ? 'bundled' : 'exploratory'}</div>
      <div><strong>Degradation categories:</strong> ${degradationCategorySummary}</div>
      <div><strong>Evidence:</strong> compile ${parity.evidence.compile}, runtime ${parity.evidence.runtime}, visual ${parity.evidence.visual}</div>
      <div><strong>Backend divergence:</strong> ${parity.backendDivergence.length}</div>
      <div><strong>Visual fallbacks:</strong> ${parity.visualFallbacks.length}</div>
      <div><strong>Features:</strong> ${compiled.ir.compatibility.featureAnalysis.featuresUsed.join(', ') || 'base-globals'}</div>
      <div><strong>Frame:</strong> ${frameState.signals.frame}</div>
      <div><strong>Bass / mid / treb:</strong> ${frameState.signals.bass.toFixed(2)} / ${frameState.signals.mid.toFixed(2)} / ${frameState.signals.treb.toFixed(2)}</div>
      <div><strong>Beat pulse:</strong> ${frameState.signals.beatPulse.toFixed(2)}</div>
      <div><strong>Main wave points:</strong> ${Math.floor(frameState.mainWave.positions.length / 3)}</div>
      <div><strong>Custom waves:</strong> ${frameState.customWaves.length}</div>
      <div><strong>Shapes:</strong> ${frameState.shapes.length}</div>
      <div><strong>Borders:</strong> ${frameState.borders.length}</div>
      <div><strong>Register pressure:</strong> q${compiled.ir.compatibility.featureAnalysis.registerUsage.q} / t${compiled.ir.compatibility.featureAnalysis.registerUsage.t}</div>
      <div><strong>Primary note:</strong> ${primaryReason ? `${compatibilityCategoryLabel(primaryReason.category)}: ${primaryReason.message}` : (support.reasons[0] ?? parity.visualFallbacks[0] ?? 'Validated for the active backend.')}</div>
    `;
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      metricsMarkup === this.lastInspectorSignature &&
      now - this.lastInspectorRenderAt < 240
    ) {
      return;
    }
    this.lastInspectorSignature = metricsMarkup;
    this.lastInspectorRenderAt = now;
    this.inspectorMetrics.innerHTML = metricsMarkup;
  }

  setStatus(message: string) {
    this.statusLabel.textContent = message;
  }

  dispose() {
    this.editor.destroy();
    if (this.editorDebounceId !== null) {
      window.clearTimeout(this.editorDebounceId);
    }
    if (this.browseRenderDebounceId !== null) {
      window.clearTimeout(this.browseRenderDebounceId);
    }
    this.root.remove();
  }
}
