import { setAudioActive, setCurrentToy } from './core/agent-api.ts';
import { getRendererCapabilities } from './core/renderer-capabilities.ts';
import {
  prewarmMicrophone,
  resetAudioPool,
} from './core/services/audio-service.ts';
import { prewarmRendererCapabilities } from './core/services/render-service.ts';

import { assessToyCapabilities } from './core/toy-capabilities.ts';
import type { ToyWindow } from './core/toy-globals';
import {
  defaultToyLifecycle,
  type ToyLifecycle,
} from './core/toy-lifecycle.ts';
import { createRouter } from './router.ts';
import { createToyView } from './toy-view.ts';
import toysData from './toys-data.js';
import { createManifestClient } from './utils/manifest-client.ts';
import { resetToyPictureInPicture } from './utils/picture-in-picture.ts';
import { loadToyModuleStarter } from './utils/toy-module-loader.ts';
import { ensureWebGL } from './utils/webgl-check.ts';

type Toy = {
  slug: string;
  title?: string;
  module: string;
  type: 'module' | 'page';
  requiresWebGPU?: boolean;
  allowWebGLFallback?: boolean;
};

const TOY_QUERY_PARAM = 'toy';
const STARTER_POLL_DELAY_MS = 100;
const STARTER_POLL_ATTEMPTS = 30;

const waitForAudioStarter = async (
  getStarter: () => ToyWindow['startAudio'] | ToyWindow['startAudioFallback'],
  errorMessage: string,
) => {
  let starter = getStarter();
  if (typeof starter !== 'function') {
    for (let i = 0; i < STARTER_POLL_ATTEMPTS; i++) {
      await new Promise((resolve) =>
        setTimeout(resolve, STARTER_POLL_DELAY_MS),
      );
      starter = getStarter();
      if (typeof starter === 'function') {
        break;
      }
    }
  }

  if (typeof starter !== 'function') {
    throw new Error(errorMessage);
  }

  return starter;
};

// createLoader orchestrates routing/navigation, renderer capability checks,
// module resolution/import, view updates, and lifecycle management.
export function createLoader({
  manifestClient = createManifestClient(),
  router = createRouter({ queryParam: TOY_QUERY_PARAM }),
  view = createToyView(),
  ensureWebGLCheck = ensureWebGL,
  rendererCapabilities = getRendererCapabilities,
  toys = toysData as Toy[],
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

  const backToLibrary = () => {
    removeEscapeHandler();
    disposeActiveToy();
    view.showLibraryView();
    router.goToLibrary();
    updateRendererStatus(null);
    void resetAudioPoolFn({ stopStreams: true });
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

    const handleNextToy = () => {
      const nextSlug = pickNextToySlug(toy.slug);
      if (!nextSlug) return;
      void loadToy(nextSlug, { pushState: true, preferDemoAudio });
    };

    const container = view.showActiveToyView(backToLibrary, toy, {
      onNextToy: handleNextToy,
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
      rememberToy(toy.slug);

      // Setup audio prompt if startAudio globals are registered by the toy.
      const win = (container?.ownerDocument.defaultView ??
        window) as unknown as ToyWindow;
      const setupAudioPrompt = async () => {
        try {
          await waitForAudioStarter(
            () => win.startAudioFallback ?? win.startAudio,
            'Audio starter unavailable.',
          );
        } catch (_error) {
          return;
        }

        let lastAudioSource: 'microphone' | 'demo' = 'microphone';

        view.showAudioPrompt(true, {
          preferDemoAudio,
          onRequestMicrophone: async () => {
            lastAudioSource = 'microphone';
            const starter = await waitForAudioStarter(
              () => win.startAudio,
              'Microphone starter unavailable.',
            );
            await starter('microphone');
          },
          onRequestDemoAudio: async () => {
            lastAudioSource = 'demo';
            const fallbackStarter = await waitForAudioStarter(
              () => win.startAudioFallback ?? win.startAudio,
              'Demo audio unavailable.',
            );
            if (typeof win.startAudioFallback === 'function') {
              await win.startAudioFallback();
              return;
            }
            await fallbackStarter('sample');
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
    }: { pushState?: boolean; preferDemoAudio?: boolean } = {},
  ) => {
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

  const loadFromQuery = async () => {
    const slug = router.getCurrentSlug();
    if (slug) {
      await loadToy(slug);
    } else {
      backToLibrary();
    }
  };

  const initNavigation = () => {
    if (navigationInitialized) return;

    navigationInitialized = true;
    router.listen((slug) => {
      if (slug) {
        void loadToy(slug);
      } else {
        backToLibrary();
      }
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
