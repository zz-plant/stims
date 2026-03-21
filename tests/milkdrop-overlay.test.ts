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
});
