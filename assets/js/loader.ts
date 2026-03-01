import { setAudioActive, setCurrentToy } from './core/agent-api.ts';
import { setCompatibilityMode } from './core/render-preferences.ts';
import { getRendererCapabilities } from './core/renderer-capabilities.ts';
import {
  prewarmMicrophone,
  resetAudioPool,
} from './core/services/audio-service.ts';
import { prewarmRendererCapabilities } from './core/services/render-service.ts';
import {
  ensureToyAudioStarter,
  startToyAudioFromSource,
} from './core/toy-audio-startup.ts';
import { assessToyCapabilities } from './core/toy-capabilities.ts';
import type { ToyWindow } from './core/toy-globals';
import {
  defaultToyLifecycle,
  type ToyLifecycle,
} from './core/toy-lifecycle.ts';
import toyManifest from './data/toy-manifest.ts';
import type { ToyEntry } from './data/toy-schema.ts';
import { createFlowTimer, getFlowIntervalMs } from './loader/flow-timer.ts';
import { canUseHaptics, createHapticsController } from './loader/haptics.ts';
import { createSessionTracking } from './loader/session-tracking.ts';
import { createToyLifecycleOrchestration } from './loader/toy-lifecycle-orchestration.ts';
import { createRouter, type Route } from './router.ts';
import { createToyView } from './toy-view.ts';
import { recordToyOpen } from './utils/growth-metrics.ts';
import { createManifestClient } from './utils/manifest-client';
import { applyPartyMode } from './utils/party-mode';
import { loadToyModuleStarter } from './utils/toy-module-loader';
import { ensureWebGL } from './utils/webgl-check';

type Toy = ToyEntry;

const TOY_QUERY_PARAM = 'toy';
const LIBRARY_FILTER_PARAM = 'filters';
const COMPATIBILITY_MODE_KEY = 'stims-compatibility-mode';
const TOY_MICRO_GOALS: Record<string, string[]> = {
  holy: ['Boost intensity, then settle into a calmer palette.'],
  'bubble-harmonics': [
    'Find a high-frequency moment and trigger a bubble split.',
  ],
  'spiral-burst': ['Make the pulse feel synced to your beat for 10 seconds.'],
  'aurora-painter': ['Draw one smooth ribbon, then thicken it with density.'],
  geom: ['Test quiet vs loud input and watch the shape response.'],
};

export { getFlowIntervalMs } from './loader/flow-timer.ts';

// createLoader orchestrates routing/navigation, renderer capability checks,
// module resolution/import, view updates, and lifecycle management.
export function createLoader({
  manifestClient = createManifestClient(),
  router = createRouter({ queryParam: TOY_QUERY_PARAM }),
  view = createToyView(),
  ensureWebGLCheck = ensureWebGL,
  rendererCapabilities = getRendererCapabilities,
  toys = toyManifest,
  prewarmRendererCapabilitiesFn = prewarmRendererCapabilities,
  prewarmMicrophoneFn = prewarmMicrophone,
  resetAudioPoolFn = resetAudioPool,
  toyLifecycle = defaultToyLifecycle,
}: {
  manifestClient?: ReturnType<typeof createManifestClient>;
  router?: ReturnType<typeof createRouter>;
  view?: ReturnType<typeof createToyView>;
  ensureWebGLCheck?: typeof ensureWebGL;
  rendererCapabilities?: typeof getRendererCapabilities;
  toys?: Toy[];
  prewarmRendererCapabilitiesFn?: typeof prewarmRendererCapabilities;
  prewarmMicrophoneFn?: typeof prewarmMicrophone;
  resetAudioPoolFn?: typeof resetAudioPool;
  toyLifecycle?: ToyLifecycle;
} = {}) {
  let navigationInitialized = false;
  const lifecycle = toyLifecycle ?? defaultToyLifecycle;
  lifecycle.reset();
  let flowActive = false;
  let partyModeActive = false;
  let flowCycleCount = 0;
  let activeToySlug: string | null = null;
  let nextToyInFlight = false;
  let handleNextToy: ((fromFlow?: boolean) => Promise<void>) | null = null;

  const session = createSessionTracking({ toys });
  const haptics = createHapticsController({
    view,
    isPartyModeActive: () => partyModeActive,
  });
  const {
    disposeActiveToy,
    removeEscapeHandler,
    registerEscapeHandler,
    updateRendererStatus,
  } = createToyLifecycleOrchestration({ lifecycle, view });

  const flowTimer = createFlowTimer({
    getDelay: () =>
      getFlowIntervalMs({
        cycleCount: flowCycleCount,
        lastInteractionAt: session.getLastInteractionAt(),
      }),
    onTick: () => {
      if (handleNextToy) {
        void handleNextToy(true);
      }
    },
  });

  const scheduleFlow = () => {
    flowTimer.clear();
    if (!flowActive) return;
    flowTimer.schedule();
  };

  const setFlowActive = (active: boolean) => {
    flowActive = active;
    if (!flowActive) {
      flowCycleCount = 0;
      flowTimer.clear();
      return;
    }
    session.markInteraction();
    flowCycleCount = 0;
    scheduleFlow();
  };

  const setPartyModeActive = (active: boolean) => {
    partyModeActive = active;
    applyPartyMode({ enabled: active });
  };

  const showModuleImportError = (
    toy: Toy,
    { moduleUrl, importError }: { moduleUrl?: string; importError: Error },
  ) => {
    view.showImportError(toy, {
      moduleUrl,
      importError,
      onBack: backToLibrary,
      onBrowseCompatible: browseCompatibleToys,
    });
  };

  const backToLibrary = ({ updateRoute = true } = {}) => {
    removeEscapeHandler();
    disposeActiveToy();
    view.showLibraryView();
    if (updateRoute) {
      router.goToLibrary();
    }
    updateRendererStatus(null);
    void resetAudioPoolFn({ stopStreams: true });
    activeToySlug = null;
    setFlowActive(false);
    if (partyModeActive) {
      setPartyModeActive(false);
    }
    haptics.clearBeatHapticsListener();
  };

  const browseCompatibleToys = () => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const currentFilters = (url.searchParams.get(LIBRARY_FILTER_PARAM) ?? '')
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
      .filter((token) => token.toLowerCase() !== 'feature:webgpu');
    url.searchParams.set(
      LIBRARY_FILTER_PARAM,
      Array.from(new Set([...currentFilters, 'feature:compatible'])).join(','),
    );
    url.searchParams.delete(TOY_QUERY_PARAM);
    url.pathname = url.pathname.endsWith('/toy.html')
      ? url.pathname.replace(/\/toy\.html$/, '/index.html')
      : url.pathname;
    try {
      window.sessionStorage.setItem(COMPATIBILITY_MODE_KEY, 'true');
    } catch (_error) {
      // Ignore storage access issues.
    }
    window.location.href = url.toString();
  };

  const startModuleToy = async (
    toy: Toy,
    pushState: boolean,
    preferDemoAudio: boolean,
    initialCapabilities?: Awaited<ReturnType<typeof rendererCapabilities>>,
    forceRendererRetry = false,
  ) => {
    void prewarmRendererCapabilitiesFn();
    void prewarmMicrophoneFn();
    const capabilityDecision = await assessToyCapabilities({
      toy,
      rendererCapabilities: () =>
        rendererCapabilities({ forceRetry: forceRendererRetry }),
      ensureWebGLCheck,
      initialCapabilities,
    });

    let capabilities = capabilityDecision.capabilities;

    if (!capabilityDecision.supportsRendering) {
      return;
    }

    disposeActiveToy();
    removeEscapeHandler();

    handleNextToy = async (fromFlow = false) => {
      if (nextToyInFlight) return;
      const currentSlug = activeToySlug ?? toy.slug;
      const nextSlug = session.pickNextToySlug(currentSlug);
      if (!nextSlug) {
        if (fromFlow) {
          setFlowActive(false);
        }
        return;
      }
      nextToyInFlight = true;
      flowTimer.clear();
      try {
        flowCycleCount += fromFlow ? 1 : 0;
        await loadToy(nextSlug, { pushState: true, preferDemoAudio });
      } finally {
        nextToyInFlight = false;
        if (flowActive) {
          scheduleFlow();
        }
      }
    };

    const container = view.showActiveToyView(backToLibrary, toy, {
      onNextToy: handleNextToy,
      onToggleHaptics: (active) => haptics.setHapticsEnabled(active),
      hapticsActive: haptics.getHapticsEnabled(),
      hapticsSupported: canUseHaptics(),
    });
    if (!container) return;
    updateRendererStatus(
      capabilities,
      capabilities.shouldRetryWebGPU
        ? async () => {
            capabilities = await rendererCapabilities({ forceRetry: true });
            updateRendererStatus(capabilities);
            if (capabilities.preferredBackend === 'webgpu') {
              disposeActiveToy();
              view.clearActiveToyContainer?.();
              await startModuleToy(toy, false, preferDemoAudio, capabilities);
            }
          }
        : undefined,
    );

    registerEscapeHandler(backToLibrary);

    let navigated = false;
    const commitNavigation = () => {
      if (pushState && !navigated) {
        router.pushToyState(toy.slug);
        navigated = true;
      }
    };

    const runToy = async () => {
      commitNavigation();
      view.showLoadingIndicator(toy.title || toy.slug, toy);

      const moduleResult = await loadToyModuleStarter({
        moduleId: toy.module,
        manifestClient,
      });
      if (!moduleResult.ok) {
        console.error('Error loading toy module:', moduleResult.error);
        showModuleImportError(toy, {
          moduleUrl: moduleResult.moduleUrl,
          importError: moduleResult.error,
        });
        return;
      }

      const { moduleUrl, starter } = moduleResult;

      try {
        const active = await starter({
          container,
          slug: toy.slug,
          preferDemoAudio,
        });
        lifecycle.adoptActiveToy(active ?? lifecycle.getActiveToy()?.ref);
      } catch (error) {
        console.error('Error starting toy module:', error);
        showModuleImportError(toy, {
          moduleUrl,
          importError: error as Error,
        });
        return;
      }

      view.removeStatusElement();

      // Track toy load for agents
      setCurrentToy(toy.slug);
      activeToySlug = toy.slug;
      session.rememberToy(toy.slug);
      recordToyOpen(toy.slug, pushState ? 'library' : 'direct');

      // Setup audio prompt if startAudio globals are registered by the toy.
      const win = (container?.ownerDocument.defaultView ??
        window) as unknown as ToyWindow;
      const setupAudioPrompt = async () => {
        try {
          await ensureToyAudioStarter(win);
        } catch (_error) {
          return;
        }

        let lastAudioSource: 'microphone' | 'demo' = 'microphone';

        view.showAudioPrompt(true, {
          preferDemoAudio,
          starterTips: TOY_MICRO_GOALS[toy.slug] ?? [
            'Try mic, then demo audio, and keep whichever feels better.',
          ],
          onRequestMicrophone: async () => {
            lastAudioSource = 'microphone';
            await startToyAudioFromSource(win, { source: 'microphone' });
          },
          onRequestDemoAudio: async () => {
            lastAudioSource = 'demo';
            await startToyAudioFromSource(win, { source: 'demo' });
          },
          onSuccess: () => {
            view.showAudioPrompt(false);
            setAudioActive(true, lastAudioSource);
          },
        });

        if (preferDemoAudio) {
          const demoButton = container?.querySelector('#use-demo-audio');
          if (demoButton instanceof HTMLButtonElement) {
            demoButton.click();
          }
        }
      };

      void setupAudioPrompt();
    };

    if (capabilityDecision.shouldShowCapabilityError) {
      const compatibilityModeEnabled =
        capabilities.fallbackReason ===
        'Compatibility mode is enabled. Using WebGL.';
      view.showCapabilityError(toy, {
        allowFallback: capabilityDecision.allowWebGLFallback,
        onBack: backToLibrary,
        onBrowseCompatible: browseCompatibleToys,
        details: capabilities.fallbackReason,
        compatibilityModeEnabled,
        shouldRetryWebGPU: capabilities.shouldRetryWebGPU,
        onUseWebGPU:
          compatibilityModeEnabled || capabilities.shouldRetryWebGPU
            ? () => {
                if (compatibilityModeEnabled) {
                  setCompatibilityMode(false);
                }
                view.clearActiveToyContainer();
                void loadToy(toy.slug, {
                  pushState,
                  preferDemoAudio,
                  startFlow: flowActive,
                  startPartyMode: partyModeActive,
                  forceRendererRetry: true,
                });
              }
            : undefined,
        onContinue: capabilityDecision.allowWebGLFallback
          ? () => {
              view.clearActiveToyContainer();
              void runToy();
            }
          : undefined,
      });

      return;
    }

    await runToy();
  };

  const loadToy = async (
    slug: string,
    {
      pushState = false,
      preferDemoAudio = false,
      startFlow,
      startPartyMode,
      forceRendererRetry = false,
    }: {
      pushState?: boolean;
      preferDemoAudio?: boolean;
      startFlow?: boolean;
      startPartyMode?: boolean;
      forceRendererRetry?: boolean;
    } = {},
  ) => {
    session.initInteractionTracking();

    if (canUseHaptics() && !haptics.getHapticsEnabled()) {
      haptics.setFromPersisted();
    }

    if (typeof startFlow === 'boolean') {
      setFlowActive(startFlow);
    }

    if (typeof startPartyMode === 'boolean') {
      setPartyModeActive(startPartyMode);
    }

    haptics.syncBeatHapticsListener();

    const toy = toys.find((t) => t.slug === slug);
    if (!toy) {
      console.error(`Toy not found: ${slug}`);
      view.showUnavailableToy?.(slug, { onBack: backToLibrary });
      return;
    }

    if (toy.type === 'module') {
      await startModuleToy(
        toy,
        pushState,
        preferDemoAudio,
        undefined,
        forceRendererRetry,
      );
      return;
    }

    disposeActiveToy();
    updateRendererStatus(null);

    if (typeof window !== 'undefined') {
      window.location.href = toy.module;
    }
  };

  const handleRoute = async (route: Route, { updateRoute = false } = {}) => {
    if (route.view === 'toy') {
      if (route.slug) {
        await loadToy(route.slug);
        return;
      }
      backToLibrary({ updateRoute: true });
      return;
    }

    backToLibrary({ updateRoute });
  };

  const loadFromQuery = async () => {
    const route = router.getCurrentRoute();
    await handleRoute(route, { updateRoute: false });
  };

  const initNavigation = () => {
    session.initInteractionTracking();
    if (navigationInitialized) return;

    navigationInitialized = true;
    router.listen((route) => {
      void handleRoute(route, { updateRoute: false });
    });
  };

  return {
    loadToy,
    loadFromQuery,
    initNavigation,
  };
}

const defaultLoader = createLoader();

export const loadToy = defaultLoader.loadToy;
export const loadFromQuery = defaultLoader.loadFromQuery;
export const initNavigation = defaultLoader.initNavigation;
