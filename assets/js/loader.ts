import { setAudioActive, setCurrentToy } from './core/agent-api.ts';
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
import { createRouter, type Route } from './router.ts';
import { createToyView } from './toy-view.ts';
import { recordToyOpen } from './utils/growth-metrics.ts';
import { createManifestClient } from './utils/manifest-client';
import { applyPartyMode } from './utils/party-mode';
import { resetToyPictureInPicture } from './utils/picture-in-picture';
import { loadToyModuleStarter } from './utils/toy-module-loader';
import { ensureWebGL } from './utils/webgl-check';

type Toy = ToyEntry;

const TOY_QUERY_PARAM = 'toy';
const LIBRARY_FILTER_PARAM = 'filters';
const COMPATIBILITY_MODE_KEY = 'stims-compatibility-mode';
const FLOW_WARMUP_INTERVAL_MS = 60000;
const FLOW_ENGAGED_INTERVAL_MS = 90000;
const FLOW_IDLE_INTERVAL_MS = 120000;
const FLOW_ENGAGEMENT_WINDOW_MS = 2 * 60 * 1000;
const HAPTICS_STORAGE_KEY = 'stims:haptics-enabled';
const TOY_MICRO_GOALS: Record<string, string[]> = {
  holy: ['Boost intensity, then settle into a calmer palette.'],
  'bubble-harmonics': [
    'Find a high-frequency moment and trigger a bubble split.',
  ],
  'spiral-burst': ['Make the pulse feel synced to your beat for 10 seconds.'],
  'aurora-painter': ['Draw one smooth ribbon, then thicken it with density.'],
  geom: ['Test quiet vs loud input and watch the shape response.'],
};

export function getFlowIntervalMs({
  cycleCount,
  lastInteractionAt,
  now = Date.now(),
}: {
  cycleCount: number;
  lastInteractionAt: number;
  now?: number;
}) {
  if (cycleCount < 1) {
    return FLOW_WARMUP_INTERVAL_MS;
  }

  if (now - lastInteractionAt <= FLOW_ENGAGEMENT_WINDOW_MS) {
    return FLOW_ENGAGED_INTERVAL_MS;
  }

  return FLOW_IDLE_INTERVAL_MS;
}

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
  const recentToySlugs: string[] = [];
  let flowActive = false;
  let partyModeActive = false;
  let hapticsEnabled = false;
  let beatHapticsCleanup: (() => void) | null = null;
  let flowTimer: number | null = null;
  let flowCycleCount = 0;
  let lastInteractionAt = Date.now();
  let interactionTrackingInitialized = false;
  let activeToySlug: string | null = null;
  let nextToyInFlight = false;
  let handleNextToy: ((fromFlow?: boolean) => Promise<void>) | null = null;

  const clearFlowTimer = () => {
    if (flowTimer === null) return;
    const win = typeof window !== 'undefined' ? window : null;
    if (win) {
      win.clearTimeout(flowTimer);
    }
    flowTimer = null;
  };

  const clearBeatHapticsListener = () => {
    beatHapticsCleanup?.();
    beatHapticsCleanup = null;
  };

  const canUseHaptics = () => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return false;
    }
    const supportsVibration = typeof navigator.vibrate === 'function';
    return (
      supportsVibration && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
    );
  };

  const pulseHaptics = (intensity: number = 0.4) => {
    if (!hapticsEnabled || !canUseHaptics() || !navigator.vibrate) {
      return;
    }
    if (typeof document !== 'undefined') {
      const audioActive = document.body.dataset.audioActive === 'true';
      if (!audioActive) return;
    }
    const clampedIntensity = Math.max(0, Math.min(1, intensity));
    const duration = Math.round(10 + clampedIntensity * 18);
    navigator.vibrate(partyModeActive ? [duration, 28, duration] : [duration]);
  };

  const syncBeatHapticsListener = () => {
    clearBeatHapticsListener();
    if (!hapticsEnabled || !canUseHaptics() || typeof window === 'undefined') {
      return;
    }

    const onBeat = (event: Event) => {
      const detail = (event as CustomEvent<{ intensity?: number }>).detail;
      pulseHaptics(detail?.intensity ?? 0.4);
    };

    window.addEventListener('stims:audio-beat', onBeat as EventListener);
    beatHapticsCleanup = () => {
      window.removeEventListener('stims:audio-beat', onBeat as EventListener);
    };
  };

  const persistHaptics = (enabled: boolean) => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        HAPTICS_STORAGE_KEY,
        enabled ? 'true' : 'false',
      );
    } catch (_error) {
      // Ignore storage access issues.
    }
  };

  const readPersistedHaptics = () => {
    if (typeof window === 'undefined') return false;
    try {
      return window.localStorage.getItem(HAPTICS_STORAGE_KEY) === 'true';
    } catch (_error) {
      return false;
    }
  };

  const markInteraction = () => {
    lastInteractionAt = Date.now();
  };

  const initInteractionTracking = () => {
    if (interactionTrackingInitialized || typeof window === 'undefined') return;
    interactionTrackingInitialized = true;
    const interactionEvents: (keyof WindowEventMap)[] = [
      'pointerdown',
      'keydown',
      'touchstart',
    ];
    interactionEvents.forEach((eventName) => {
      window.addEventListener(eventName, markInteraction, { passive: true });
    });
  };

  const rememberToy = (slug: string) => {
    if (!slug) return;
    const existingIndex = recentToySlugs.indexOf(slug);
    if (existingIndex === 0) return;
    if (existingIndex > -1) {
      recentToySlugs.splice(existingIndex, 1);
    }
    recentToySlugs.unshift(slug);
    if (recentToySlugs.length > 4) {
      recentToySlugs.pop();
    }
  };

  const pickNextToySlug = (currentSlug?: string | null) => {
    const available = toys.filter((toy) => toy.type === 'module');
    if (!available.length) return null;

    const avoid = new Set(recentToySlugs);
    if (currentSlug) {
      avoid.add(currentSlug);
    }
    const fresh = available.filter((toy) => !avoid.has(toy.slug));
    const fallback = available.filter((toy) => toy.slug !== currentSlug);
    const pool = fresh.length ? fresh : fallback.length ? fallback : available;
    if (!pool.length) return null;

    const choice = pool[Math.floor(Math.random() * pool.length)];
    return choice?.slug ?? null;
  };

  const scheduleFlow = () => {
    clearFlowTimer();
    if (!flowActive) return;
    const win = typeof window !== 'undefined' ? window : null;
    if (!win) return;
    const delay = getFlowIntervalMs({
      cycleCount: flowCycleCount,
      lastInteractionAt,
    });
    flowTimer = win.setTimeout(() => {
      if (handleNextToy) {
        void handleNextToy(true);
      }
    }, delay);
  };

  const setFlowActive = (active: boolean) => {
    flowActive = active;
    if (!flowActive) {
      flowCycleCount = 0;
      clearFlowTimer();
      return;
    }
    markInteraction();
    flowCycleCount = 0;
    scheduleFlow();
  };

  const setPartyModeActive = (active: boolean) => {
    partyModeActive = active;
    applyPartyMode({ enabled: active });
  };

  const setHapticsEnabled = (enabled: boolean) => {
    const nextEnabled = enabled && canUseHaptics();
    hapticsEnabled = nextEnabled;
    view?.setHapticsState?.(nextEnabled);
    persistHaptics(nextEnabled);
    if (!nextEnabled && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(0);
    }
    syncBeatHapticsListener();
  };
  const updateRendererStatus = (
    capabilities: Awaited<ReturnType<typeof rendererCapabilities>> | null,
    onRetry?: () => void,
  ) => {
    view?.setRendererStatus?.(
      capabilities
        ? {
            backend: capabilities.preferredBackend,
            fallbackReason: capabilities.fallbackReason,
            shouldRetryWebGPU: capabilities.shouldRetryWebGPU,
            triedWebGPU: capabilities.triedWebGPU,
            onRetry,
          }
        : null,
    );
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

  const disposeActiveToy = () => {
    if (typeof document !== 'undefined') {
      resetToyPictureInPicture(document);
    }
    lifecycle.disposeActiveToy();
    view?.clearActiveToyContainer?.();
    setCurrentToy(null);
    setAudioActive(false);
  };

  const removeEscapeHandler = () => lifecycle.removeEscapeHandler();

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
    clearBeatHapticsListener();
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

  const registerEscapeHandler = () => {
    lifecycle.attachEscapeHandler(backToLibrary);
  };

  const startModuleToy = async (
    toy: Toy,
    pushState: boolean,
    preferDemoAudio: boolean,
    initialCapabilities?: Awaited<ReturnType<typeof rendererCapabilities>>,
  ) => {
    void prewarmRendererCapabilitiesFn();
    void prewarmMicrophoneFn();
    const capabilityDecision = await assessToyCapabilities({
      toy,
      rendererCapabilities,
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
      const nextSlug = pickNextToySlug(currentSlug);
      if (!nextSlug) {
        if (fromFlow) {
          setFlowActive(false);
        }
        return;
      }
      nextToyInFlight = true;
      clearFlowTimer();
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
      onToggleHaptics: (active) => setHapticsEnabled(active),
      hapticsActive: hapticsEnabled,
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

    registerEscapeHandler();

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
      rememberToy(toy.slug);
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
      view.showCapabilityError(toy, {
        allowFallback: capabilityDecision.allowWebGLFallback,
        onBack: backToLibrary,
        onBrowseCompatible: browseCompatibleToys,
        details: capabilities.fallbackReason,
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
    }: {
      pushState?: boolean;
      preferDemoAudio?: boolean;
      startFlow?: boolean;
      startPartyMode?: boolean;
    } = {},
  ) => {
    initInteractionTracking();

    if (canUseHaptics() && !hapticsEnabled) {
      hapticsEnabled = readPersistedHaptics();
    }

    if (typeof startFlow === 'boolean') {
      setFlowActive(startFlow);
    }

    if (typeof startPartyMode === 'boolean') {
      setPartyModeActive(startPartyMode);
    }

    syncBeatHapticsListener();

    const toy = toys.find((t) => t.slug === slug);
    if (!toy) {
      console.error(`Toy not found: ${slug}`);
      view.showUnavailableToy?.(slug, { onBack: backToLibrary });
      return;
    }

    if (toy.type === 'module') {
      await startModuleToy(toy, pushState, preferDemoAudio);
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
    initInteractionTracking();
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
