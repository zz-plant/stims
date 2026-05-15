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
import { ensureWebGL } from './core/webgl-check.ts';
import toyManifest from './data/toy-manifest.ts';
import type { ToyEntry } from './data/toy-schema.ts';
import { createLoaderLibraryResetController } from './loader/library-reset-controller.ts';
import { createLoaderRouteController } from './loader/route-controller.ts';
import { createToyAudioPromptController } from './loader/toy-audio-prompt-controller.ts';
import { createToyCapabilityController } from './loader/toy-capability-controller.ts';
import { createToyLaunchController } from './loader/toy-launch-controller.ts';
import { createToyLifecycleOrchestration } from './loader/toy-lifecycle-orchestration.ts';
import { applyToyPostLaunchEffects } from './loader/toy-post-launch-controller.ts';
import { createToySessionController } from './loader/toy-session-controller.ts';
import { createRouter } from './router.ts';
import { createToyView } from './toy-view.ts';
import { createManifestClient } from './utils/manifest-client';

type Toy = ToyEntry;

const TOY_QUERY_PARAM = 'experience';

const TOY_MICRO_GOALS: Record<string, string[]> = {
  milkdrop: [
    'Start a preset, switch source or use autoplay, then confirm the shell stays responsive.',
  ],
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
  const { backToLibrary } = createLoaderLibraryResetController({
    removeEscapeHandler,
    disposeActiveToy,
    showLibraryView: () => view.showLibraryView(),
    goToLibrary: () => router.goToLibrary(),
    updateRendererStatus,
    resetAudioPool: resetAudioPoolFn,
    clearSessionOnBack: () => sessionController.clearOnBack(),
    setActiveToySlug: (slug) => {
      activeToySlug = slug;
    },
  });

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

  const disposeToyRecord = (
    record: ReturnType<typeof lifecycle.getActiveToy> | null,
  ) => {
    if (!record?.dispose) return;
    try {
      record.dispose();
    } catch (error) {
      console.error('Error disposing staged toy', error);
    }
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
    const outgoingToy = lifecycle.getActiveToy();
    const shouldBlend = Boolean(outgoingToy);
    const capabilityDecision = await capabilityController.assess({
      toy,
      initialCapabilities,
      forceRendererRetry,
    });

    const capabilities = capabilityDecision.capabilities;

    if (capabilityDecision.blockReason === 'rendering-unavailable') {
      if (shouldBlend) {
        view.cancelToyTransition?.();
      }
      return;
    }

    const handleNextToy = sessionController.createNextToyHandler({
      getCurrentSlug: () => activeToySlug ?? toy.slug,
      loadToy,
      preferDemoAudio,
    });

    if (!shouldBlend) {
      disposeActiveToy();
      removeEscapeHandler();
    }

    const viewOptions = {
      onNextToy: handleNextToy,
      onToggleHaptics: (active: boolean) =>
        sessionController.haptics.setHapticsEnabled(active),
      hapticsActive: sessionController.haptics.getHapticsEnabled(),
      hapticsSupported: sessionController.canUseHaptics(),
    };

    const container = shouldBlend
      ? view.showIncomingToyView?.(backToLibrary, toy, viewOptions)
      : view.showActiveToyView(backToLibrary, toy, viewOptions);
    if (!container) return;
    const refreshRendererStatus = () => {
      const preferredRendererAction =
        capabilityController.createPreferredRendererAction({
          capabilities,
          retry: capabilityController.createPreferredRendererRetry({
            toy,
            pushState,
            preferDemoAudio,
            startFlow: sessionController.isFlowActive(),
            startPartyMode: sessionController.isPartyModeActive(),
            loadToy,
            view,
          }),
        });

      updateRendererStatus(
        capabilities.preferredBackend ? capabilities : null,
        preferredRendererAction,
      );
      return preferredRendererAction;
    };

    const preferredRendererAction = refreshRendererStatus();

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
      const targetContainer = container;
      if (!targetContainer) return;

      const launchRequest: ToyLaunchRequest = {
        slug: toy.slug,
        container: targetContainer,
        audioPreference: preferDemoAudio ? 'demo' : 'microphone',
        forceRendererRetry,
      };
      const moduleResult = await launchController.launchToy({
        toy,
        request: launchRequest,
      });
      if (!moduleResult.ok) {
        if (shouldBlend) {
          view.cancelToyTransition?.();
          lifecycle.adoptActiveToy(outgoingToy?.ref);
        }
        console.error('Error loading toy module:', moduleResult.error);
        showModuleImportError(toy, {
          moduleUrl: moduleResult.moduleUrl,
          importError: moduleResult.error,
        });
        return;
      }

      const { launchResult } = moduleResult;
      const nextActiveToy =
        launchResult.instance ?? lifecycle.getActiveToy()?.ref;
      if (shouldBlend) {
        await view.completeToyTransition?.();
        disposeToyRecord(outgoingToy);
      }
      lifecycle.adoptActiveToy(nextActiveToy);

      view.removeStatusElement();

      applyToyPostLaunchEffects({
        toy,
        pushState,
        preferDemoAudio,
        launchResult,
        container,
        rememberToy: (slug) => sessionController.session.rememberToy(slug),
        setActiveToySlug: (slug) => {
          activeToySlug = slug;
        },
        showAudioPrompt: (args) => audioPromptController.maybeShowPrompt(args),
        starterTips: TOY_MICRO_GOALS[toy.slug],
      });
    };

    if (capabilityDecision.blockReason === 'webgpu-required') {
      view.showCapabilityError(toy, {
        onBack: backToLibrary,
        onBrowseCompatible: capabilityController.browseCompatibleToys,
        details: capabilities.fallbackReason,
        preferredRendererActionLabel: preferredRendererAction?.label,
        onUsePreferredRenderer: preferredRendererAction?.onClick,
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
