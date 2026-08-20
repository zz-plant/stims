import { describe, expect, test } from 'bun:test';
import type { MilkdropCatalogCoordinator } from '../../src/js/milkdrop/runtime/catalog-coordinator.ts';
import { FIRST_RUN_PRESET_ID } from '../../src/js/milkdrop/runtime/first-run-preset.ts';
import { createMilkdropPresetNavigationController } from '../../src/js/milkdrop/runtime/preset-navigation-controller.ts';
import type {
  MilkdropCatalogEntry,
  MilkdropCatalogStore,
  MilkdropCompiledPreset,
  MilkdropEditorSession,
  MilkdropPresetSource,
  MilkdropRenderBackend,
  MilkdropSupportStatus,
} from '../../src/js/milkdrop/types.ts';

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
    fidelityTier: 'semantic-only',
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
      applyCompiledPreset: () => undefined,
      applyPresetPerformanceOverride: () => undefined,
      setOverlayStatus: () => undefined,
      shouldFallbackToWebgl: () => false,
      triggerWebglFallback: () => undefined,
      rememberLastPreset: () => undefined,
      beginPresetTransition: () => ({
        mode: 'blend' as const,
        durationSeconds: 1,
      }),
    });

    expect(controller.isBackendSelectable('unsupported-webgl', 'webgl')).toBe(
      false,
    );
    expect(controller.getFirstSelectablePresetId('webgl')).toBe(
      'supported-webgl',
    );
  });

  test('prefers the first-run preset over sort order, but only when it can run', () => {
    const build = (entries: ReturnType<typeof createCatalogEntry>[]) =>
      createMilkdropPresetNavigationController({
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
        getActivePresetId: () => 'head-of-sort-order',
        getActiveBackend: () => 'webgl',
        applyCompiledPreset: () => undefined,
        applyPresetPerformanceOverride: () => undefined,
        setOverlayStatus: () => undefined,
        shouldFallbackToWebgl: () => false,
        triggerWebglFallback: () => undefined,
        rememberLastPreset: () => undefined,
        beginPresetTransition: () => ({
          mode: 'blend' as const,
          durationSeconds: 1,
        }),
      });

    const supportedEverywhere = {
      webgl: 'supported',
      webgpu: 'supported',
    } as const;

    // Present and runnable: it wins even though it is not first in the list.
    expect(
      build([
        createCatalogEntry('head-of-sort-order', supportedEverywhere),
        createCatalogEntry(FIRST_RUN_PRESET_ID, supportedEverywhere),
      ]).getFirstSelectablePresetId('webgl'),
    ).toBe(FIRST_RUN_PRESET_ID);

    // Unsupported on this backend: degrade to sort order rather than to nothing.
    expect(
      build([
        createCatalogEntry('head-of-sort-order', supportedEverywhere),
        createCatalogEntry(FIRST_RUN_PRESET_ID, {
          webgl: 'unsupported',
          webgpu: 'supported',
        }),
      ]).getFirstSelectablePresetId('webgl'),
    ).toBe('head-of-sort-order');

    // Absent from the catalog entirely: same degradation, no crash.
    expect(
      build([
        createCatalogEntry('head-of-sort-order', supportedEverywhere),
      ]).getFirstSelectablePresetId('webgl'),
    ).toBe('head-of-sort-order');
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
      applyCompiledPreset: (compiled) => {
        activePresetId = compiled.source.id;
        selected.push(compiled.source.id);
      },
      applyPresetPerformanceOverride: () => undefined,
      setOverlayStatus: () => undefined,
      shouldFallbackToWebgl: () => false,
      triggerWebglFallback: () => undefined,
      rememberLastPreset: () => undefined,
      beginPresetTransition: () => ({
        mode: 'blend' as const,
        durationSeconds: 1,
      }),
    });

    await controller.selectAdjacentPreset(1);

    expect(selected).toEqual(['supported-c']);
    expect(activePresetId).toBe('supported-c');
  });

  describe('skipIfAlreadyActive', () => {
    // Startup uses this so the bundled first-run preset, already compiled and
    // rendering, is not fetched and recompiled the moment catalog selection
    // resolves to that same id.
    const buildSkipHarness = (draft: string | null) => {
      const fetched: string[] = [];
      const applied: string[] = [];
      const transitions: number[] = [];
      const controller = createMilkdropPresetNavigationController({
        catalogStore: {
          async getPresetSource(id: string) {
            fetched.push(id);
            return { id, title: id, raw: `title=${id}\n`, origin: 'bundled' };
          },
          async getDraft() {
            return draft;
          },
          async saveDraft() {},
        } as unknown as MilkdropCatalogStore,
        catalogCoordinator: {
          async syncCatalog() {},
          async scheduleCatalogSync() {},
          async rememberSelection() {},
          async consumePreviousSelection() {
            return null;
          },
          getCatalogEntries: () => [],
          getActiveCatalogEntry: () => null,
          dispose() {},
        } as unknown as MilkdropCatalogCoordinator,
        session: createSession({
          'active-preset': createCompiledPreset('active-preset'),
        }),
        getActivePresetId: () => 'active-preset',
        getActiveBackend: () => 'webgl' as MilkdropRenderBackend,
        applyCompiledPreset: (compiled) => {
          applied.push(compiled.source.id);
        },
        applyPresetPerformanceOverride: () => undefined,
        setOverlayStatus: () => undefined,
        shouldFallbackToWebgl: () => false,
        triggerWebglFallback: () => undefined,
        rememberLastPreset: () => undefined,
        beginPresetTransition: () => {
          transitions.push(1);
          return { mode: 'blend' as const, durationSeconds: 1 };
        },
      });

      return { controller, fetched, applied, transitions };
    };

    test('does not reload the preset that is already active', async () => {
      const { controller, fetched, applied, transitions } =
        buildSkipHarness(null);

      await controller.selectPreset('active-preset', {
        skipIfAlreadyActive: true,
      });

      expect(fetched).toEqual([]);
      expect(applied).toEqual([]);
      // No transition either: crossfading a preset into itself is the visible
      // symptom this skip removes.
      expect(transitions).toEqual([]);
    });

    test('still loads when an edited draft exists for that preset', async () => {
      const { controller, fetched, applied } = buildSkipHarness(
        'title=active-preset\nzoom=2\n',
      );

      await controller.selectPreset('active-preset', {
        skipIfAlreadyActive: true,
      });

      expect(fetched).toEqual(['active-preset']);
      expect(applied).toEqual(['active-preset']);
    });

    test('loads normally for a different preset', async () => {
      const { controller, fetched } = buildSkipHarness(null);

      await controller.selectPreset('other-preset', {
        skipIfAlreadyActive: true,
      });

      expect(fetched).toEqual(['other-preset']);
    });
  });

  test('includes detailed descriptor unsupported reasons when triggering WebGL fallback', async () => {
    const entries = [
      createCatalogEntry('fallback-preset', {
        webgl: 'supported',
        webgpu: 'partial',
      }),
    ];
    const compiled = createCompiledPreset('fallback-preset');
    compiled.ir.compatibility.gpuDescriptorPlans.webgpu.unsupported = [
      {
        kind: 'unsupported-feature',
        feature: 'custom-waves',
        reason: 'Procedural custom waves not supported on WebGPU',
        recommendedFallback: 'webgl',
      },
    ];

    let fallbackReason = '';
    const controller = createMilkdropPresetNavigationController({
      catalogStore: {
        async getPresetSource(id: string) {
          return {
            id,
            title: id,
            raw: 'title=fallback-preset\n',
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
      session: {
        async loadPreset() {
          return {
            activeCompiled: compiled,
            diagnostics: [
              {
                severity: 'warning',
                category: 'backend-compat',
                code: 'unsupported_feature',
                message: 'Procedural custom waves not supported on WebGPU',
              },
            ],
          };
        },
      } as unknown as MilkdropEditorSession,
      getActivePresetId: () => 'fallback-preset',
      getActiveBackend: () => 'webgpu' as MilkdropRenderBackend,
      applyCompiledPreset: () => undefined,
      applyPresetPerformanceOverride: () => undefined,
      setOverlayStatus: () => undefined,
      shouldFallbackToWebgl: () => true,
      triggerWebglFallback: ({ reason }) => {
        fallbackReason = reason;
      },
      rememberLastPreset: () => undefined,
      beginPresetTransition: () => ({
        mode: 'blend' as const,
        durationSeconds: 1,
      }),
    });

    await controller.selectPreset('fallback-preset');

    expect(fallbackReason).toContain(
      'Procedural custom waves not supported on WebGPU',
    );
  });

  test('prepareNextRandomPreset plans a pick that the advance then consumes', async () => {
    const entries = [
      createCatalogEntry('active-preset', {
        webgl: 'supported',
        webgpu: 'supported',
      }),
      createCatalogEntry('other-preset', {
        webgl: 'supported',
        webgpu: 'supported',
      }),
    ];
    const compiled = createCompiledPreset('other-preset');
    const sourceFetches: string[] = [];
    const applied: string[] = [];

    const controller = createMilkdropPresetNavigationController({
      catalogStore: {
        async getPresetSource(id: string) {
          sourceFetches.push(id);
          return {
            id,
            title: id,
            raw: `title=${id}\n`,
            origin: 'bundled',
          } satisfies MilkdropPresetSource;
        },
        async getDraft() {
          return null;
        },
      } as unknown as MilkdropCatalogStore,
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
      session: createSession({ 'other-preset': compiled }),
      getActivePresetId: () => 'active-preset',
      getActiveBackend: () => 'webgl',
      applyCompiledPreset: (next) => {
        applied.push(next.source.id);
      },
      applyPresetPerformanceOverride: () => undefined,
      setOverlayStatus: () => undefined,
      shouldFallbackToWebgl: () => false,
      triggerWebglFallback: () => undefined,
      rememberLastPreset: () => undefined,
      beginPresetTransition: () => ({
        mode: 'blend' as const,
        durationSeconds: 1,
      }),
    });

    // Only one candidate besides the active preset, so the plan is
    // deterministic: prepare must prefetch it, and the advance must apply
    // the planned pick without re-rolling.
    controller.prepareNextRandomPreset();
    // The prefetch fetch is fire-and-forget; give the microtask queue a turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sourceFetches).toContain('other-preset');

    // Planning twice must not re-pick or re-fetch while the plan is valid.
    const fetchesAfterFirstPlan = sourceFetches.length;
    controller.prepareNextRandomPreset();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sourceFetches.length).toBe(fetchesAfterFirstPlan);

    await controller.selectRandomPreset();
    expect(applied).toEqual(['other-preset']);
  });

  test('a superseded load never starts a transition', async () => {
    // Reported as "swiping through presets too quickly breaks the rendering".
    // beginPresetTransition used to run before `rememberSelection` and the JIT
    // pre-warm, both of which can still bail out as superseded — and nothing
    // unwinds a started transition. So a fast swipe left a cover fading over a
    // preset that never changed, and still paid the switch's costs: a saved
    // feedback frame and notePresetApplied, which pre-degrades a quality step
    // on constrained devices. Swiping walked the renderer toward its minimum
    // quality for presets that were never applied.
    const entries = [
      createCatalogEntry('first', { webgl: 'supported', webgpu: 'supported' }),
      createCatalogEntry('second', { webgl: 'supported', webgpu: 'supported' }),
    ];
    const compiledById = Object.fromEntries(
      entries.map((entry) => [entry.id, createCompiledPreset(entry.id)]),
    );
    const applied: string[] = [];
    const transitionsStarted: string[] = [];
    let pendingSelection: string | null = null;
    let selectPreset: (id: string) => Promise<void> = async () => {};

    const controller = createMilkdropPresetNavigationController({
      catalogStore: {
        async getPresetSource(id: string) {
          return { id, title: id, raw: `title=${id}\n`, origin: 'bundled' };
        },
        async getDraft() {
          return null;
        },
      } as unknown as MilkdropCatalogStore,
      catalogCoordinator: {
        async syncCatalog() {},
        async scheduleCatalogSync() {},
        // The supersede point: while the first load is awaiting this, a second
        // selection arrives — exactly what a fast swipe does.
        async rememberSelection(id: string) {
          if (id === 'first' && pendingSelection) {
            const next = pendingSelection;
            pendingSelection = null;
            await selectPreset(next);
          }
        },
        async consumePreviousSelection() {
          return null;
        },
        getCatalogEntries: () => entries,
        getActiveCatalogEntry: () => null,
        dispose() {},
      } as unknown as MilkdropCatalogCoordinator,
      session: createSession(compiledById),
      getActivePresetId: () => 'first',
      getActiveBackend: () => 'webgl' as MilkdropRenderBackend,
      applyCompiledPreset: (compiled) => {
        applied.push(compiled.source.id);
      },
      applyPresetPerformanceOverride: () => undefined,
      setOverlayStatus: () => undefined,
      shouldFallbackToWebgl: () => false,
      triggerWebglFallback: () => undefined,
      rememberLastPreset: () => undefined,
      beginPresetTransition: () => {
        transitionsStarted.push(applied.length === 0 ? 'pending' : 'later');
        return { mode: 'blend' as const, durationSeconds: 1 };
      },
    });

    selectPreset = (id: string) => controller.selectPreset(id);
    pendingSelection = 'second';
    await controller.selectPreset('first');

    // Only the switch that actually landed may have started a transition.
    expect(applied).toEqual(['second']);
    expect(transitionsStarted).toHaveLength(1);
  });
});
