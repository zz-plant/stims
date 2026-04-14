import { describe, expect, test } from 'bun:test';
import type { MilkdropCatalogCoordinator } from '../assets/js/milkdrop/runtime/catalog-coordinator.ts';
import { createMilkdropPresetNavigationController } from '../assets/js/milkdrop/runtime/preset-navigation-controller.ts';
import type {
  MilkdropBlendState,
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
  MilkdropCompiledPreset,
  MilkdropEditorSession,
  MilkdropFrameState,
  MilkdropPresetSource,
  MilkdropRenderBackend,
  MilkdropSupportStatus,
} from '../assets/js/milkdrop/types.ts';

function createCatalogEntry(
  id: string,
  statuses: { webgl: MilkdropSupportStatus; webgpu: MilkdropSupportStatus },
): MilkdropCatalogEntry {
  const createBackendSupport = (status: MilkdropSupportStatus) => ({
    status,
    reasons: [],
    evidence: [],
    requiredFeatures: [],
    unsupportedFeatures: [],
  });

  return {
    id,
    title: id,
    origin: 'bundled',
    tags: [],
    isFavorite: false,
    rating: 0,
    featuresUsed: [],
    warnings: [],
    supports: {
      webgl: createBackendSupport(statuses.webgl),
      webgpu: createBackendSupport(statuses.webgpu),
    },
    fidelityClass: 'fallback',
    visualEvidenceTier: 'compile',
    semanticSupport: {
      fidelityClass: 'fallback',
      evidence: {
        visual: 'not-captured',
        runtime: 'not-run',
        compile: 'verified',
      },
      visualEvidenceTier: 'compile',
    },
    visualCertification: {
      status: 'uncertified',
      measured: false,
      source: 'inferred',
      fidelityClass: 'fallback',
      visualEvidenceTier: 'compile',
      requiredBackend: 'webgpu',
      actualBackend: null,
      reasons: ['No measured WebGPU reference capture is recorded yet.'],
    },
    evidence: {
      visual: 'not-captured',
      runtime: 'not-run',
      compile: 'verified',
    },
    certification: 'bundled',
    corpusTier: 'bundled',
    parity: {
      ignoredFields: [],
      fidelityClass: 'fallback',
      evidence: {
        visual: 'not-captured',
        runtime: 'not-run',
        compile: 'verified',
      },
      visualEvidenceTier: 'compile',
      degradationReasons: [],
      missingAliasesOrFunctions: [],
      backendDivergence: [],
      visualFallbacks: [],
      approximatedShaderLines: [],
      blockedConstructs: [],
      blockingConstructDetails: [],
      semanticSupport: {
        fidelityClass: 'fallback',
        evidence: {
          visual: 'not-captured',
          runtime: 'not-run',
          compile: 'verified',
        },
        visualEvidenceTier: 'compile',
      },
      visualCertification: {
        status: 'uncertified',
        measured: false,
        source: 'inferred',
        fidelityClass: 'fallback',
        visualEvidenceTier: 'compile',
        requiredBackend: 'webgpu',
        actualBackend: null,
        reasons: ['No measured WebGPU reference capture is recorded yet.'],
      },
    },
  };
}

function createCompiledPreset(id: string): MilkdropCompiledPreset {
  const source: MilkdropPresetSource = {
    id,
    title: id,
    raw: `title=${id}\n`,
    origin: 'bundled',
  };

  return {
    source,
    title: id,
    formattedSource: source.raw,
    ir: {
      compatibility: {
        gpuDescriptorPlans: {
          webgpu: {
            routing: 'descriptor-plan',
            proceduralWaves: [],
            proceduralMesh: null,
            proceduralMotionVectors: null,
            feedback: null,
            unsupported: [],
          },
        },
      },
    },
  } as unknown as MilkdropCompiledPreset;
}

function createSession(compiledById: Record<string, MilkdropCompiledPreset>) {
  return {
    async loadPreset(source: MilkdropPresetSource) {
      return {
        activeCompiled: compiledById[source.id] ?? null,
      };
    },
  } as MilkdropEditorSession;
}

describe('milkdrop preset navigation controller', () => {
  test('prefers a startup preset that is selectable on the current backend', () => {
    const entries = [
      createCatalogEntry('unsupported-webgl', {
        webgl: 'unsupported',
        webgpu: 'supported',
      }),
      createCatalogEntry('supported-webgl', {
        webgl: 'supported',
        webgpu: 'supported',
      }),
    ];

    const controller = createMilkdropPresetNavigationController({
      catalogStore: {} as MilkdropCatalogStore,
      catalogCoordinator: {
        async syncCatalog() {},
        scheduleCatalogSync: async () => undefined,
        async rememberSelection() {},
        async consumePreviousSelection() {
          return null;
        },
        getCatalogEntries: () => entries,
        getActiveCatalogEntry: () => null,
        dispose() {},
      } as unknown as MilkdropCatalogCoordinator,
      session: createSession({}),
      getActivePresetId: () => 'unsupported-webgl',
      getActiveBackend: () => 'webgl',
      getCurrentFrameState: () => null as MilkdropFrameState | null,
      getBlendDuration: () => 1,
      getTransitionMode: () => 'blend',
      applyCompiledPreset: () => undefined,
      applyPresetPerformanceOverride: () => undefined,
      setOverlayStatus: () => undefined,
      shouldFallbackToWebgl: () => false,
      triggerWebglFallback: () => undefined,
      rememberLastPreset: () => undefined,
      preparePresetTransition: (_blendState: MilkdropBlendState | null) =>
        undefined,
      markPresetSwitched: () => undefined,
    });

    expect(controller.isBackendSelectable('unsupported-webgl', 'webgl')).toBe(
      false,
    );
    expect(controller.getFirstSelectablePresetId('webgl')).toBe(
      'supported-webgl',
    );
  });

  test('skips unsupported adjacent presets on the active backend', async () => {
    const entries = [
      createCatalogEntry('supported-a', {
        webgl: 'supported',
        webgpu: 'supported',
      }),
      createCatalogEntry('unsupported-b', {
        webgl: 'unsupported',
        webgpu: 'supported',
      }),
      createCatalogEntry('supported-c', {
        webgl: 'partial',
        webgpu: 'supported',
      }),
    ];
    const compiledById = Object.fromEntries(
      entries.map((entry) => [entry.id, createCompiledPreset(entry.id)]),
    );
    const selected: string[] = [];
    let activePresetId = 'supported-a';

    const controller = createMilkdropPresetNavigationController({
      catalogStore: {
        async getPresetSource(id: string) {
          return {
            id,
            title: id,
            raw: `title=${id}\n`,
            origin: 'bundled',
          };
        },
        async getDraft() {
          return null;
        },
      } as unknown as MilkdropCatalogStore,
      catalogCoordinator: {
        async syncCatalog() {},
        async scheduleCatalogSync() {},
        async rememberSelection() {},
        async consumePreviousSelection() {
          return null;
        },
        getCatalogEntries: () => entries,
        getActiveCatalogEntry: () => null,
        dispose() {},
      } as unknown as MilkdropCatalogCoordinator,
      session: createSession(compiledById),
      getActivePresetId: () => activePresetId,
      getActiveBackend: () => 'webgl' as MilkdropRenderBackend,
      getCurrentFrameState: () => null,
      getBlendDuration: () => 1,
      getTransitionMode: () => 'blend',
      applyCompiledPreset: (compiled) => {
        activePresetId = compiled.source.id;
        selected.push(compiled.source.id);
      },
      applyPresetPerformanceOverride: () => undefined,
      setOverlayStatus: () => undefined,
      shouldFallbackToWebgl: () => false,
      triggerWebglFallback: () => undefined,
      rememberLastPreset: () => undefined,
      preparePresetTransition: () => undefined,
      markPresetSwitched: () => undefined,
    });

    await controller.selectAdjacentPreset(1);

    expect(selected).toEqual(['supported-c']);
    expect(activePresetId).toBe('supported-c');
  });
});
