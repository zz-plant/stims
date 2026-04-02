import type * as THREE from 'three';
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three';
import {
  getRendererCapabilities,
  type RendererBackend,
  type RendererCapabilities,
  rememberRendererFallback,
} from '../renderer-capabilities.ts';
import { shouldPreferWebGLForKnownCompatibilityGaps } from '../renderer-query-override.ts';
import {
  applyRendererSettings,
  DEFAULT_RENDERER_RUNTIME_CONTROLS,
  type RendererRuntimeControlOverrides,
  type RendererRuntimeControls,
  type RendererViewport,
  resolveRendererRuntimeControls,
  resolveRendererSettings,
} from '../renderer-settings.ts';
import {
  initRenderer,
  type RendererInitConfig,
  type RendererInitResult,
} from '../renderer-setup.ts';
import { createSharedInitializer } from '../shared-initializer.ts';
import {
  getActiveQualityPreset,
  type QualityPreset,
  subscribeToQualityPreset,
} from '../state/quality-preset-store.ts';
import {
  getActiveRenderPreferences,
  subscribeToRenderPreferences,
} from '../state/render-preference-store.ts';
import type { WebGPURenderer } from '../webgpu-renderer.ts';

type RendererInstance = THREE.WebGLRenderer | WebGPURenderer;

export type RendererHandle = {
  renderer: RendererInstance;
  backend: RendererBackend;
  info: RendererInitResult;
  canvas: HTMLCanvasElement;
  getRuntimeControls: () => RendererRuntimeControls;
  applySettings: (
    options?: Partial<RendererInitConfig>,
    viewport?: RendererViewport,
  ) => void;
  release: () => void;
};

type RendererPoolEntry = {
  handle: RendererHandle;
  inUse: boolean;
};

const rendererPool: RendererPoolEntry[] = [];
let activeQuality: QualityPreset = getActiveQualityPreset();
let activeRenderPreferences = getActiveRenderPreferences();
let activeRuntimeControls: RendererRuntimeControls =
  DEFAULT_RENDERER_RUNTIME_CONTROLS;
const runtimeControlSubscribers = new Set<
  (controls: RendererRuntimeControls) => void
>();
const rendererCapabilitiesInitializer =
  createSharedInitializer<RendererCapabilities>(() =>
    getRendererCapabilities({
      preferWebGLForKnownCompatibilityGaps:
        shouldPreferWebGLForKnownCompatibilityGaps(),
    }),
  );

function getRenderDefaults(): Partial<RendererInitConfig> {
  return {
    maxPixelRatio:
      activeRenderPreferences.maxPixelRatio ?? activeQuality.maxPixelRatio,
    renderScale:
      activeRuntimeControls.renderScale *
      (activeRenderPreferences.renderScale ?? activeQuality.renderScale ?? 1),
  };
}

function forEachActiveRenderer(update: (entry: RendererPoolEntry) => void) {
  for (const entry of rendererPool) {
    if (!entry.inUse) {
      continue;
    }
    update(entry);
  }
}

subscribeToQualityPreset((preset) => {
  activeQuality = preset;
  forEachActiveRenderer((entry) => entry.handle.applySettings());
});

subscribeToRenderPreferences((preferences) => {
  activeRenderPreferences = preferences;
  forEachActiveRenderer((entry) => entry.handle.applySettings());
});

function buildSettings(
  options: Partial<RendererInitConfig> = {},
  info?: RendererInitResult | null,
): RendererInitConfig {
  return resolveRendererSettings(options, info, getRenderDefaults());
}

function applyPoolSettings(
  renderer: RendererInstance,
  info: RendererInitResult,
  options: Partial<RendererInitConfig> = {},
  viewport?: RendererViewport,
) {
  applyRendererSettings(renderer, info, options, getRenderDefaults(), viewport);
}

function applyRendererOverrides(
  renderer: RendererInstance,
  overrides: Map<PropertyKey, unknown>,
) {
  overrides.forEach((value, key) => {
    Reflect.set(renderer as object, key, value);
  });
}

function createWebGpuRendererFacade({
  getRenderer,
  recreateRenderer,
}: {
  getRenderer: () => RendererInstance;
  recreateRenderer: () => Promise<void>;
}) {
  let animationLoop: (() => void) | null = null;
  let animationFrameId: number | null = null;
  const overrides = new Map<PropertyKey, unknown>();

  const cancelScheduledFrame = () => {
    if (animationFrameId === null) {
      return;
    }
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  };

  const scheduleNextFrame = () => {
    if (!animationLoop) {
      animationFrameId = null;
      return;
    }

    animationFrameId = requestAnimationFrame(() => {
      const callback = animationLoop;
      if (!callback) {
        animationFrameId = null;
        return;
      }

      void recreateRenderer()
        .then(() => {
          if (animationLoop === callback) {
            callback();
          }
        })
        .catch((error) => {
          console.warn('WebGPU renderer refresh failed.', error);
        })
        .finally(() => {
          if (animationLoop === callback) {
            scheduleNextFrame();
          } else {
            animationFrameId = null;
          }
        });
    });
  };

  const renderer = new Proxy({} as RendererInstance, {
    get: (_target, property) => {
      if (property === 'setAnimationLoop') {
        return (callback: (() => void) | null) => {
          animationLoop = callback;
          getRenderer().setAnimationLoop?.(null);
          cancelScheduledFrame();
          if (callback) {
            scheduleNextFrame();
          }
        };
      }

      if (property === 'dispose') {
        return () => {
          animationLoop = null;
          cancelScheduledFrame();
          getRenderer().dispose?.();
        };
      }

      const value = Reflect.get(getRenderer() as object, property);
      return typeof value === 'function' ? value.bind(getRenderer()) : value;
    },
    set: (_target, property, value) => {
      overrides.set(property, value);
      Reflect.set(getRenderer() as object, property, value);
      return true;
    },
  });

  return {
    renderer,
    applyOverrides: (nextRenderer: RendererInstance) =>
      applyRendererOverrides(nextRenderer, overrides),
    stopAnimationLoop: () => {
      animationLoop = null;
      cancelScheduledFrame();
      getRenderer().setAnimationLoop?.(null);
    },
  };
}

async function createRendererHandle(
  canvas: HTMLCanvasElement,
  options: Partial<RendererInitConfig>,
  initRendererImpl: typeof initRenderer,
): Promise<RendererHandle> {
  const initialResult = await initRendererImpl(canvas, buildSettings(options));
  if (!initialResult) {
    rememberRendererFallback('Renderer initialization failed.');
    throw new Error('Unable to initialize renderer.');
  }
  let initResult: RendererInitResult = initialResult;

  let activeOptions = options;
  let activeViewport: RendererViewport | undefined;
  let activeRenderer: RendererInstance = initResult.renderer;
  let stopRendererAnimationLoop: (() => void) | null = null;
  let applyFacadeOverrides: ((renderer: RendererInstance) => void) | null =
    null;

  const recreateRenderer = async () => {
    activeRenderer.setAnimationLoop?.(null);

    if (initResult.backend === 'webgpu' && initResult.device) {
      const settings = buildSettings(activeOptions, initResult);
      const { WebGPURenderer: WebGPURendererConstructor } = await import(
        '../webgpu-renderer.ts'
      );
      const nextRenderer = new WebGPURendererConstructor({
        canvas,
        antialias: settings.antialias ?? true,
        alpha: settings.alpha ?? false,
        device: initResult.device,
      });
      if ('init' in nextRenderer && typeof nextRenderer.init === 'function') {
        await nextRenderer.init();
      }
      nextRenderer.outputColorSpace = SRGBColorSpace;
      nextRenderer.toneMapping = ACESFilmicToneMapping;

      const nextResult: RendererInitResult = {
        ...initResult,
        renderer: nextRenderer,
      };
      activeRenderer = nextRenderer;
      applyFacadeOverrides?.(activeRenderer);
      applyPoolSettings(
        activeRenderer,
        nextResult,
        activeOptions,
        activeViewport,
      );
      initResult = nextResult;
      handle.info = nextResult;
      return;
    }

    activeRenderer.dispose?.();

    const nextResult = await initRendererImpl(
      canvas,
      buildSettings(activeOptions, initResult),
    );
    if (!nextResult) {
      rememberRendererFallback('Renderer recreation failed.');
      throw new Error('Unable to recreate renderer.');
    }

    activeRenderer = nextResult.renderer;
    applyFacadeOverrides?.(activeRenderer);
    applyPoolSettings(
      activeRenderer,
      nextResult,
      activeOptions,
      activeViewport,
    );
    initResult = nextResult;
    handle.backend = nextResult.backend;
    handle.info = nextResult;
  };

  const renderer =
    initResult.backend === 'webgpu'
      ? (() => {
          const facade = createWebGpuRendererFacade({
            getRenderer: () => activeRenderer,
            recreateRenderer,
          });
          stopRendererAnimationLoop = facade.stopAnimationLoop;
          applyFacadeOverrides = facade.applyOverrides;
          return facade.renderer;
        })()
      : activeRenderer;

  const handle: RendererHandle = {
    renderer,
    backend: initResult.backend,
    info: initResult,
    canvas,
    getRuntimeControls: () => activeRuntimeControls,
    applySettings: (nextOptions, viewport) => {
      if (nextOptions) {
        activeOptions = nextOptions;
      }
      if (viewport) {
        activeViewport = viewport;
      }
      applyPoolSettings(
        activeRenderer,
        initResult,
        activeOptions,
        activeViewport,
      );
    },
    release: () => {
      activeOptions = {};
      activeViewport = undefined;
      stopRendererAnimationLoop?.();
    },
  };

  return handle;
}

function attachCanvas(canvas: HTMLCanvasElement, host?: HTMLElement) {
  if (!host) {
    return;
  }

  if (canvas.parentElement !== host) {
    host.appendChild(canvas);
  }
}

function detachCanvas(canvas: HTMLCanvasElement) {
  if (canvas.parentElement) {
    canvas.parentElement.removeChild(canvas);
  }
}

export async function requestRenderer({
  host,
  options = {},
  canvas: providedCanvas,
  initRendererImpl = initRenderer,
}: {
  host?: HTMLElement | null;
  options?: Partial<RendererInitConfig>;
  canvas?: HTMLCanvasElement | null;
  initRendererImpl?: typeof initRenderer;
} = {}): Promise<RendererHandle> {
  const entry = rendererPool.find((candidate) => !candidate.inUse);

  if (entry) {
    entry.inUse = true;
    attachCanvas(entry.handle.canvas, host ?? undefined);
    entry.handle.applySettings(options);
    return entry.handle;
  }

  const canvas = providedCanvas ?? document.createElement('canvas');
  attachCanvas(canvas, host ?? undefined);

  const handle = await createRendererHandle(canvas, options, initRendererImpl);

  const poolEntry: RendererPoolEntry = {
    handle,
    inUse: true,
  };

  const releaseHandle = handle.release;
  handle.release = () => {
    releaseHandle();
    handle.renderer.setAnimationLoop?.(null);
    poolEntry.inUse = false;
    detachCanvas(handle.canvas);
  };

  rendererPool.push(poolEntry);
  return handle;
}

export function getRendererRuntimeControls() {
  return activeRuntimeControls;
}

export function setRendererRuntimeControls(
  overrides: RendererRuntimeControlOverrides,
) {
  activeRuntimeControls = resolveRendererRuntimeControls(
    overrides,
    activeRuntimeControls,
  );
  forEachActiveRenderer((entry) => entry.handle.applySettings());
  runtimeControlSubscribers.forEach((subscriber) =>
    subscriber(activeRuntimeControls),
  );
  return activeRuntimeControls;
}

export function resetRendererRuntimeControls() {
  activeRuntimeControls = DEFAULT_RENDERER_RUNTIME_CONTROLS;
  forEachActiveRenderer((entry) => entry.handle.applySettings());
  runtimeControlSubscribers.forEach((subscriber) =>
    subscriber(activeRuntimeControls),
  );
  return activeRuntimeControls;
}

export function subscribeToRendererRuntimeControls(
  subscriber: (controls: RendererRuntimeControls) => void,
) {
  runtimeControlSubscribers.add(subscriber);
  subscriber(activeRuntimeControls);
  return () => runtimeControlSubscribers.delete(subscriber);
}

export async function prewarmRendererCapabilities() {
  return rendererCapabilitiesInitializer.run();
}

export function resetRendererPool({
  dispose = false,
}: {
  dispose?: boolean;
} = {}) {
  rendererPool.forEach((entry) => {
    entry.inUse = false;
    if (dispose) {
      entry.handle.renderer.setAnimationLoop?.(null);
      entry.handle.renderer.dispose?.();
      detachCanvas(entry.handle.canvas);
    }
  });
  if (dispose) {
    rendererPool.splice(0, rendererPool.length);
  }
  activeQuality = getActiveQualityPreset();
  activeRenderPreferences = getActiveRenderPreferences();
  resetRendererRuntimeControls();
  runtimeControlSubscribers.clear();
  rendererCapabilitiesInitializer.reset();
}
