import { createRouter } from './router.ts';
import { createToyView } from './toy-view.ts';
import { createManifestClient } from './utils/manifest-client.ts';
import { ensureWebGL } from './utils/webgl-check.ts';
import toysData, { type ValidatedToyEntry } from './toys-metadata.ts';
import { evaluateCapabilityPolicy } from './utils/toy-schema.ts';
import { getRendererCapabilities } from './core/renderer-capabilities.ts';

const TOY_QUERY_PARAM = 'toy';
type ActiveToyCandidate = { dispose?: () => void } | (() => void);

export function createLoader({
  manifestClient = createManifestClient(),
  router = createRouter({ queryParam: TOY_QUERY_PARAM }),
  view = createToyView(),
  ensureWebGLCheck = ensureWebGL,
  rendererCapabilities = getRendererCapabilities,
  toys = toysData,
}: {
  manifestClient?: ReturnType<typeof createManifestClient>;
  router?: ReturnType<typeof createRouter>;
  view?: ReturnType<typeof createToyView>;
  ensureWebGLCheck?: typeof ensureWebGL;
  rendererCapabilities?: typeof getRendererCapabilities;
  toys?: ValidatedToyEntry[];
  } = {}) {
  let navigationInitialized = false;
  let escapeHandler: ((event: KeyboardEvent) => void) | null = null;
  let activeToy: { ref: ActiveToyCandidate; dispose?: () => void } | null = null;
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

  const getGlobalActiveToy = () =>
    (globalThis as typeof globalThis & { __activeWebToy?: ActiveToyCandidate }).__activeWebToy;

  const normalizeActiveToy = (
    candidate: unknown
  ): { ref: ActiveToyCandidate; dispose?: () => void } | null => {
    if (!candidate) return null;

    if (typeof candidate === 'function') {
      return { ref: candidate, dispose: candidate };
    }

    if (typeof candidate === 'object') {
      const dispose = (candidate as { dispose?: unknown }).dispose;
      return {
        ref: candidate as ActiveToyCandidate,
        dispose: typeof dispose === 'function' ? dispose.bind(candidate) : undefined,
      };
    }

    return null;
  };

  const registerActiveToy = (candidate?: unknown) => {
    const source = candidate === null ? null : candidate ?? getGlobalActiveToy();
    activeToy = normalizeActiveToy(source);

    if (activeToy?.ref) {
      (globalThis as typeof globalThis & { __activeWebToy?: ActiveToyCandidate }).__activeWebToy =
        activeToy.ref;
    } else {
      delete (globalThis as typeof globalThis & { __activeWebToy?: ActiveToyCandidate }).__activeWebToy;
    }

    return activeToy;
  };

  const disposeActiveToy = () => {
    const current = activeToy ?? normalizeActiveToy(getGlobalActiveToy());

    if (current?.dispose) {
      try {
        current.dispose();
      } catch (error) {
        console.error('Error disposing existing toy', error);
      }
    }

    registerActiveToy(null);
    view?.clearActiveToyContainer?.();
  };

  const removeEscapeHandler = () => {
    const win = typeof window === 'undefined' ? null : window;
    if (!win || !escapeHandler) return;

    win.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
  };

  const backToLibrary = () => {
    removeEscapeHandler();
    disposeActiveToy();
    view.showLibraryView();
    router.goToLibrary();
    updateRendererStatus(null);
  };

  const registerEscapeHandler = () => {
    const win = typeof window === 'undefined' ? null : window;
    if (!win || escapeHandler) return;

    escapeHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        backToLibrary();
      }
    };

    win.addEventListener('keydown', escapeHandler);
  };

  const startModuleToy = async (
    toy: ValidatedToyEntry,
    pushState: boolean,
    initialCapabilities?: Awaited<ReturnType<typeof rendererCapabilities>>
  ) => {
    let capabilities = initialCapabilities ?? (await rendererCapabilities());

    const supportsRendering = ensureWebGLCheck({
      title: toy.title ? `${toy.title} needs graphics acceleration` : 'Graphics support required',
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
    updateRendererStatus(capabilities, capabilities.shouldRetryWebGPU
      ? async () => {
          capabilities = await rendererCapabilities({ forceRetry: true });
          updateRendererStatus(capabilities);
          if (capabilities.preferredBackend === 'webgpu') {
            disposeActiveToy();
            view.clearActiveToyContainer?.();
            await startModuleToy(toy, false, capabilities);
          }
        }
      : undefined);

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

      let moduleUrl: string;
      try {
        moduleUrl = await manifestClient.resolveModulePath(toy.module);
      } catch (error) {
        console.error('Error resolving module path:', error);
        view.showImportError(toy, { importError: error as Error, onBack: backToLibrary });
        return;
      }

      let moduleExports: unknown;

      try {
        moduleExports = await import(moduleUrl);
      } catch (error) {
        console.error('Error loading toy module:', error);
        view.showImportError(toy, { moduleUrl, importError: error as Error, onBack: backToLibrary });
        return;
      }

      const startCandidate =
        (moduleExports as { start?: unknown })?.start ??
        (moduleExports as { default?: { start?: unknown } })?.default?.start;
      const starter = typeof startCandidate === 'function' ? startCandidate : null;

      if (starter) {
        try {
          const active = await starter({ container, slug: toy.slug });
          registerActiveToy(active ?? getGlobalActiveToy());
        } catch (error) {
          console.error('Error starting toy module:', error);
          view.showImportError(toy, { moduleUrl, importError: error as Error, onBack: backToLibrary });
          return;
        }
      }

      view.removeStatusElement();
    };

    const capabilityDecision = evaluateCapabilityPolicy(toy.capabilityPolicy, capabilities);
    if (capabilityDecision.status !== 'ok') {
      view.showCapabilityError(toy, {
        allowFallback: capabilityDecision.policy.allowWebGLFallback,
        onBack: backToLibrary,
        fallbackReason: capabilityDecision.fallbackReason,
        onContinue:
          capabilityDecision.status === 'warn'
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

  const loadToy = async (slug: string, { pushState = false }: { pushState?: boolean } = {}) => {
    const toy = toys.find((t) => t.slug === slug);
    if (!toy) {
      console.error(`Toy not found: ${slug}`);
      backToLibrary();
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
