import toysData from './toys-data.js';
import { createRouter } from './router.ts';
import { createToyView } from './toy-view.ts';
import { createManifestClient } from './utils/manifest-client.ts';
import { ensureWebGL } from './utils/webgl-check.ts';
import { getRendererCapabilities } from './core/renderer-capabilities.ts';
import { prewarmRendererCapabilities } from './core/services/render-service.ts';
import {
  prewarmMicrophone,
  resetAudioPool,
} from './core/services/audio-service.ts';
import {
  defaultToyLifecycle,
  type ToyLifecycle,
} from './core/toy-lifecycle.ts';

type Toy = {
  slug: string;
  title?: string;
  module: string;
  type: 'module' | 'page';
  requiresWebGPU?: boolean;
  allowWebGLFallback?: boolean;
};

const TOY_QUERY_PARAM = 'toy';

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
  const updateRendererStatus = (
    capabilities: Awaited<ReturnType<typeof rendererCapabilities>> | null,
    onRetry?: () => void
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
        : null
    );
  };

  const showModuleImportError = (
    toy: Toy,
    { moduleUrl, importError }: { moduleUrl?: string; importError: Error }
  ) => {
    view.showImportError(toy, {
      moduleUrl,
      importError,
      onBack: backToLibrary,
    });
  };

  const resolveToyModuleUrl = async (toy: Toy) => {
    try {
      return await manifestClient.resolveModulePath(toy.module);
    } catch (error) {
      console.error('Error resolving module path:', error);
      showModuleImportError(toy, { importError: error as Error });
      return null;
    }
  };

  const importToyModule = async (toy: Toy, moduleUrl: string) => {
    try {
      return await import(moduleUrl);
    } catch (error) {
      console.error('Error loading toy module:', error);
      showModuleImportError(toy, {
        moduleUrl,
        importError: error as Error,
      });
      return null;
    }
  };

  const disposeActiveToy = () => {
    lifecycle.disposeActiveToy();
    view?.clearActiveToyContainer?.();
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
    initialCapabilities?: Awaited<ReturnType<typeof rendererCapabilities>>
  ) => {
    void prewarmRendererCapabilitiesFn();
    void prewarmMicrophoneFn();
    let capabilities = initialCapabilities ?? (await rendererCapabilities());

    const supportsRendering = ensureWebGLCheck({
      title: toy.title
        ? `${toy.title} needs graphics acceleration`
        : 'Graphics support required',
      description:
        'We could not detect WebGL or WebGPU support on this device. Try a modern browser with hardware acceleration enabled.',
    });

    if (!supportsRendering) {
      return;
    }

    disposeActiveToy();
    removeEscapeHandler();

    const container = view.showActiveToyView(backToLibrary, toy);
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
              await startModuleToy(toy, false, capabilities);
            }
          }
        : undefined
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

      const moduleUrl = await resolveToyModuleUrl(toy);
      if (!moduleUrl) return;

      const moduleExports = await importToyModule(toy, moduleUrl);
      if (!moduleExports) return;

      const startCandidate =
        (moduleExports as { start?: unknown })?.start ??
        (moduleExports as { default?: { start?: unknown } })?.default?.start;
      const starter =
        typeof startCandidate === 'function' ? startCandidate : null;

      if (starter) {
        try {
          const active = await starter({ container, slug: toy.slug });
          lifecycle.adoptActiveToy(active ?? lifecycle.getActiveToy()?.ref);
        } catch (error) {
          console.error('Error starting toy module:', error);
          showModuleImportError(toy, {
            moduleUrl,
            importError: error as Error,
          });
          return;
        }
      }

      view.removeStatusElement();
    };

    if (toy.requiresWebGPU && capabilities.preferredBackend !== 'webgpu') {
      view.showCapabilityError(toy, {
        allowFallback: toy.allowWebGLFallback,
        onBack: backToLibrary,
        details: capabilities.fallbackReason,
        onContinue: toy.allowWebGLFallback
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
    { pushState = false }: { pushState?: boolean } = {}
  ) => {
    const toy = toys.find((t) => t.slug === slug);
    if (!toy) {
      console.error(`Toy not found: ${slug}`);
      view.showUnavailableToy?.(slug, { onBack: backToLibrary });
      return;
    }

    if (toy.type === 'module') {
      await startModuleToy(toy, pushState);
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
