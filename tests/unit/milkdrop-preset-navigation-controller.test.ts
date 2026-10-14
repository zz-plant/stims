import { describe, expect, test } from 'bun:test';
import type { MilkdropCatalogCoordinator } from '../../src/js/milkdrop/runtime/catalog-coordinator.ts';
import { FIRST_RUN_PRESET_ID } from '../../src/js/milkdrop/runtime/first-run-preset.ts';
import { createMilkdropPresetNavigationController } from '../../src/js/milkdrop/runtime/preset-navigation-controller.ts';
import { awaitStartupForEdit } from '../../src/js/milkdrop/runtime/startup.ts';
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
      triggerWebglFallback: () => false,
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
        triggerWebglFallback: () => false,
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
      triggerWebglFallback: () => false,
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
      const cleared: string[] = [];
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
          async clearDraft(id: string) {
            cleared.push(id);
          },
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
        triggerWebglFallback: () => false,
        rememberLastPreset: () => undefined,
        beginPresetTransition: () => {
          transitions.push(1);
          return { mode: 'blend' as const, durationSeconds: 1 };
        },
      });

      return { controller, fetched, applied, transitions, cleared };
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

    test('drops a draft that is only the source itself', async () => {
      // Every load used to save one of these, pinning the preset to the copy
      // first seen.
      const { controller, cleared } = buildSkipHarness('title=other-preset\n');
      await controller.selectPreset('other-preset');
      expect(cleared).toEqual(['other-preset']);
    });

    test('keeps a draft that is a real edit', async () => {
      const { controller, cleared } = buildSkipHarness(
        'title=other-preset\nzoom=2\n',
      );
      await controller.selectPreset('other-preset');
      expect(cleared).toEqual([]);
    });

    test('loads normally for a different preset', async () => {
      const { controller, fetched } = buildSkipHarness(null);

      await controller.selectPreset('other-preset', {
        skipIfAlreadyActive: true,
      });

      expect(fetched).toEqual(['other-preset']);
    });
  });

  describe('unlessRequestedSince', () => {
    // Startup decides its preset, waits on a catalog sync, then selects. A
    // preset chosen during that wait (the shell routing a request that
    // arrived while the stage was mounting) must keep the stage.
    const buildRaceHarness = () => {
      const applied: string[] = [];
      const controller = createMilkdropPresetNavigationController({
        catalogStore: {
          async getPresetSource(id: string) {
            return { id, title: id, raw: `title=${id}\n`, origin: 'bundled' };
          },
          async getDraft() {
            return null;
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
          'requested-preset': createCompiledPreset('requested-preset'),
          'startup-preset': createCompiledPreset('startup-preset'),
        }),
        getActivePresetId: () => 'bundled-preset',
        getActiveBackend: () => 'webgl' as MilkdropRenderBackend,
        applyCompiledPreset: (compiled) => {
          applied.push(compiled.source.id);
        },
        applyPresetPerformanceOverride: () => undefined,
        setOverlayStatus: () => undefined,
        shouldFallbackToWebgl: () => false,
        triggerWebglFallback: () => false,
        rememberLastPreset: () => undefined,
        beginPresetTransition: () => ({
          mode: 'cut' as const,
          durationSeconds: 0,
        }),
      });
      return { controller, applied };
    };

    test('a pick decided before the wait yields to a preset chosen during it', async () => {
      const { controller, applied } = buildRaceHarness();
      const revision = controller.getLoadRequestRevision();

      const requested = controller.selectPreset('requested-preset');
      const startup = controller.selectPreset('startup-preset', {
        unlessRequestedSince: revision,
      });
      await Promise.all([requested, startup]);

      expect(applied).toEqual(['requested-preset']);
    });

    test('the pick still loads when nothing was chosen meanwhile', async () => {
      const { controller, applied } = buildRaceHarness();
      const revision = controller.getLoadRequestRevision();

      await controller.selectPreset('startup-preset', {
        unlessRequestedSince: revision,
      });

      expect(applied).toEqual(['startup-preset']);
    });

    // A shared draft is handed to the runtime while startup is still pending
    // and waits for it (awaitStartupForEdit). It is written for the preset
    // startup lands on, so a different pick during the wait must reject it
    // rather than save it as a draft of that pick.
    describe('an edit waiting on startup', () => {
      const runStartup = async (
        controller: ReturnType<typeof buildRaceHarness>['controller'],
        during: () => Promise<void> = async () => {},
      ) => {
        const revisionBeforeStartup = controller.getLoadRequestRevision();
        const { promise: startupSettled, resolve: settle } =
          Promise.withResolvers<void>();
        const edit = awaitStartupForEdit({
          navigation: controller,
          startupSettled,
          getStartupPresetId: () => 'startup-preset',
        });
        await during();
        await controller.selectPreset('startup-preset', {
          unlessRequestedSince: revisionBeforeStartup,
        });
        settle();
        return edit;
      };

      test('keeps its target when only the startup pick landed', async () => {
        const { controller } = buildRaceHarness();
        expect(await runStartup(controller)).toBe(true);
      });

      test('is superseded by a different preset chosen during startup', async () => {
        const { controller, applied } = buildRaceHarness();

        const stillTargeted = await runStartup(controller, () =>
          controller.selectPreset('requested-preset'),
        );

        expect(applied).toEqual(['requested-preset']);
        expect(stillTargeted).toBe(false);
      });

      test('keeps its target when the route asked for the startup preset first', async () => {
        // A deep link reaches the stage twice: the shell routes it, and
        // startup resolves to it. Whichever lands, it is the draft's preset.
        const { controller, applied } = buildRaceHarness();

        const stillTargeted = await runStartup(controller, () =>
          controller.selectPreset('startup-preset'),
        );

        expect(applied).toEqual(['startup-preset']);
        expect(stillTargeted).toBe(true);
      });

      test('is superseded by a pick that lands after the startup pick', async () => {
        const { controller } = buildRaceHarness();
        const { promise: startupSettled, resolve: settle } =
          Promise.withResolvers<void>();
        const edit = awaitStartupForEdit({
          navigation: controller,
          startupSettled,
          getStartupPresetId: () => 'startup-preset',
        });

        await controller.selectPreset('startup-preset');
        await controller.selectPreset('requested-preset');
        settle();

        expect(await edit).toBe(false);
      });
    });
  });

  describe('WebGL fallback', () => {
    // Navigation to a preset WebGPU cannot render hands off to the failover,
    // which reloads into WebGL. When it cannot (session storage blocked, so
    // the reload would loop), it reports that no reload is coming.
    const buildFallbackHarness = (reloading: boolean) => {
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

      const fallbackReasons: string[] = [];
      const applied: string[] = [];
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
        getActivePresetId: () => 'active-preset',
        getActiveBackend: () => 'webgpu' as MilkdropRenderBackend,
        applyCompiledPreset: (next) => {
          applied.push(next.source.id);
        },
        applyPresetPerformanceOverride: () => undefined,
        setOverlayStatus: () => undefined,
        shouldFallbackToWebgl: () => true,
        triggerWebglFallback: ({ reason }) => {
          fallbackReasons.push(reason);
          return reloading;
        },
        rememberLastPreset: () => undefined,
        beginPresetTransition: () => ({
          mode: 'blend' as const,
          durationSeconds: 1,
        }),
      });
      return { controller, fallbackReasons, applied };
    };

    test('includes detailed descriptor unsupported reasons when triggering WebGL fallback', async () => {
      const { controller, fallbackReasons } = buildFallbackHarness(true);

      await controller.selectPreset('fallback-preset');

      expect(fallbackReasons.join('\n')).toContain(
        'Procedural custom waves not supported on WebGPU',
      );
    });

    test('stops the switch when the page is reloading into WebGL', async () => {
      const { controller, applied } = buildFallbackHarness(true);

      await controller.selectPreset('fallback-preset');

      expect(applied).toEqual([]);
    });

    test('applies the preset on WebGPU when no reload was scheduled', async () => {
      const { controller, fallbackReasons, applied } =
        buildFallbackHarness(false);

      await controller.selectPreset('fallback-preset');

      // Returning here left the previous preset on stage while the dock and
      // route already named this one.
      expect(fallbackReasons).toHaveLength(1);
      expect(applied).toEqual(['fallback-preset']);
    });
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
      triggerWebglFallback: () => false,
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

  test('autoplay never picks a preset the exclusion rules out', async () => {
    // Reduce flashing hides measured high-risk presets from Browse; the
    // runtime passes the same rule here so autoplay cannot land on one.
    const entries = ['active-preset', 'flashy', 'calm'].map((id) =>
      createCatalogEntry(id, { webgl: 'supported', webgpu: 'supported' }),
    );
    const applied: string[] = [];
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
        scheduleCatalogSync: async () => undefined,
        async rememberSelection() {},
        async consumePreviousSelection() {
          return null;
        },
        getCatalogEntries: () => entries,
        getActiveCatalogEntry: () => null,
        dispose() {},
      } as unknown as MilkdropCatalogCoordinator,
      session: createSession({
        flashy: createCompiledPreset('flashy'),
        calm: createCompiledPreset('calm'),
      }),
      getActivePresetId: () => 'active-preset',
      getActiveBackend: () => 'webgl',
      applyCompiledPreset: (next) => {
        applied.push(next.source.id);
      },
      applyPresetPerformanceOverride: () => undefined,
      setOverlayStatus: () => undefined,
      shouldFallbackToWebgl: () => false,
      triggerWebglFallback: () => false,
      rememberLastPreset: () => undefined,
      beginPresetTransition: () => ({
        mode: 'blend' as const,
        durationSeconds: 1,
      }),
      excludeFromRandom: (entry) => entry.id === 'flashy',
    });

    for (let i = 0; i < 20; i += 1) {
      await controller.selectRandomPreset();
    }
    expect(applied.length).toBe(20);
    expect(applied).not.toContain('flashy');
  });
});

describe('preset pipeline warm-up (waitForPresetWarmup)', () => {
  const buildWarmupHarness = ({
    warmup,
  }: {
    /** The runtime's gate: a controllable promise, or null for sync. */
    warmup: (id: string) => Promise<boolean> | null;
  }) => {
    const order: string[] = [];
    const compiled = createCompiledPreset('warm-target');
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
        scheduleCatalogSync: async () => undefined,
        async rememberSelection() {},
        async consumePreviousSelection() {
          return null;
        },
        getCatalogEntries: () => [],
        getActiveCatalogEntry: () => null,
        dispose() {},
      } as unknown as MilkdropCatalogCoordinator,
      session: createSession({ 'warm-target': compiled }),
      getActivePresetId: () => 'active-preset',
      getActiveBackend: () => 'webgpu' as MilkdropRenderBackend,
      applyCompiledPreset: (_next) => {
        order.push('apply');
      },
      applyPresetPerformanceOverride: () => undefined,
      setOverlayStatus: () => undefined,
      shouldFallbackToWebgl: () => false,
      triggerWebglFallback: () => false,
      rememberLastPreset: () => undefined,
      beginPresetTransition: () => {
        order.push('begin');
        return { mode: 'blend' as const, durationSeconds: 1 };
      },
      waitForPresetWarmup: (next) => {
        order.push('warmup');
        return warmup(next.source.id);
      },
    });
    return { order, controller, compiled };
  };

  test('waits for the pipeline warm-up before the transition begins', async () => {
    const release: Array<() => void> = [];
    const { order, controller } = buildWarmupHarness({
      warmup: () =>
        new Promise<boolean>((resolve) => {
          release.push(() => resolve(true));
        }),
    });
    const selection = controller.selectPreset('warm-target');
    // Flush the async preamble (fetch, compile, JIT prewarm) up to the gate.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // The warm-up has been asked for, and neither the transition nor the
    // apply has started: the fade cannot begin before the pipelines warm.
    expect(order).toEqual(['warmup']);
    release[0]?.();
    await selection;
    expect(order).toEqual(['warmup', 'begin', 'apply']);
  });

  test('a null gate keeps the synchronous switch, in order', async () => {
    const { order, controller } = buildWarmupHarness({
      warmup: () => null,
    });
    await controller.selectPreset('warm-target');
    expect(order).toEqual(['warmup', 'begin', 'apply']);
  });

  test('a switch superseded during its warm-up applies nothing', async () => {
    const release: Array<() => void> = [];
    const { order, controller } = buildWarmupHarness({
      warmup: () =>
        new Promise<boolean>((resolve) => {
          release.push(() => resolve(true));
        }),
    });
    const first = controller.selectPreset('warm-target');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    // A rapid second selection supersedes the first mid-warm-up: its source
    // does not resolve, so the first switch can only ever end superseded.
    const second = controller.selectPreset('missing-preset');
    release[0]?.();
    await Promise.allSettled([first, second]);
    expect(order).toEqual(['warmup']);
  });
});
