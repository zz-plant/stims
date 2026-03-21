import { afterEach, describe, expect, mock, test } from 'bun:test';
import { DEFAULT_QUALITY_PRESETS } from '../assets/js/core/settings-panel.ts';
import { MilkdropOverlay } from '../assets/js/milkdrop/overlay.ts';
import type { MilkdropCatalogEntry } from '../assets/js/milkdrop/types.ts';

function createOverlay({
  onSelectQualityPreset = mock(),
}: {
  onSelectQualityPreset?: ReturnType<typeof mock>;
} = {}) {
  return new MilkdropOverlay({
    host: document.body,
    callbacks: {
      onSelectPreset: mock(),
      onSelectQualityPreset,
      onToggleFavorite: mock(),
      onSetRating: mock(),
      onToggleAutoplay: mock(),
      onTransitionModeChange: mock(),
      onGoBackPreset: mock(),
      onNextPreset: mock(),
      onPreviousPreset: mock(),
      onRandomize: mock(),
      onBlendDurationChange: mock(),
      onImportFiles: mock(),
      onExport: mock(),
      onDuplicatePreset: mock(),
      onDeletePreset: mock(),
      onEditorSourceChange: mock(),
      onRevertToActive: mock(),
      onInspectorFieldChange: mock(),
    },
  });
}

function createInspectorPayload() {
  return {
    compiled: {
      title: 'Signal Bloom',
      source: {
        id: 'signal-bloom',
        origin: 'bundled',
      },
      formattedSource: 'zoom=1\n',
      ir: {
        numericFields: {
          zoom: 1,
          rot: 0,
          warp: 0,
          blend_duration: 2.5,
          mesh_density: 16,
          wave_scale: 1,
          ob_size: 0.02,
          ib_size: 0.01,
        },
        customWaves: [],
        customShapes: [],
        compatibility: {
          backends: {
            webgl: { status: 'supported', reasons: [], evidence: [] },
            webgpu: { status: 'supported', reasons: [], evidence: [] },
          },
          parity: {
            fidelityClass: 'exact',
            degradationReasons: [],
            evidence: { compile: 0, runtime: 0, visual: 0 },
            backendDivergence: [],
            visualFallbacks: [],
          },
          featureAnalysis: {
            featuresUsed: [],
            unsupportedShaderText: false,
            supportedShaderText: false,
            shaderTextExecution: {
              webgl: 'none',
              webgpu: 'none',
            },
            registerUsage: { q: 0, t: 0 },
          },
        },
      },
    },
    frameState: {
      signals: {
        frame: 42,
        bass: 0.2,
        mid: 0.3,
        treb: 0.4,
        beatPulse: 0.5,
      },
      mainWave: {
        positions: new Array(96).fill(0),
      },
      customWaves: [],
      shapes: [],
      borders: [],
    },
    backend: 'webgl' as const,
  } as unknown as Parameters<MilkdropOverlay['setInspectorState']>[0];
}

function createCatalogEntry(id: string, title: string): MilkdropCatalogEntry {
  return {
    id,
    title,
    author: 'Stims',
    origin: 'bundled',
    featuresUsed: [],
    warnings: [],
    rating: 0,
    isFavorite: false,
    tags: [],
    supports: {
      webgl: {
        status: 'supported',
        reasons: [],
        evidence: [],
        requiredFeatures: [],
        unsupportedFeatures: [],
      },
      webgpu: {
        status: 'supported',
        reasons: [],
        evidence: [],
        requiredFeatures: [],
        unsupportedFeatures: [],
      },
    },
    fidelityClass: 'exact',
    visualEvidenceTier: 'none',
    evidence: {
      compile: 'verified',
      runtime: 'not-run',
      visual: 'not-captured',
    },
    certification: 'bundled',
    corpusTier: 'bundled',
    parity: {
      ignoredFields: [],
      approximatedShaderLines: [],
      missingAliasesOrFunctions: [],
      backendDivergence: [],
      visualFallbacks: [],
      blockedConstructs: [],
      blockingConstructDetails: [],
      degradationReasons: [],
      fidelityClass: 'exact',
      evidence: {
        compile: 'verified',
        runtime: 'not-run',
        visual: 'not-captured',
      },
      visualEvidenceTier: 'none',
    },
  } as MilkdropCatalogEntry;
}

describe('milkdrop overlay quality controls', () => {
  const OriginalMutationObserver = globalThis.MutationObserver;

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.MutationObserver = OriginalMutationObserver;
  });

  test('renders quality controls inside browse and reports changes', () => {
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const onSelectQualityPreset = mock();
    const overlay = createOverlay({ onSelectQualityPreset });

    overlay.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      activePresetId: 'balanced',
      storageKey: 'stims:milkdrop:quality',
    });

    const select = document.querySelector(
      '.milkdrop-overlay__quality-select',
    ) as HTMLSelectElement | null;

    expect(select).not.toBeNull();
    expect(select?.value).toBe('balanced');
    expect(document.body.textContent).toContain(
      'What changes: pixel ratio up to 1.50x, render scale 1.00x, particle density 1.00x.',
    );

    if (select) {
      select.value = 'tv';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    expect(onSelectQualityPreset).toHaveBeenCalledWith('tv');
    expect(document.body.textContent).toContain(
      'What changes: pixel ratio up to 1.10x, render scale 0.85x, particle density 0.70x.',
    );

    overlay.dispose();
  });
});

describe('milkdrop overlay inspector metrics', () => {
  const OriginalMutationObserver = globalThis.MutationObserver;

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.MutationObserver = OriginalMutationObserver;
  });

  test('skips inspector metric DOM updates while the inspector tab is hidden', () => {
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const overlay = createOverlay();
    const payload = createInspectorPayload();
    const metrics = document.querySelector(
      '.milkdrop-overlay__inspector-metrics',
    ) as HTMLElement | null;

    expect(overlay.shouldRenderInspectorMetrics()).toBe(false);
    overlay.setInspectorState(payload);
    expect(metrics?.innerHTML).toBe('');

    overlay.openTab('inspector');
    expect(overlay.shouldRenderInspectorMetrics()).toBe(true);
    overlay.setInspectorState(payload);
    expect(metrics?.textContent).toContain('Backend:');

    overlay.dispose();
  });
});

describe('milkdrop overlay compatibility messaging', () => {
  const OriginalMutationObserver = globalThis.MutationObserver;

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.MutationObserver = OriginalMutationObserver;
  });

  test('shows unsupported feature messaging for imported blocker presets', () => {
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const overlay = createOverlay();
    const preset = createCatalogEntry('blocked-import', 'Blocked import');
    preset.origin = 'imported';
    preset.supports.webgl.status = 'unsupported';
    preset.supports.webgl.reasons = [
      'Unsupported feature "video-echo-orientation" from preset field "video_echo_orientation": Video echo orientation is not implemented, so rotated or mirrored feedback trails cannot be reproduced.',
    ];
    preset.supports.webgl.evidence = [
      {
        backend: 'webgl',
        scope: 'shared',
        status: 'unsupported',
        code: 'unsupported-hard-feature',
        feature: 'video-echo-orientation',
        message:
          'Unsupported feature "video-echo-orientation" from preset field "video_echo_orientation": Video echo orientation is not implemented, so rotated or mirrored feedback trails cannot be reproduced.',
      },
    ];
    preset.supports.webgl.unsupportedFeatures = ['video-echo-orientation'];
    preset.fidelityClass = 'fallback';
    preset.parity.degradationReasons = [
      {
        code: 'unsupported-hard-feature',
        category: 'unsupported-syntax',
        message:
          'Unsupported feature "video-echo-orientation" is triggered by preset field "video_echo_orientation".',
        system: 'compiler',
        blocking: true,
      },
    ];

    overlay.setCatalog([preset], 'blocked-import', 'webgl');

    expect(document.body.textContent).toContain(
      'Unsupported feature: Unsupported feature "video-echo-orientation" is triggered by preset field "video_echo_orientation".',
    );
    expect(document.body.textContent).toContain('Blocked import');

    overlay.dispose();
  });
});

describe('milkdrop overlay browse rendering', () => {
  const OriginalMutationObserver = globalThis.MutationObserver;

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.MutationObserver = OriginalMutationObserver;
  });

  test('debounces search-driven browse rerenders', async () => {
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const overlay = createOverlay();
    overlay.setCatalog(
      [
        createCatalogEntry('signal-bloom', 'Signal Bloom'),
        createCatalogEntry('aurora-drift', 'Aurora Drift'),
      ],
      'signal-bloom',
      'webgl',
    );

    const browse = document.querySelector(
      '.milkdrop-overlay__browse',
    ) as HTMLElement | null;
    const search = document.querySelector(
      '.milkdrop-overlay__search',
    ) as HTMLInputElement | null;

    expect(browse?.textContent).toContain('Aurora Drift');

    if (!search || !browse) {
      throw new Error('Expected overlay browse controls to exist.');
    }

    search.value = 'signal';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(browse.textContent).toContain('Aurora Drift');

    await new Promise((resolve) => window.setTimeout(resolve, 150));

    expect(browse.textContent).toContain('Signal Bloom');
    expect(browse.textContent).not.toContain('Aurora Drift');

    overlay.dispose();
  });

  test('keeps featured browse focused on recovery and recommendations', () => {
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const overlay = createOverlay();
    const recentFavorite = createCatalogEntry('signal-bloom', 'Signal Bloom');
    recentFavorite.historyIndex = 0;
    recentFavorite.isFavorite = true;
    recentFavorite.tags = ['collection:classic-milkdrop'];

    const recentOnly = createCatalogEntry('aurora-drift', 'Aurora Drift');
    recentOnly.historyIndex = 1;
    recentOnly.tags = ['collection:feedback-lab'];

    const favoriteOnly = createCatalogEntry('night-drive', 'Night Drive');
    favoriteOnly.isFavorite = true;
    favoriteOnly.tags = ['collection:low-motion'];

    const discoveryOne = createCatalogEntry('prism-burst', 'Prism Burst');
    discoveryOne.tags = ['collection:classic-milkdrop'];

    const discoveryTwo = createCatalogEntry('echo-grid', 'Echo Grid');
    discoveryTwo.tags = ['collection:feedback-lab'];

    overlay.setCatalog(
      [recentFavorite, recentOnly, favoriteOnly, discoveryOne, discoveryTwo],
      'signal-bloom',
      'webgl',
    );

    const sections = [
      ...document.querySelectorAll('.milkdrop-overlay__browse-section'),
    ] as HTMLElement[];
    const headings = sections.map((section) =>
      (
        section.querySelector('.milkdrop-overlay__browse-heading')
          ?.childNodes[0]?.textContent ?? ''
      ).trim(),
    );

    expect(sections).toHaveLength(2);
    expect(headings).toEqual(['Continue listening', 'Recommended']);
    expect(headings).not.toContain('Classic MilkDrop');
    expect(headings).not.toContain('Feedback Lab');
    expect(headings).not.toContain('Low Motion');

    expect(sections[0]?.textContent).toContain('Signal Bloom');
    expect(sections[0]?.textContent).toContain('Aurora Drift');
    expect(sections[0]?.textContent).toContain('Night Drive');
    expect(sections[1]?.textContent).toContain('Prism Burst');
    expect(sections[1]?.textContent).toContain('Echo Grid');

    overlay.dispose();
  });

  test('keeps the simplified default browse state focused on search and featured results', () => {
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const overlay = createOverlay();
    const featuredPreset = createCatalogEntry('signal-bloom', 'Signal Bloom');
    featuredPreset.historyIndex = 0;
    const discoveryPreset = createCatalogEntry('aurora-drift', 'Aurora Drift');

    overlay.setCatalog(
      [featuredPreset, discoveryPreset],
      'signal-bloom',
      'webgl',
    );

    const search = document.querySelector(
      '.milkdrop-overlay__search',
    ) as HTMLInputElement | null;
    const modeTabs = [
      ...document.querySelectorAll('.milkdrop-overlay__browse-mode-tab'),
    ] as HTMLButtonElement[];
    const optionsDisclosure = document.querySelector(
      '.milkdrop-overlay__browse-options',
    ) as HTMLDetailsElement | null;
    const collectionFilters = document.querySelector(
      '.milkdrop-overlay__collection-filters',
    ) as HTMLElement | null;
    const browse = document.querySelector(
      '.milkdrop-overlay__browse',
    ) as HTMLElement | null;

    expect(search?.placeholder).toBe('Search presets');
    expect(modeTabs.map((tab) => tab.textContent?.trim())).toEqual([
      'Featured',
      'All presets',
      'Recent',
      'Favorites',
    ]);
    expect(
      modeTabs
        .find((tab) => tab.dataset.active === 'true')
        ?.textContent?.trim(),
    ).toBe('Featured');
    expect(optionsDisclosure?.open).toBe(false);
    expect(collectionFilters?.hidden).toBe(true);
    expect(browse?.textContent).toContain('Signal Bloom');
    expect(browse?.textContent).toContain('Aurora Drift');

    overlay.dispose();
  });

  test('keeps browse mode tabs keyboard reachable with roving focus controls', () => {
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const overlay = createOverlay();
    const classicPreset = createCatalogEntry('signal-bloom', 'Signal Bloom');
    classicPreset.tags = ['collection:classic-milkdrop'];
    classicPreset.historyIndex = 0;
    const favoritePreset = createCatalogEntry('aurora-drift', 'Aurora Drift');
    favoritePreset.isFavorite = true;

    overlay.setCatalog(
      [classicPreset, favoritePreset],
      'signal-bloom',
      'webgl',
    );

    const featuredTab = document.querySelector(
      '.milkdrop-overlay__browse-mode-tab[data-mode="featured"]',
    ) as HTMLButtonElement | null;
    const allPresetsTab = document.querySelector(
      '.milkdrop-overlay__browse-mode-tab[data-mode="all"]',
    ) as HTMLButtonElement | null;
    const favoritesTab = document.querySelector(
      '.milkdrop-overlay__browse-mode-tab[data-mode="favorites"]',
    ) as HTMLButtonElement | null;
    const collectionFilters = document.querySelector(
      '.milkdrop-overlay__collection-filters',
    ) as HTMLElement | null;
    const sentinelButton = document.createElement('button');
    sentinelButton.type = 'button';
    sentinelButton.textContent = 'Sentinel';
    document.body.appendChild(sentinelButton);

    if (!featuredTab || !allPresetsTab || !favoritesTab || !collectionFilters) {
      throw new Error('Expected browse mode tabs and collection filters.');
    }

    let globalArrowHandlerTriggered = false;
    const handleWindowArrowKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight') {
        return;
      }

      globalArrowHandlerTriggered = true;
      sentinelButton.focus();
    };
    window.addEventListener('keydown', handleWindowArrowKey);

    expect(featuredTab.tabIndex).toBe(0);
    expect(allPresetsTab.tabIndex).toBe(-1);
    featuredTab.focus();

    featuredTab.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
      }),
    );

    expect(allPresetsTab.tabIndex).toBe(0);
    expect(allPresetsTab.getAttribute('aria-selected')).toBe('true');
    expect(featuredTab.tabIndex).toBe(-1);
    expect(collectionFilters.hidden).toBe(false);
    expect(document.activeElement).toBe(allPresetsTab);
    expect(globalArrowHandlerTriggered).toBe(false);

    allPresetsTab.dispatchEvent(
      new window.KeyboardEvent('keydown', {
        key: 'End',
        bubbles: true,
      }),
    );

    expect(favoritesTab.tabIndex).toBe(0);
    expect(favoritesTab.getAttribute('aria-selected')).toBe('true');
    expect(collectionFilters.hidden).toBe(true);

    window.removeEventListener('keydown', handleWindowArrowKey);
    overlay.dispose();
  });

  test('reveals advanced browse filters on demand and shows collections for all presets', () => {
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const overlay = createOverlay();
    const classicPreset = createCatalogEntry('signal-bloom', 'Signal Bloom');
    classicPreset.tags = ['collection:classic-milkdrop'];
    const feedbackPreset = createCatalogEntry('aurora-drift', 'Aurora Drift');
    feedbackPreset.tags = ['collection:feedback-lab'];

    overlay.setCatalog(
      [classicPreset, feedbackPreset],
      'signal-bloom',
      'webgl',
    );

    const optionsDisclosure = document.querySelector(
      '.milkdrop-overlay__browse-options',
    ) as HTMLDetailsElement | null;
    const collectionFilters = document.querySelector(
      '.milkdrop-overlay__collection-filters',
    ) as HTMLElement | null;
    const fidelitySelect = document.querySelector(
      '.milkdrop-overlay__browse-options .milkdrop-overlay__rating-select',
    ) as HTMLSelectElement | null;
    const allPresetsTab = document.querySelector(
      '.milkdrop-overlay__browse-mode-tab[data-mode="all"]',
    ) as HTMLButtonElement | null;

    expect(fidelitySelect?.value).toBe('all');
    expect(collectionFilters?.hidden).toBe(true);

    if (!optionsDisclosure || !allPresetsTab) {
      throw new Error('Expected browse options disclosure and mode tabs.');
    }

    optionsDisclosure.open = true;
    optionsDisclosure.dispatchEvent(new Event('toggle'));
    expect(collectionFilters?.hidden).toBe(false);

    optionsDisclosure.open = false;
    optionsDisclosure.dispatchEvent(new Event('toggle'));
    expect(collectionFilters?.hidden).toBe(true);

    allPresetsTab.dispatchEvent(new Event('click', { bubbles: true }));
    expect(collectionFilters?.hidden).toBe(false);
    expect(collectionFilters?.textContent).toContain('Classic MilkDrop');
    expect(collectionFilters?.textContent).toContain('Feedback Lab');

    overlay.dispose();
  });

  test('keeps preset rows focused on launch metadata and compact secondary actions', () => {
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const overlay = createOverlay();
    const activePreset = createCatalogEntry('signal-bloom', 'Signal Bloom');
    activePreset.historyIndex = 0;
    activePreset.isFavorite = true;
    activePreset.rating = 4;
    activePreset.tags = ['collection:classic-milkdrop', 'slow-burn'];

    const partialPreset = createCatalogEntry('aurora-drift', 'Aurora Drift');
    partialPreset.author = 'Guest';
    partialPreset.supports.webgl.status = 'partial';
    partialPreset.supports.webgl.reasons = [
      'Wave mesh falls back to a simpler path.',
    ];
    partialPreset.fidelityClass = 'partial';
    partialPreset.parity.degradationReasons = [
      {
        code: 'backend-partial',
        category: 'backend-degradation',
        message: 'Wave mesh falls back to a simpler path.',
        system: 'runtime',
        blocking: false,
      },
    ];

    overlay.setCatalog([activePreset, partialPreset], 'signal-bloom', 'webgl');

    const rows = [
      ...document.querySelectorAll('.milkdrop-overlay__preset'),
    ] as HTMLElement[];
    expect(rows).toHaveLength(2);

    const activeRow = rows[0];
    const activeMeta = activeRow?.querySelector(
      '.milkdrop-overlay__preset-meta',
    );
    const activeBadges = [
      ...((activeRow?.querySelectorAll(
        '.milkdrop-overlay__preset-badges > *',
      ) ?? []) as NodeListOf<HTMLElement>),
    ].map((badge) => badge.textContent?.trim());
    const activeFavorite = activeRow?.querySelector(
      '.milkdrop-overlay__favorite',
    ) as HTMLButtonElement | null;
    const activeRating = activeRow?.querySelector(
      '.milkdrop-overlay__rating-select',
    ) as HTMLSelectElement | null;

    expect(activeMeta?.textContent).toBe('Stims · Recent');
    expect(activeBadges).toEqual(['Live', 'Exact']);
    expect(activeFavorite?.textContent).toBe('★');
    expect(activeFavorite?.getAttribute('aria-label')).toBe(
      'Remove saved preset',
    );
    expect(activeRating?.value).toBe('4');
    expect(
      activeRow?.querySelector('.milkdrop-overlay__preset-warning'),
    ).toBeNull();
    expect(activeRow?.textContent).not.toContain('slow-burn');
    expect(activeRow?.textContent).not.toContain('bundled');

    const partialRow = rows[1];
    const partialMeta = partialRow?.querySelector(
      '.milkdrop-overlay__preset-meta',
    );
    const partialWarning = partialRow?.querySelector(
      '.milkdrop-overlay__preset-warning',
    );

    expect(partialMeta?.textContent).toBe('Guest');
    expect(partialWarning?.textContent).toBe(
      'Backend degradation: Wave mesh falls back to a simpler path.',
    );

    overlay.dispose();
  });
});
