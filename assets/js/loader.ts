import { setCurrentToy } from './core/agent-api.ts';
import { getRendererCapabilities } from './core/renderer-capabilities.ts';
import {
  prewarmMicrophone,
  resetAudioPool,
} from './core/services/audio-service.ts';
import { prewarmRendererCapabilities } from './core/services/render-service.ts';
import type { ToyLaunchRequest } from './core/toy-launch.ts';
import {
  defaultToyLifecycle,
  type ToyLifecycle,
} from './core/toy-lifecycle.ts';
import toyManifest from './data/toy-manifest.ts';
import type { ToyEntry } from './data/toy-schema.ts';
import { createLoaderRouteController } from './loader/route-controller.ts';
import { createToyAudioPromptController } from './loader/toy-audio-prompt-controller.ts';
import { createToyCapabilityController } from './loader/toy-capability-controller.ts';
import { createToyLaunchController } from './loader/toy-launch-controller.ts';
import { createToyLifecycleOrchestration } from './loader/toy-lifecycle-orchestration.ts';
import { createToySessionController } from './loader/toy-session-controller.ts';
import { createRouter } from './router.ts';
import { createToyView } from './toy-view.ts';
import { recordToyOpen } from './utils/growth-metrics.ts';
import { createManifestClient } from './utils/manifest-client';
import { ensureWebGL } from './utils/webgl-check.ts';

type Toy = ToyEntry;

const TOY_QUERY_PARAM = 'toy';

const TOY_MICRO_GOALS: Record<string, string[]> = {
  holy: ['Boost intensity, then settle into a calmer palette.'],
  'bubble-harmonics': [
    'Find a high-frequency moment and trigger a bubble split.',
  ],
  'spiral-burst': ['Make the pulse feel synced to your beat for 10 seconds.'],
  'aurora-painter': ['Draw one smooth ribbon, then thicken it with density.'],
  geom: ['Test quiet vs loud input and watch the shape response.'],
};

export { getFlowIntervalMs } from './loader/toy-session-controller.ts';

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
  let activeToySlug: string | null = null;
  const sessionController = createToySessionController({ toys, view });
  const capabilityController = createToyCapabilityController({
    ensureWebGLCheck,
    rendererCapabilities,
  });
  const launchController = createToyLaunchController({
    manifestClient,
    lifecycle,
    toys,
  });
  const audioPromptController = createToyAudioPromptController({ view });
  const {
    disposeActiveToy,
    removeEscapeHandler,
    registerEscapeHandler,
    updateRendererStatus,
  } = createToyLifecycleOrchestration({ lifecycle, view });

  const showModuleImportError = (
    toy: Toy,
    { moduleUrl, importError }: { moduleUrl?: string; importError: Error },
  ) => {
    view.showImportError(toy, {
      moduleUrl,
      importError,
      onBack: backToLibrary,
      onBrowseCompatible: capabilityController.browseCompatibleToys,
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
    sessionController.clearOnBack();
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
    const capabilityDecision = await capabilityController.assess({
      toy,
      initialCapabilities,
      forceRendererRetry,
    });

    let capabilities = capabilityDecision.capabilities;

    if (capabilityDecision.runMode === 'blocked') {
      return;
    }

    disposeActiveToy();
    removeEscapeHandler();
    const handleNextToy = sessionController.createNextToyHandler({
      getCurrentSlug: () => activeToySlug ?? toy.slug,
      loadToy,
      preferDemoAudio,
    });

    const container = view.showActiveToyView(backToLibrary, toy, {
      onNextToy: handleNextToy,
      onToggleHaptics: (active) =>
        sessionController.haptics.setHapticsEnabled(active),
      hapticsActive: sessionController.haptics.getHapticsEnabled(),
      hapticsSupported: sessionController.canUseHaptics(),
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

      const launchRequest: ToyLaunchRequest = {
        slug: toy.slug,
        container,
        audioPreference: preferDemoAudio ? 'demo' : 'microphone',
        forceRendererRetry,
      };
      const moduleResult = await launchController.launchToy({
        toy,
        request: launchRequest,
      });
      if (!moduleResult.ok) {
        console.error('Error loading toy module:', moduleResult.error);
        showModuleImportError(toy, {
          moduleUrl: moduleResult.moduleUrl,
          importError: moduleResult.error,
        });
        return;
      }

      const { launchResult } = moduleResult;
      lifecycle.adoptActiveToy(
        launchResult.instance ?? lifecycle.getActiveToy()?.ref,
      );

      view.removeStatusElement();

      // Track toy load for agents
      setCurrentToy(toy.slug);
      activeToySlug = toy.slug;
      sessionController.session.rememberToy(toy.slug);
      recordToyOpen(toy.slug, pushState ? 'library' : 'direct');
      audioPromptController.maybeShowPrompt({
        launchResult,
        preferDemoAudio,
        container,
        starterTips: TOY_MICRO_GOALS[toy.slug] ?? [
          'Try mic, then demo audio, and keep whichever feels better.',
        ],
      });
    };

    if (capabilityDecision.shouldShowCapabilityError) {
      const compatibilityModeEnabled =
        capabilities.fallbackReason ===
        'Compatibility mode is enabled. Using WebGL.';
      view.showCapabilityError(toy, {
        allowFallback: capabilityDecision.allowWebGLFallback,
        onBack: backToLibrary,
        onBrowseCompatible: capabilityController.browseCompatibleToys,
        details: capabilities.fallbackReason,
        compatibilityModeEnabled,
        shouldRetryWebGPU: capabilities.shouldRetryWebGPU,
        onUseWebGPU:
          compatibilityModeEnabled || capabilities.shouldRetryWebGPU
            ? capabilityController.createUseWebGPU({
                compatibilityModeEnabled,
                retry: capabilityController.createFallbackRetry({
                  toy,
                  pushState,
                  preferDemoAudio,
                  startFlow: sessionController.isFlowActive(),
                  startPartyMode: sessionController.isPartyModeActive(),
                  loadToy,
                  view,
                }),
              })
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
    sessionController.syncBeforeLoad({ startFlow, startPartyMode });

    const toy = launchController.findToy(slug);
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
  const routeController = createLoaderRouteController({
    backToLibrary,
    loadToy: async (slug: string) => loadToy(slug),
  });

  const loadFromQuery = async () => {
    const route = router.getCurrentRoute();
    await routeController.handleRoute(route, { updateRoute: false });
  };

  const initNavigation = () => {
    sessionController.session.initInteractionTracking();
    if (navigationInitialized) return;

    navigationInitialized = true;
    router.listen((route) => {
      void routeController.handleRoute(route, { updateRoute: false });
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
