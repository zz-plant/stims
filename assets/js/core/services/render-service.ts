import type * as THREE from 'three';
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

type WebGpuUncapturedErrorEventLike = {
  error?: {
    message?: string;
  } | null;
};

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

function describeWebGpuDeviceLoss(info: unknown) {
  const reason =
    info &&
    typeof info === 'object' &&
    'reason' in info &&
    typeof info.reason === 'string'
      ? info.reason
      : null;
  const message =
    info &&
    typeof info === 'object' &&
    'message' in info &&
    typeof info.message === 'string'
      ? info.message.trim()
      : '';

  const detail = message || reason;
  return detail
    ? `WebGPU device was lost (${detail}). Attempting renderer recovery.`
    : 'WebGPU device was lost. Attempting renderer recovery.';
}

function describeWebGpuUncapturedError(
  event: WebGpuUncapturedErrorEventLike | null | undefined,
) {
  const message = event?.error?.message?.trim();
  return message
    ? `WebGPU emitted an uncaptured device error: ${message}`
    : 'WebGPU emitted an uncaptured device error.';
}

function createWebGpuRendererFacade({
  getRenderer,
  getRendererRecovery,
  onDispose,
}: {
  getRenderer: () => RendererInstance;
  getRendererRecovery?: () => Promise<void> | null;
  onDispose?: () => void;
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

      const recovery = getRendererRecovery?.();
      if (recovery) {
        void recovery
          .catch((error) => {
            console.warn('WebGPU renderer recovery failed.', error);
          })
          .finally(() => {
            if (animationLoop === callback) {
              scheduleNextFrame();
            } else {
              animationFrameId = null;
            }
          });
        return;
      }

      try {
        callback();
      } catch (error) {
        console.warn('WebGPU animation loop callback failed.', error);
      } finally {
        if (animationLoop === callback) {
          scheduleNextFrame();
        } else {
          animationFrameId = null;
        }
      }
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
          onDispose?.();
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
  let webGpuRecovery: Promise<void> | null = null;
  let observedWebGpuDeviceRevision = 0;
  let cleanupObservedWebGpuDeviceError: (() => void) | null = null;

  const clearObservedWebGpuDevice = () => {
    observedWebGpuDeviceRevision += 1;
    cleanupObservedWebGpuDeviceError?.();
    cleanupObservedWebGpuDeviceError = null;
  };

  const recreateRenderer = async ({
    allowBackendSwitch = true,
  }: {
    allowBackendSwitch?: boolean;
  } = {}) => {
    const previousRenderer = activeRenderer;
    const previousBackend = initResult.backend;
    const nextResult = await initRendererImpl(
      canvas,
      buildSettings(
        {
          ...activeOptions,
          forceRetryCapabilities: true,
        },
        initResult,
      ),
    );
    if (!nextResult) {
      rememberRendererFallback('Renderer recreation failed.');
      throw new Error('Unable to recreate renderer.');
    }
    if (!allowBackendSwitch && nextResult.backend !== previousBackend) {
      nextResult.renderer.dispose?.();
      rememberRendererFallback(
        'WebGPU renderer recovery could not keep the WebGPU backend active.',
        {
          backend: 'webgl',
          shouldRetryWebGPU: true,
        },
      );
      throw new Error('WebGPU renderer recovery switched backends.');
    }

    clearObservedWebGpuDevice();
    previousRenderer.setAnimationLoop?.(null);
    previousRenderer.dispose?.();
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
    observeActiveWebGpuDevice();
  };

  const queueWebGpuRecovery = (reason: string) => {
    if (webGpuRecovery) {
      return webGpuRecovery;
    }

    const recovery = recreateRenderer({
      allowBackendSwitch: false,
    }).catch((error) => {
      rememberRendererFallback(reason, {
        backend: 'webgl',
        shouldRetryWebGPU: true,
      });
      throw error;
    });
    webGpuRecovery = recovery.finally(() => {
      if (webGpuRecovery === recovery) {
        webGpuRecovery = null;
      }
    });
    return webGpuRecovery;
  };

  function observeActiveWebGpuDevice() {
    clearObservedWebGpuDevice();

    if (initResult.backend !== 'webgpu' || !initResult.device) {
      return;
    }

    const observedRevision = observedWebGpuDeviceRevision;
    const device = initResult.device as GPUDevice & {
      addEventListener?: (
        type: 'uncapturederror',
        listener: (event: WebGpuUncapturedErrorEventLike) => void,
      ) => void;
      removeEventListener?: (
        type: 'uncapturederror',
        listener: (event: WebGpuUncapturedErrorEventLike) => void,
      ) => void;
      onuncapturederror?:
        | ((event: WebGpuUncapturedErrorEventLike) => void)
        | null;
    };

    void device.lost
      ?.then((info) => {
        if (observedRevision !== observedWebGpuDeviceRevision) {
          return;
        }
        const message = describeWebGpuDeviceLoss(info);
        console.warn(message);
        void queueWebGpuRecovery(message).catch((error) => {
          console.warn('WebGPU renderer recovery failed.', error);
        });
      })
      .catch(() => {});

    const handleUncapturedError = (event: WebGpuUncapturedErrorEventLike) => {
      if (observedRevision !== observedWebGpuDeviceRevision) {
        return;
      }
      console.warn(describeWebGpuUncapturedError(event), event);
    };

    if (
      typeof device.addEventListener === 'function' &&
      typeof device.removeEventListener === 'function'
    ) {
      device.addEventListener('uncapturederror', handleUncapturedError);
      cleanupObservedWebGpuDeviceError = () => {
        device.removeEventListener?.('uncapturederror', handleUncapturedError);
      };
      return;
    }

    if ('onuncapturederror' in device) {
      device.onuncapturederror = handleUncapturedError;
      cleanupObservedWebGpuDeviceError = () => {
        if (device.onuncapturederror === handleUncapturedError) {
          device.onuncapturederror = null;
        }
      };
    }
  }

  const renderer =
    initResult.backend === 'webgpu'
      ? (() => {
          const facade = createWebGpuRendererFacade({
            getRenderer: () => activeRenderer,
            getRendererRecovery: () => webGpuRecovery,
            onDispose: clearObservedWebGpuDevice,
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

  observeActiveWebGpuDevice();

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
