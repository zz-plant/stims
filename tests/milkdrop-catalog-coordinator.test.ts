import { afterEach, describe, expect, test } from 'bun:test';
import { createMilkdropCatalogCoordinator } from '../assets/js/milkdrop/runtime/catalog-coordinator.ts';
import type { MilkdropCatalogEntry } from '../assets/js/milkdrop/types.ts';

function createCatalogEntry(id: string): MilkdropCatalogEntry {
  return {
    id,
    title: id,
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

describe('milkdrop catalog coordinator', () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  let nextFrameId = 1;
  let pendingFrames = new Map<number, FrameRequestCallback>();

  const flushAnimationFrame = () => {
    const queuedFrames = [...pendingFrames.values()];
    pendingFrames = new Map();
    queuedFrames.forEach((callback) => callback(0));
  };

  afterEach(() => {
    pendingFrames = new Map();
    nextFrameId = 1;
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  test('coalesces queued catalog syncs to the latest requested state', async () => {
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      pendingFrames.set(id, callback);
      return id;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) => {
      pendingFrames.delete(id);
    }) as typeof window.cancelAnimationFrame;

    const requestedStates: Array<{ presetId: string; backend: string }> = [];
    const coordinator = createMilkdropCatalogCoordinator({
      catalogStore: {
        async listPresets() {
          return [createCatalogEntry('signal-bloom')];
        },
      } as never,
      onCatalogChanged(entries, activePresetId, activeBackend) {
        void entries;
        requestedStates.push({
          presetId: activePresetId,
          backend: activeBackend,
        });
      },
    });

    const scheduled = coordinator.scheduleCatalogSync({
      activePresetId: 'signal-bloom',
      activeBackend: 'webgl',
    });
    const queued = coordinator.scheduleCatalogSync({
      activePresetId: 'aurora-drift',
      activeBackend: 'webgpu',
    });

    expect(queued).toBe(scheduled);

    flushAnimationFrame();
    await scheduled;

    expect(requestedStates).toEqual([
      { presetId: 'aurora-drift', backend: 'webgpu' },
    ]);
  });

  test('runs a follow-up sync when a new state is queued during an active sync', async () => {
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = nextFrameId;
      nextFrameId += 1;
      pendingFrames.set(id, callback);
      return id;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((id: number) => {
      pendingFrames.delete(id);
    }) as typeof window.cancelAnimationFrame;

    let firstSyncPending = false;
    let resolveFirstSync: (entries: MilkdropCatalogEntry[]) => void = (
      _entries,
    ) => {
      throw new Error('Expected the first catalog sync to be pending.');
    };
    let listCalls = 0;
    const requestedStates: Array<{ presetId: string; backend: string }> = [];
    const coordinator = createMilkdropCatalogCoordinator({
      catalogStore: {
        async listPresets() {
          listCalls += 1;
          if (listCalls === 1) {
            firstSyncPending = true;
            return new Promise<MilkdropCatalogEntry[]>((resolve) => {
              resolveFirstSync = (entries) => {
                firstSyncPending = false;
                resolve(entries);
              };
            });
          }
          return [createCatalogEntry('aurora-drift')];
        },
      } as never,
      onCatalogChanged(entries, activePresetId, activeBackend) {
        void entries;
        requestedStates.push({
          presetId: activePresetId,
          backend: activeBackend,
        });
      },
    });

    const scheduled = coordinator.scheduleCatalogSync({
      activePresetId: 'signal-bloom',
      activeBackend: 'webgl',
    });

    flushAnimationFrame();

    coordinator.scheduleCatalogSync({
      activePresetId: 'aurora-drift',
      activeBackend: 'webgpu',
    });
    if (!firstSyncPending) {
      throw new Error('Expected the first catalog sync to be pending.');
    }
    resolveFirstSync([createCatalogEntry('signal-bloom')]);

    await scheduled;

    expect(listCalls).toBe(2);
    expect(requestedStates).toEqual([
      { presetId: 'signal-bloom', backend: 'webgl' },
      { presetId: 'aurora-drift', backend: 'webgpu' },
    ]);
  });
});
