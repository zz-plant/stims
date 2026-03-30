import type { QualityPreset } from '../../core/settings-panel';
import type { MilkdropCatalogEntry, MilkdropFidelityClass } from '../types';
import { type PresetRowCallbacks, PresetRowRenderer } from './preset-row';

const COLLECTION_TAG_PREFIX = 'collection:';
const COLLECTION_LABELS: Record<string, string> = {
  'collection:classic-milkdrop': 'Classic MilkDrop',
  'collection:cream-of-the-crop': 'Cream of the Crop',
  'collection:feedback-lab': 'Feedback Lab',
  'collection:low-motion': 'Low Motion',
  'collection:touch-friendly': 'Touch Friendly',
};

function collectionLabel(tag: string) {
  if (!tag) return '';
  return (
    COLLECTION_LABELS[tag] ??
    tag.slice(COLLECTION_TAG_PREFIX.length).replace(/-/gu, ' ')
  );
}

export type BrowseMode = 'featured' | 'all' | 'recent' | 'favorites';
export type BrowseSort = 'recommended' | 'title' | 'rating' | 'recent';
export type BrowseFidelityFilter = 'all' | MilkdropFidelityClass;

type BrowseSection = {
  title: string;
  presets: MilkdropCatalogEntry[];
};

type BrowsePanelCallbacks = PresetRowCallbacks & {
  onSelectQualityPreset: (presetId: string) => void;
};

export function matchesBrowseFilters({
  preset,
  query,
  activeCollectionTag,
  browseMode,
  browseSupportFilter,
}: {
  preset: MilkdropCatalogEntry;
  query: string;
  activeCollectionTag: string;
  browseMode: BrowseMode;
  browseSupportFilter: BrowseFidelityFilter;
}) {
  if (activeCollectionTag && !preset.tags.includes(activeCollectionTag)) {
    return false;
  }

  if (
    browseSupportFilter !== 'all' &&
    preset.fidelityClass !== browseSupportFilter
  ) {
    return false;
  }

  if (browseMode === 'recent' && preset.historyIndex === undefined) {
    return false;
  }
  if (browseMode === 'favorites' && !preset.isFavorite) {
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

export function sortBrowsePresets({
  presets,
  browseSort,
}: {
  presets: MilkdropCatalogEntry[];
  browseSort: BrowseSort;
}) {
  const sorted = [...presets];
  sorted.sort((left, right) => {
    if (browseSort === 'title') {
      return left.title.localeCompare(right.title);
    }
    if (browseSort === 'rating') {
      if (left.rating !== right.rating) {
        return right.rating - left.rating;
      }
      return left.title.localeCompare(right.title);
    }
    if (browseSort === 'recent') {
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

export class BrowsePanel {
  readonly element: HTMLElement;

  private readonly rowRenderer: PresetRowRenderer;
  private readonly browseList: HTMLElement;
  private readonly browseEyebrowLabel: HTMLElement;
  private readonly browseActiveLabel: HTMLElement;
  private readonly browseMetaLabel: HTMLElement;
  private readonly browseModeButtons: HTMLButtonElement[] = [];
  private readonly browseOptionsDisclosure: HTMLDetailsElement;
  private readonly searchInput: HTMLInputElement;
  private readonly collectionFilters: HTMLElement;
  private readonly browseModeSelect: HTMLSelectElement;
  private readonly browseSortSelect: HTMLSelectElement;
  private presets: MilkdropCatalogEntry[] = [];
  private activePresetId: string | null = null;
  private activeBackend: 'webgl' | 'webgpu' = 'webgl';
  private activeCollectionTag = '';
  private browseMode: BrowseMode = 'featured';
  private browseSort: BrowseSort = 'recommended';
  private browseSupportFilter: BrowseFidelityFilter = 'all';
  private browseRenderDebounceId: number | null = null;
  private browseDirty = true;
  private lastCatalogSignature = '';
  private lastBrowseRenderSignature = '';
  private visible = true;

  constructor(callbacks: BrowsePanelCallbacks) {
    this.rowRenderer = new PresetRowRenderer(callbacks);
    this.element = document.createElement('section');
    this.element.className = 'milkdrop-overlay__tab-panel';

    const browseHero = document.createElement('section');
    browseHero.className = 'milkdrop-overlay__browse-hero';
    const browseCopy = document.createElement('div');
    browseCopy.className = 'milkdrop-overlay__browse-copy';

    this.browseEyebrowLabel = document.createElement('p');
    this.browseEyebrowLabel.className = 'milkdrop-overlay__browse-eyebrow';
    this.browseEyebrowLabel.textContent = 'Featured looks';

    this.browseActiveLabel = document.createElement('div');
    this.browseActiveLabel.className = 'milkdrop-overlay__browse-active';
    this.browseActiveLabel.textContent = 'Choose a look';
    this.browseActiveLabel.setAttribute('aria-live', 'polite');
    this.browseActiveLabel.setAttribute('aria-atomic', 'true');

    this.browseMetaLabel = document.createElement('p');
    this.browseMetaLabel.className = 'milkdrop-overlay__browse-meta';
    this.browseMetaLabel.textContent = '';
    this.browseMetaLabel.setAttribute('aria-live', 'polite');
    this.browseMetaLabel.setAttribute('role', 'status');
    this.browseMetaLabel.hidden = true;
    browseCopy.append(
      this.browseEyebrowLabel,
      this.browseActiveLabel,
      this.browseMetaLabel,
    );
    browseHero.append(browseCopy);

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.className = 'milkdrop-overlay__search';
    this.searchInput.placeholder = 'Search looks';
    this.searchInput.setAttribute('aria-label', 'Search looks');
    this.searchInput.addEventListener('input', () => this.scheduleRender());

    this.browseModeSelect = document.createElement('select');
    this.browseModeSelect.className = 'milkdrop-overlay__rating-select';
    (
      [
        ['featured', 'Featured'],
        ['all', 'All looks'],
        ['recent', 'Recent'],
        ['favorites', 'Favorites'],
      ] satisfies Array<[BrowseMode, string]>
    ).forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this.browseModeSelect.appendChild(option);
    });
    this.browseModeSelect.addEventListener('change', () =>
      this.setBrowseMode(this.browseModeSelect.value as BrowseMode),
    );

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
      this.scheduleRender(0);
    });

    const browseModeTabs = document.createElement('div');
    browseModeTabs.className = 'milkdrop-overlay__browse-mode-tabs';
    browseModeTabs.setAttribute('role', 'tablist');
    browseModeTabs.setAttribute('aria-label', 'Look browse modes');
    browseModeTabs.addEventListener('keydown', (event) =>
      this.handleBrowseModeTabsKeydown(event),
    );
    (
      [
        ['featured', 'Featured'],
        ['all', 'All looks'],
        ['recent', 'Recent'],
        ['favorites', 'Favorites'],
      ] satisfies Array<[BrowseMode, string]>
    ).forEach(([value, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'milkdrop-overlay__browse-mode-tab';
      button.dataset.mode = value;
      button.setAttribute('role', 'tab');
      button.textContent = label;
      button.addEventListener('click', () => this.setBrowseMode(value));
      this.browseModeButtons.push(button);
      browseModeTabs.appendChild(button);
    });
    this.syncBrowseModeButtons();

    this.browseOptionsDisclosure = document.createElement('details');
    this.browseOptionsDisclosure.className = 'milkdrop-overlay__browse-options';
    const browseOptionsSummary = document.createElement('summary');
    browseOptionsSummary.className = 'milkdrop-overlay__browse-options-summary';
    browseOptionsSummary.textContent = 'Filter looks';
    this.browseOptionsDisclosure.appendChild(browseOptionsSummary);

    const browseOptionsBody = document.createElement('div');
    browseOptionsBody.className = 'milkdrop-overlay__browse-options-body';
    browseOptionsBody.append(
      this.buildBrowseControl('Browse', browseModeTabs),
      this.buildBrowseControl('Sort', this.browseSortSelect),
    );
    this.browseOptionsDisclosure.appendChild(browseOptionsBody);
    this.browseOptionsDisclosure.addEventListener('toggle', () => {
      this.updateBrowseFilterVisibility();
    });

    const browseControls = document.createElement('div');
    browseControls.className = 'milkdrop-overlay__browse-controls';
    browseControls.append(
      this.buildBrowseControl('Search', this.searchInput, true),
      this.browseOptionsDisclosure,
    );

    this.collectionFilters = document.createElement('div');
    this.collectionFilters.className = 'milkdrop-overlay__collection-filters';
    this.updateBrowseFilterVisibility();

    this.browseList = document.createElement('div');
    this.browseList.className = 'milkdrop-overlay__browse';
    this.element.append(
      browseHero,
      browseControls,
      this.collectionFilters,
      this.browseList,
    );
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.element.hidden = !visible;
    if (visible && this.browseDirty) {
      this.renderCollectionFilters();
      this.render();
    }
  }

  setQualityPresets({
    presets: _presets,
    activePresetId: _activePresetId,
    storageKey: _storageKey,
  }: {
    presets: QualityPreset[];
    activePresetId: string;
    storageKey?: string;
  }) {
    void _presets;
    void _activePresetId;
    void _storageKey;
    // Live quality tuning now lives in the dedicated settings surface.
  }

  setActiveCollectionTag(collectionTag: string) {
    this.activeCollectionTag = collectionTag;
    this.browseDirty = true;
    this.updateBrowseFilterVisibility();
    if (this.visible) {
      this.render();
    }
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
    this.rowRenderer.syncValidIds(new Set(presets.map((preset) => preset.id)));
    if (this.visible) {
      this.render();
    }
  }

  dispose() {
    if (this.browseRenderDebounceId !== null) {
      window.clearTimeout(this.browseRenderDebounceId);
    }
  }

  private buildBrowseControl(
    label: string,
    control: HTMLElement,
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

  private setBrowseMode(mode: BrowseMode) {
    this.browseModeSelect.value = mode;
    this.browseMode = mode;
    this.syncBrowseModeButtons();
    this.updateBrowseFilterVisibility();
    this.scheduleRender(0);
  }

  private handleBrowseModeTabsKeydown(event: KeyboardEvent) {
    const currentIndex = this.browseModeButtons.findIndex(
      (button) => button.dataset.mode === this.browseMode,
    );
    if (currentIndex < 0) {
      return;
    }

    let nextIndex: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % this.browseModeButtons.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex =
          (currentIndex - 1 + this.browseModeButtons.length) %
          this.browseModeButtons.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = this.browseModeButtons.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    event.stopPropagation();
    const nextButton = this.browseModeButtons[nextIndex];
    const nextMode = nextButton?.dataset.mode as BrowseMode | undefined;
    if (!nextButton || !nextMode) {
      return;
    }

    this.setBrowseMode(nextMode);
    nextButton.focus();
  }

  private syncBrowseModeButtons() {
    this.browseModeButtons.forEach((button) => {
      const isActive = button.dataset.mode === this.browseMode;
      button.dataset.active = String(isActive);
      button.setAttribute('aria-selected', String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });
  }

  private updateBrowseFilterVisibility() {
    const shouldShowCollections =
      this.browseOptionsDisclosure.open || this.activeCollectionTag.length > 0;
    this.collectionFilters.hidden = !shouldShowCollections;
  }

  private renderBrowseSummary(filteredCount = this.presets.length) {
    const activePreset = this.presets.find(
      (entry) => entry.id === this.activePresetId,
    );
    const currentCollectionLabel = collectionLabel(this.activeCollectionTag);
    this.browseEyebrowLabel.textContent = activePreset
      ? 'Live preset'
      : this.browseMode === 'favorites'
        ? 'Saved looks'
        : this.browseMode === 'recent'
          ? 'Back in rotation'
          : this.browseMode === 'all'
            ? currentCollectionLabel || 'All looks'
            : 'Featured looks';
    this.browseActiveLabel.textContent = activePreset
      ? activePreset.title
      : currentCollectionLabel || 'Choose a look';
    this.browseMetaLabel.textContent = `${filteredCount} ${filteredCount === 1 ? 'pick' : 'picks'}`;
    this.browseMetaLabel.hidden = false;
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
      section.appendChild(
        this.rowRenderer.render({
          preset,
          activePresetId: this.activePresetId,
          activeBackend: this.activeBackend,
        }),
      );
    });
    target.appendChild(section);
  }

  private dedupeBrowsePresets(
    presets: MilkdropCatalogEntry[],
    seen: Set<string>,
  ) {
    return presets.filter((preset) => {
      if (seen.has(preset.id)) {
        return false;
      }
      seen.add(preset.id);
      return true;
    });
  }

  private buildFeaturedBrowseSections(filtered: MilkdropCatalogEntry[]) {
    const sections: BrowseSection[] = [];
    const seen = new Set<string>();
    const recent = filtered
      .filter((preset) => preset.historyIndex !== undefined)
      .slice(0, 4);
    const favoriteRecovery = filtered
      .filter(
        (preset) =>
          preset.isFavorite &&
          !recent.some((recentPreset) => recentPreset.id === preset.id),
      )
      .slice(0, 4);
    const recovery = this.dedupeBrowsePresets(
      [...recent, ...favoriteRecovery],
      seen,
    ).slice(0, 6);

    if (recovery.length > 0) {
      const hasRecent = recent.length > 0;
      const hasFavorites = favoriteRecovery.length > 0;
      const title = hasRecent
        ? hasFavorites
          ? 'Continue listening'
          : 'Recent'
        : 'Favorites';
      sections.push({ title, presets: recovery });
    }

    const recommended = this.dedupeBrowsePresets(filtered, seen).slice(0, 12);
    if (recommended.length > 0) {
      sections.push({ title: 'Recommended', presets: recommended });
    }

    return sections;
  }

  private scheduleRender(delayMs = 120) {
    this.browseDirty = true;
    if (!this.visible) {
      return;
    }
    if (this.browseRenderDebounceId !== null) {
      window.clearTimeout(this.browseRenderDebounceId);
    }
    this.browseRenderDebounceId = window.setTimeout(() => {
      this.browseRenderDebounceId = null;
      this.render();
    }, delayMs);
  }

  private render() {
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
    this.updateBrowseFilterVisibility();
    this.renderCollectionFilters();
    const filtered = sortBrowsePresets({
      presets: this.presets.filter((preset) =>
        matchesBrowseFilters({
          preset,
          query,
          activeCollectionTag: this.activeCollectionTag,
          browseMode: this.browseMode,
          browseSupportFilter: this.browseSupportFilter,
        }),
      ),
      browseSort: this.browseSort,
    });

    const fragment = document.createDocumentFragment();
    this.renderBrowseSummary(filtered.length);
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'milkdrop-overlay__browse-empty';
      empty.textContent = 'No looks match this search yet.';
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
        fragment.appendChild(
          this.rowRenderer.render({
            preset,
            activePresetId: this.activePresetId,
            activeBackend: this.activeBackend,
          }),
        );
      });
      this.browseList.replaceChildren(fragment);
      return;
    }

    this.buildFeaturedBrowseSections(filtered).forEach((section) => {
      this.appendPresetSection(section.title, section.presets, fragment);
    });
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
      { tag: '', label: 'All looks' },
      ...collectionTags.map((tag) => ({
        tag,
        label: collectionLabel(tag),
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
        this.updateBrowseFilterVisibility();
        this.renderCollectionFilters();
        this.render();
      });
      fragment.appendChild(button);
    });
    this.collectionFilters.replaceChildren(fragment);
  }
}
