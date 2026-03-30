import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  matchesBrowseFilters,
  sortBrowsePresets,
} from '../assets/js/milkdrop/overlay/browse-panel.ts';
import { EditorPanel } from '../assets/js/milkdrop/overlay/editor-panel.ts';
import {
  formatCompatibilitySummary,
  formatInspectorMetrics,
  InspectorPanel,
} from '../assets/js/milkdrop/overlay/inspector-panel.ts';
import type {
  MilkdropCatalogEntry,
  MilkdropCompiledPreset,
  MilkdropEditorSessionState,
  MilkdropFrameState,
} from '../assets/js/milkdrop/types.ts';

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
    semanticSupport: {
      fidelityClass: 'exact',
      evidence: {
        compile: 'verified',
        runtime: 'not-run',
        visual: 'not-captured',
      },
      visualEvidenceTier: 'none',
    },
    visualCertification: {
      status: 'uncertified',
      measured: false,
      source: 'inferred',
      fidelityClass: 'partial',
      visualEvidenceTier: 'none',
      requiredBackend: 'webgpu',
      actualBackend: null,
      reasons: ['No measured WebGPU reference capture is recorded yet.'],
    },
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
      semanticSupport: {
        fidelityClass: 'exact',
        evidence: {
          compile: 'verified',
          runtime: 'not-run',
          visual: 'not-captured',
        },
        visualEvidenceTier: 'none',
      },
      visualCertification: {
        status: 'uncertified',
        measured: false,
        source: 'inferred',
        fidelityClass: 'partial',
        visualEvidenceTier: 'none',
        requiredBackend: 'webgpu',
        actualBackend: null,
        reasons: ['No measured WebGPU reference capture is recorded yet.'],
      },
    },
  } as MilkdropCatalogEntry;
}

function createCompiledPreset(): MilkdropCompiledPreset {
  return {
    title: 'Signal Bloom',
    author: 'Stims',
    source: {
      id: 'signal-bloom',
      title: 'Signal Bloom',
      raw: 'zoom=1\n',
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
          webgpu: {
            status: 'partial',
            reasons: ['Wave mesh falls back to a simpler path.'],
            evidence: [],
          },
        },
        parity: {
          fidelityClass: 'partial',
          degradationReasons: [
            {
              code: 'backend-partial',
              category: 'backend-degradation',
              message: 'Wave mesh falls back to a simpler path.',
              system: 'runtime',
              blocking: false,
            },
          ],
          evidence: {
            compile: 'verified',
            runtime: 'not-run',
            visual: 'not-captured',
          },
          backendDivergence: ['webgpu motion vectors'],
          visualFallbacks: ['Motion vectors disabled on WebGPU.'],
        },
        featureAnalysis: {
          featuresUsed: ['base-globals', 'custom-waves'],
          unsupportedShaderText: false,
          supportedShaderText: false,
          shaderTextExecution: {
            webgl: 'none',
            webgpu: 'none',
          },
          registerUsage: { q: 2, t: 1 },
        },
      },
    },
  } as unknown as MilkdropCompiledPreset;
}

function createFrameState(): MilkdropFrameState {
  return {
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
  } as unknown as MilkdropFrameState;
}

describe('browse panel helpers', () => {
  test('filters by query, collection, browse mode, and fidelity', () => {
    const preset = createCatalogEntry('signal-bloom', 'Signal Bloom');
    preset.author = 'Guest';
    preset.tags = ['collection:classic-milkdrop', 'warm'];
    preset.fidelityClass = 'partial';
    preset.historyIndex = 0;

    expect(
      matchesBrowseFilters({
        preset,
        query: 'guest',
        activeCollectionTag: 'collection:classic-milkdrop',
        browseMode: 'recent',
        browseSupportFilter: 'partial',
      }),
    ).toBe(true);
    expect(
      matchesBrowseFilters({
        preset,
        query: 'night',
        activeCollectionTag: 'collection:classic-milkdrop',
        browseMode: 'recent',
        browseSupportFilter: 'partial',
      }),
    ).toBe(false);
    expect(
      matchesBrowseFilters({
        preset,
        query: '',
        activeCollectionTag: '',
        browseMode: 'favorites',
        browseSupportFilter: 'partial',
      }),
    ).toBe(false);
  });

  test('sorts recommended and recent browse presets predictably', () => {
    const favorite = createCatalogEntry('favorite', 'Beta');
    favorite.isFavorite = true;
    favorite.rating = 2;

    const curated = createCatalogEntry('curated', 'Alpha');
    curated.curatedRank = 1;
    curated.rating = 5;

    const recent = createCatalogEntry('recent', 'Gamma');
    recent.historyIndex = 0;

    expect(
      sortBrowsePresets({
        presets: [recent, curated, favorite],
        browseSort: 'recommended',
      }).map((preset) => preset.id),
    ).toEqual(['favorite', 'curated', 'recent']);
    expect(
      sortBrowsePresets({
        presets: [favorite, curated, recent],
        browseSort: 'recent',
      }).map((preset) => preset.id),
    ).toEqual(['recent', 'curated', 'favorite']);
  });
});

describe('editor panel change propagation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('debounces editor changes before reporting source updates', async () => {
    const OriginalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = class {
      disconnect() {}
      observe() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;

    const onEditorSourceChange = mock();
    const panel = new EditorPanel({
      onEditorSourceChange,
      onRevertToActive: mock(),
      onDuplicatePreset: mock(),
      onExport: mock(),
      onDeletePreset: mock(),
      onRequestImport: mock(),
    });
    document.body.appendChild(panel.element);

    const state = {
      source: 'zoom=1\n',
      latestCompiled: null,
      activeCompiled: null,
      diagnostics: [],
      dirty: false,
    } satisfies MilkdropEditorSessionState;
    panel.setSessionState(state);

    const snippetButton = document.querySelector(
      '.milkdrop-overlay__editor-snippet',
    ) as HTMLButtonElement | null;
    if (!snippetButton) {
      throw new Error('Expected a snippet button to exist.');
    }

    snippetButton.click();
    expect(onEditorSourceChange).not.toHaveBeenCalled();

    await new Promise((resolve) => window.setTimeout(resolve, 250));

    expect(onEditorSourceChange).toHaveBeenCalledTimes(1);
    expect(onEditorSourceChange.mock.calls[0]?.[0]).toContain('zoom=1.01');

    panel.dispose();
    globalThis.MutationObserver = OriginalMutationObserver;
  });
});

describe('inspector panel formatting', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('formats compatibility summaries and metric rows for rendering', () => {
    const compiled = createCompiledPreset();
    const frameState = createFrameState();
    const support = compiled.ir.compatibility.backends.webgpu;

    expect(formatCompatibilitySummary({ support, compiled })).toEqual({
      degradationCategorySummary: 'Backend degradation',
      primaryNote:
        'Showing a simpler version. Wave mesh falls back to a simpler path.',
    });

    const metrics = formatInspectorMetrics({
      compiled,
      frameState,
      backend: 'webgpu',
    });
    expect(
      metrics.find((metric) => metric.label === 'Transport support')?.value,
    ).toBe('Partial');
    expect(
      metrics.find((metric) => metric.label === 'Primary note')?.value,
    ).toBe(
      'Showing a simpler version. Wave mesh falls back to a simpler path.',
    );
  });

  test('renders inspector metrics into DOM once the panel is visible', () => {
    const panel = new InspectorPanel({ onInspectorFieldChange: mock() });
    document.body.appendChild(panel.element);
    panel.setVisible(true);

    panel.renderMetrics({
      compiled: createCompiledPreset(),
      frameState: createFrameState(),
      backend: 'webgpu',
      isOpen: true,
    });

    expect(panel.metricsElement.textContent).toContain('Backend: webgpu');
    expect(panel.metricsElement.textContent).toContain(
      'Primary note: Showing a simpler version. Wave mesh falls back to a simpler path.',
    );
  });
});
