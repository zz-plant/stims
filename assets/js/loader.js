import toysData from './toys-data.js';
import { ensureWebGL } from './utils/webgl-check.js';
import { createManifestClient } from './core/manifest.ts';
import { createRouter } from './core/router.ts';
import { createToyView } from './core/view.ts';

const TOY_QUERY_PARAM = 'toy';

function getDocument() {
  return typeof document === 'undefined' ? null : document;
}

function getWindow() {
  return typeof window === 'undefined' ? null : window;
}

function hasWebGPUSupport(win = getWindow()) {
  return Boolean(win?.navigator && 'gpu' in win.navigator);
}

function createLifecycleManager(globalObject = globalThis) {
  return {
    getActiveToy() {
      return globalObject.__activeWebToy;
    },
    setActiveToy(activeToy) {
      globalObject.__activeWebToy = activeToy;
    },
    disposeActiveToy() {
      const activeToy = globalObject.__activeWebToy;

      if (activeToy?.dispose) {
        try {
          activeToy.dispose();
        } catch (error) {
          console.error('Error disposing existing toy', error);
        }
      }

      delete globalObject.__activeWebToy;
    },
  };
}

export function createLoader({
  toys = toysData,
  manifestClient = createManifestClient(),
  window: win = getWindow(),
  document: doc = getDocument(),
  host = doc?.body ?? null,
  ensureWebGLCheck = ensureWebGL,
  globalObject = globalThis,
  toyList = doc?.getElementById('toy-list') ?? null,
} = {}) {
  const lifecycle = createLifecycleManager(globalObject);
  let router;

  const view = createToyView({
    document: doc,
    window: win,
    host,
    toyList,
    onBackToLibrary: () => {
      lifecycle.disposeActiveToy();
      view.clearActiveToyContainer();
      view.showLibraryView();
      router?.updateHistoryToLibraryView();
    },
  });

  let loadToyRef;
  router = createRouter({
    window: win,
    queryParam: TOY_QUERY_PARAM,
    loadToy: async (slug) => loadToyRef?.(slug),
    onLibraryRoute: () => {
      lifecycle.disposeActiveToy();
      view.clearActiveToyContainer();
      view.showLibraryView();
    },
  });

  const loadToy = (loadToyRef = async (slug, { pushState = false } = {}) => {
    const toy = toys.find((t) => t.slug === slug);
    if (!toy) {
      console.error(`Toy not found: ${slug}`);
      view.showLibraryView();
      lifecycle.disposeActiveToy();
      view.clearActiveToyContainer();
      return;
    }

    if (toy.type === 'module') {
      const supportsRendering = ensureWebGLCheck({
        title: toy.title ? `${toy.title} needs graphics acceleration` : 'Graphics support required',
        description:
          'We could not detect WebGL or WebGPU support on this device. Try a modern browser with hardware acceleration enabled.',
      });

      if (!supportsRendering) {
        return;
      }

      if (pushState) {
        router?.pushToyState(slug);
      }

      lifecycle.disposeActiveToy();
      view.clearActiveToyContainer();
      const container = view.showActiveToyView();

      if (toy.requiresWebGPU && !hasWebGPUSupport(win)) {
        view.showCapabilityError(toy);
        return;
      }

      view.showLoadingIndicator(toy.title || toy.slug);

      const moduleUrl = await manifestClient.resolveModulePath(toy.module);
      let moduleExports = null;

      try {
        moduleExports = await import(moduleUrl);
      } catch (error) {
        console.error('Error loading toy module:', error);
        view.showImportError(toy, { moduleUrl, importError: error });
        return;
      }

      const starter = moduleExports?.start ?? moduleExports?.default?.start;

      if (starter) {
        try {
          const active = await starter({ container, slug });
          if (active && !lifecycle.getActiveToy()) {
            lifecycle.setActiveToy(active);
          }
        } catch (error) {
          console.error('Error starting toy module:', error);
          view.showImportError(toy);
          return;
        }
      }

      view.removeStatusElement();
      return;
    }

    lifecycle.disposeActiveToy();
    view.clearActiveToyContainer();
    if (win?.location) {
      win.location.href = toy.module;
    } else if (globalObject.location) {
      globalObject.location.href = toy.module;
    }
  });

  return {
    loadToy,
    loadFromQuery: router.loadFromQuery,
    pushToyState: router.pushToyState,
    initNavigation: router.initNavigation,
    updateHistoryToLibraryView: router.updateHistoryToLibraryView,
    disposeActiveToy: lifecycle.disposeActiveToy,
    resolveModulePath: manifestClient.resolveModulePath,
    fetchManifest: manifestClient.fetchManifest,
  };
}

const defaultLoader = createLoader();

export const loadToy = defaultLoader.loadToy;
export const loadFromQuery = defaultLoader.loadFromQuery;
export const initNavigation = defaultLoader.initNavigation;
export const pushToyState = defaultLoader.pushToyState;
export const resolveModulePath = defaultLoader.resolveModulePath;
export const fetchManifest = defaultLoader.fetchManifest;
