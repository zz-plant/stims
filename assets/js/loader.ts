import toysData from './toys-data.js';
import { createRouter } from './router.ts';
import { createToyView } from './toy-view.ts';
import { createManifestClient } from './utils/manifest-client.ts';
import { ensureWebGL } from './utils/webgl-check.ts';
import {
  describeRendererCapabilities,
  getRendererCapabilities,
  resetRendererCapabilities,
} from './core/renderer-capabilities.ts';
import {
  DEFAULT_QUALITY_PRESETS,
  getSettingsPanel,
  type QualityPreset,
} from './core/settings-panel.ts';

type Toy = {
  slug: string;
  title?: string;
  module: string;
  type: 'module' | 'page';
  requiresWebGPU?: boolean;
  allowWebGLFallback?: boolean;
};

const TOY_QUERY_PARAM = 'toy';

function disposeActiveToy(view?: ReturnType<typeof createToyView>) {
  const activeToy = (globalThis as typeof globalThis & { __activeWebToy?: { dispose?: () => void } }).__activeWebToy;

  if (activeToy?.dispose) {
    try {
      activeToy.dispose();
    } catch (error) {
      console.error('Error disposing existing toy', error);
    }
  }

  view?.clearActiveToyContainer();
  delete (globalThis as typeof globalThis & { __activeWebToy?: unknown }).__activeWebToy;
}

export function createLoader({
  manifestClient = createManifestClient(),
  router = createRouter({ queryParam: TOY_QUERY_PARAM }),
  view = createToyView(),
  ensureWebGLCheck = ensureWebGL,
  rendererCapabilities = getRendererCapabilities,
  settingsPanel = getSettingsPanel(),
  toys = toysData as Toy[],
}: {
  manifestClient?: ReturnType<typeof createManifestClient>;
  router?: ReturnType<typeof createRouter>;
  view?: ReturnType<typeof createToyView>;
  ensureWebGLCheck?: typeof ensureWebGL;
  rendererCapabilities?: typeof getRendererCapabilities;
  settingsPanel?: ReturnType<typeof getSettingsPanel>;
  toys?: Toy[];
} = {}) {
  let navigationInitialized = false;
  let currentQualityPreset: QualityPreset | null = null;
  let currentToySlug: string | null = null;

  const applyQualityPresetToActiveToy = (preset: QualityPreset | null) => {
    if (!preset) return;
    const activeToy = (globalThis as typeof globalThis & { __activeWebToy?: unknown }).__activeWebToy;
    if (!activeToy) return;

    if (typeof activeToy === 'object' && activeToy && 'setQualityPreset' in activeToy) {
      const setter = (activeToy as { setQualityPreset?: unknown }).setQualityPreset;
      if (typeof setter === 'function') {
        setter.call(activeToy, preset);
        return;
      }
    }

    if (typeof activeToy === 'object' && activeToy && 'updateRendererSettings' in activeToy) {
      const updater = (activeToy as { updateRendererSettings?: unknown }).updateRendererSettings;
      if (typeof updater === 'function') {
        updater.call(activeToy, {
          maxPixelRatio: preset.maxPixelRatio,
          renderScale: preset.renderScale,
        });
      }
      return;
    }
  };

  const handleQualityPresetChange = (preset: QualityPreset) => {
    currentQualityPreset = preset;
    applyQualityPresetToActiveToy(preset);
  };

  settingsPanel.onQualityPresetChange(handleQualityPresetChange);
  settingsPanel.setQualityPresets({ presets: DEFAULT_QUALITY_PRESETS });

  const renderRendererStatus = async (
    capabilities?: Awaited<ReturnType<typeof rendererCapabilities>>
  ) => {
    const resolvedCapabilities = capabilities ?? (await rendererCapabilities());
    if (!view.updateRendererStatus) return;

    view.updateRendererStatus(describeRendererCapabilities(resolvedCapabilities), {
      onRetry: resolvedCapabilities.shouldRetryWebGPU
        ? () => {
            if (!currentToySlug) return;
            resetRendererCapabilities();
            void loadToy(currentToySlug, { pushState: false });
          }
        : undefined,
    });
  };

  const backToLibrary = () => {
    disposeActiveToy(view);
    view.showLibraryView();
    router.goToLibrary();
    currentToySlug = null;
  };

  const startModuleToy = async (toy: Toy, pushState: boolean) => {
    const capabilities = await rendererCapabilities();

    const supportsRendering = ensureWebGLCheck({
      title: toy.title ? `${toy.title} needs graphics acceleration` : 'Graphics support required',
      description:
        'We could not detect WebGL or WebGPU support on this device. Try a modern browser with hardware acceleration enabled.',
    });

    if (!supportsRendering) {
      return;
    }

    disposeActiveToy(view);
    currentToySlug = toy.slug;

    const container = view.showActiveToyView(backToLibrary);
    if (!container) return;
    void renderRendererStatus(capabilities);

    let navigated = false;
    const commitNavigation = () => {
      if (pushState && !navigated) {
        router.pushToyState(toy.slug);
        navigated = true;
      }
    };

    const runToy = async () => {
      commitNavigation();
      view.showLoadingIndicator(toy.title || toy.slug);

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

      const presetForToy = currentQualityPreset ?? settingsPanel.getSelectedQualityPreset();
      const particleScale = presetForToy?.particleScale ?? 1;

      if (starter) {
        try {
          const active = await starter({
            container,
            slug: toy.slug,
            qualityPreset: presetForToy,
            particleScale,
          });
          if (active && !(globalThis as { __activeWebToy?: unknown }).__activeWebToy) {
            (globalThis as { __activeWebToy?: unknown }).__activeWebToy = active;
          }
          applyQualityPresetToActiveToy(presetForToy);
        } catch (error) {
          console.error('Error starting toy module:', error);
          view.showImportError(toy, { moduleUrl, importError: error as Error, onBack: backToLibrary });
          return;
        }
      }

      view.removeStatusElement();
      void renderRendererStatus();
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

  const loadToy = async (slug: string, { pushState = false }: { pushState?: boolean } = {}) => {
    const toy = toys.find((t) => t.slug === slug);
    if (!toy) {
      console.error(`Toy not found: ${slug}`);
      backToLibrary();
      return;
    }
    currentToySlug = slug;

    if (toy.type === 'module') {
      await startModuleToy(toy, pushState);
      return;
    }

    disposeActiveToy(view);

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
