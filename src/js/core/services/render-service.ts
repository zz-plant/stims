import type * as THREE from 'three';
import {
  getCurrentRetrySnapshot,
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
import {
  recordWebGLContextLost,
  recordWebGpuDeviceLost,
  recordWebGpuUncapturedError,
} from './crash-telemetry.ts';

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
  lastReleasedAt: number;
};

type RendererPoolLifecycle = {
  release: () => void;
  retain: () => void;
};

const rendererPool: RendererPoolEntry[] = [];
const rendererLifecycles = new WeakMap<RendererHandle, RendererPoolLifecycle>();
export const DEFAULT_MAX_IDLE_RENDERERS = 2;
let maxIdleRenderers = DEFAULT_MAX_IDLE_RENDERERS;

function disposeRendererPoolEntry(entry: RendererPoolEntry) {
  entry.handle.renderer.setAnimationLoop?.(null);
  rendererLifecycles.get(entry.handle)?.release();
  entry.handle.renderer.dispose?.();
  detachCanvas(entry.handle.canvas);
  const entryIndex = rendererPool.indexOf(entry);
  if (entryIndex !== -1) {
    rendererPool.splice(entryIndex, 1);
  }
}

function trimIdleRendererPool() {
  const idleEntries = rendererPool
    .filter((entry) => !entry.inUse)
    .sort((left, right) => left.lastReleasedAt - right.lastReleasedAt);
  const excessIdleCount = idleEntries.length - maxIdleRenderers;
  for (let index = 0; index < excessIdleCount; index += 1) {
    disposeRendererPoolEntry(idleEntries[index]);
  }
}

export function setMaxIdleRenderers(maximum: number) {
  if (!Number.isInteger(maximum) || maximum < 0) {
    throw new RangeError(
      'Maximum idle renderer count must be a non-negative integer.',
    );
  }
  maxIdleRenderers = maximum;
  trimIdleRendererPool();
}

/**
 * Emitted whenever a pooled renderer stops being the same live GPU renderer
 * it was a moment ago: recreated after a WebGL context loss or a WebGPU
 * device loss, disposed, or released back to the pool. Consumers that hold
 * external state bound to the *specific* renderer instance need to know,
 * because the facade keeps its identity across a swap while the underlying
 * renderer does not.
 */
export type RendererLifecycleEvent = {
  type: 'recreated' | 'disposed' | 'released';
  handle: RendererHandle;
};

const rendererLifecycleSubscribers = new Set<
  (event: RendererLifecycleEvent) => void
>();

export function subscribeToRendererLifecycle(
  subscriber: (event: RendererLifecycleEvent) => void,
) {
  rendererLifecycleSubscribers.add(subscriber);
  return () => rendererLifecycleSubscribers.delete(subscriber);
}

function notifyRendererLifecycle(event: RendererLifecycleEvent) {
  rendererLifecycleSubscribers.forEach((subscriber) => {
    try {
      subscriber(event);
    } catch (error) {
      console.warn('Renderer lifecycle subscriber failed.', error);
    }
  });
}

/**
 * The stage renderer: the first pooled renderer still checked out. Pool
 * entries are appended in creation order and the workspace stage is the
 * first renderer the app requests, so this is the one attached to the
 * visible canvas even when preview tiles have checked out extra renderers.
 */
export function getActiveRendererHandle(): RendererHandle | null {
  return rendererPool.find((entry) => entry.inUse)?.handle ?? null;
}
let activeQuality: QualityPreset = getActiveQualityPreset();
let _activeRenderPreferences = getActiveRenderPreferences();
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
    maxPixelRatio: activeQuality.maxPixelRatio,
    renderScale:
      activeRuntimeControls.renderScale * (activeQuality.renderScale ?? 1),
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
  _activeRenderPreferences = preferences;
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

function describeWebGLContextLoss(event: Event) {
  const statusMessage =
    'statusMessage' in event &&
    typeof (event as WebGLContextEvent).statusMessage === 'string' &&
    (event as WebGLContextEvent).statusMessage.trim().length > 0
      ? (event as WebGLContextEvent).statusMessage.trim()
      : null;
  return statusMessage
    ? `WebGL context was lost (${statusMessage}). Waiting for the browser to restore it.`
    : 'WebGL context was lost. Waiting for the browser to restore it.';
}

function createRendererFacade({
  getRenderer,
  getRendererRecovery,
  onDispose,
  driveAnimationLoop = true,
}: {
  getRenderer: () => RendererInstance;
  getRendererRecovery?: () => Promise<void> | null;
  onDispose?: () => void;
  // WebGPU recovery drives its own requestAnimationFrame loop so it can
  // pause frames while `getRendererRecovery()` is pending (see
  // `scheduleNextFrame` below). WebGL keeps three.js's native
  // setAnimationLoop scheduling: a thin pass-through that delegates
  // directly to the live renderer while still tracking the callback so it
  // can be reattached after a recreate.
  driveAnimationLoop?: boolean;
}) {
  let animationLoop: (() => void) | null = null;
  let animationFrameId: number | null = null;
  const overrides = new Map<PropertyKey, unknown>();
  const boundMethodCache = new WeakMap<
    object,
    Map<PropertyKey, { source: unknown; bound: unknown }>
  >();

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
          if (!driveAnimationLoop) {
            getRenderer().setAnimationLoop?.(callback);
            return;
          }
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

      const target = getRenderer() as object;
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') {
        return value;
      }
      // Bound-method cache keyed by the live renderer instance: the frame
      // loop reads renderer methods dozens of times per frame, and minting a
      // fresh closure on each access both allocates and defeats V8's inline
      // caches. Entries rebind automatically if the underlying method or the
      // renderer instance changes.
      let cache = boundMethodCache.get(target);
      if (!cache) {
        cache = new Map();
        boundMethodCache.set(target, cache);
      }
      const entry = cache.get(property);
      if (entry && entry.source === value) {
        return entry.bound;
      }
      const bound = (value as (...args: unknown[]) => unknown).bind(target);
      cache.set(property, { source: value, bound });
      return bound;
    },
    set: (_target, property, value) => {
      const target = getRenderer() as object;
      if (
        overrides.get(property) === value &&
        Reflect.get(target, property) === value
      ) {
        return true;
      }
      overrides.set(property, value);
      Reflect.set(target, property, value);
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
    // Re-establish the last-known callback on a freshly recreated renderer.
    // Only meaningful in pass-through mode: the driven loop already tracks
    // the live renderer itself via `getRenderer()`, so it needs no help.
    reattachAnimationLoop: () => {
      if (driveAnimationLoop || !animationLoop) {
        return;
      }
      getRenderer().setAnimationLoop?.(animationLoop);
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

  // The WebGL fallback may replace a WebGPU-bound canvas with a fresh
  // element (a canvas permanently binds its first context type), so the
  // renderer's domElement — not the canvas passed in — is the live one.
  const resolveLiveCanvas = (
    result: RendererInitResult,
    fallback: HTMLCanvasElement,
  ): HTMLCanvasElement => {
    const dom = (result.renderer as { domElement?: HTMLCanvasElement })
      .domElement;
    // Duck-typed: HTMLCanvasElement is not a global in every test DOM.
    return dom && typeof dom.getContext === 'function' ? dom : fallback;
  };
  let activeCanvas = resolveLiveCanvas(initResult, canvas);

  let activeOptions = options;
  let activeViewport: RendererViewport | undefined;
  let activeRenderer: RendererInstance = initResult.renderer;
  let stopRendererAnimationLoop: (() => void) | null = null;
  let applyFacadeOverrides: ((renderer: RendererInstance) => void) | null =
    null;
  let webGpuRecovery: Promise<void> | null = null;
  let cancelWebGpuRecovery: (() => void) | null = null;
  let released = false;
  let observedWebGpuDeviceRevision = 0;
  let cleanupObservedWebGpuDeviceError: (() => void) | null = null;
  let reattachAnimationLoop: (() => void) | null = null;

  const releaseRendererLifecycle = () => {
    released = true;
    cancelWebGpuRecovery?.();
    cancelWebGpuRecovery = null;
  };

  const retainRendererLifecycle = () => {
    released = false;
  };

  const clearObservedWebGpuDevice = () => {
    observedWebGpuDeviceRevision += 1;
    cleanupObservedWebGpuDeviceError?.();
    cleanupObservedWebGpuDeviceError = null;
  };

  let observedWebGLContextRevision = 0;
  let cleanupObservedWebGLContext: (() => void) | null = null;
  let webglContextRecoveryInFlight = false;

  const clearObservedWebGLContext = () => {
    observedWebGLContextRevision += 1;
    cleanupObservedWebGLContext?.();
    cleanupObservedWebGLContext = null;
  };

  const recreateRenderer = async ({
    allowBackendSwitch = true,
  }: {
    allowBackendSwitch?: boolean;
  } = {}) => {
    const previousRenderer = activeRenderer;
    const previousBackend = initResult.backend;
    const nextResult = await initRendererImpl(
      activeCanvas,
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
    if (released) {
      nextResult.renderer.dispose?.();
      throw new Error(
        'Renderer recreation aborted: the renderer handle was released.',
      );
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
    clearObservedWebGLContext();
    previousRenderer.setAnimationLoop?.(null);
    previousRenderer.dispose?.();
    activeRenderer = nextResult.renderer;
    activeCanvas = resolveLiveCanvas(nextResult, activeCanvas);
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
    observeActiveWebGLContext();
    reattachAnimationLoop?.();
    notifyRendererLifecycle({ type: 'recreated', handle });
  };

  const WEBGPU_RECOVERY_MAX_ATTEMPTS = 3;

  // Probing before the capability retry cooldown expires is guaranteed to
  // come back as a WebGL fallback, so each attempt waits the cooldown out.
  const nextRecoveryDelayMs = () => {
    const snapshot = getCurrentRetrySnapshot();
    if (snapshot.nextRetryAt === null) {
      return 100;
    }
    return Math.max(100, snapshot.nextRetryAt - Date.now() + 50);
  };

  const queueWebGpuRecovery = (reason: string) => {
    if (webGpuRecovery) {
      return webGpuRecovery;
    }

    let cancelled = false;
    let recoverySleepId: ReturnType<typeof setTimeout> | null = null;

    const cancellableSleep = (ms: number) =>
      new Promise<void>((resolve) => {
        recoverySleepId = setTimeout(() => {
          recoverySleepId = null;
          resolve();
        }, ms);
      });

    const cancel = () => {
      cancelled = true;
      if (recoverySleepId !== null) {
        clearTimeout(recoverySleepId);
        recoverySleepId = null;
      }
    };

    const recovery = (async () => {
      for (
        let attempt = 1;
        attempt <= WEBGPU_RECOVERY_MAX_ATTEMPTS;
        attempt += 1
      ) {
        const lastAttempt = attempt === WEBGPU_RECOVERY_MAX_ATTEMPTS;
        await cancellableSleep(nextRecoveryDelayMs());
        if (cancelled) {
          return;
        }
        try {
          // A working compatibility renderer beats a permanently lost
          // device, so the final attempt accepts a WebGL replacement.
          await recreateRenderer({ allowBackendSwitch: lastAttempt });
          if (cancelled) {
            return;
          }
          if (handle.backend !== 'webgpu') {
            console.warn(
              'WebGPU device was lost; switched to the WebGL compatibility renderer.',
            );
          }
          return;
        } catch (error) {
          if (cancelled) {
            return;
          }
          rememberRendererFallback(reason, {
            backend: 'webgl',
            shouldRetryWebGPU: !lastAttempt,
          });
          if (lastAttempt) {
            throw error;
          }
        }
      }
    })();
    webGpuRecovery = recovery.finally(() => {
      if (webGpuRecovery === recovery) {
        webGpuRecovery = null;
      }
      if (cancelWebGpuRecovery === cancel) {
        cancelWebGpuRecovery = null;
      }
    });
    cancelWebGpuRecovery = cancel;
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
        if (released) {
          return;
        }
        if (observedRevision !== observedWebGpuDeviceRevision) {
          return;
        }
        const message = describeWebGpuDeviceLoss(info);
        console.warn(message);
        recordWebGpuDeviceLost(info);
        void queueWebGpuRecovery(message).catch((error) => {
          console.warn('WebGPU renderer recovery failed.', error);
        });
      })
      .catch((error) => {
        console.warn('WebGPU device lost listener failed to register.', error);
      });

    const handleUncapturedError = (event: WebGpuUncapturedErrorEventLike) => {
      if (observedRevision !== observedWebGpuDeviceRevision) {
        return;
      }
      console.warn(describeWebGpuUncapturedError(event), event);
      recordWebGpuUncapturedError(event);
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

  function observeActiveWebGLContext() {
    clearObservedWebGLContext();

    if (initResult.backend !== 'webgl') {
      return;
    }

    const observedRevision = observedWebGLContextRevision;
    const canvas = activeCanvas;

    const handleContextLost = (event: Event) => {
      if (observedRevision !== observedWebGLContextRevision) {
        return;
      }
      // Required for the browser to consider this context eligible for
      // restoration — without it, the loss is permanent and
      // `webglcontextrestored` never fires.
      event.preventDefault();
      const message = describeWebGLContextLoss(event);
      console.warn(`${message} (backend: webgl)`, event);
      recordWebGLContextLost(
        'statusMessage' in event
          ? { statusMessage: (event as WebGLContextEvent).statusMessage }
          : null,
      );
      // Pause frames on the underlying renderer directly rather than going
      // through the public `handle.renderer.setAnimationLoop`, which would
      // clear the facade's tracked callback — we need that callback intact
      // so recovery can resume rendering once the context is restored.
      activeRenderer.setAnimationLoop?.(null);
      rememberRendererFallback('WebGL context lost — waiting for restore.', {
        backend: 'webgl',
      });
      // A DOM event (rather than a return value or callback param) so this
      // low-level service can notify the UI without a direct dependency on
      // the frontend layer — same pattern as the existing `stims:load-status`
      // event.
      window.dispatchEvent(
        new CustomEvent('stims:renderer-status', {
          detail: { status: 'context-lost' },
        }),
      );
    };

    const handleContextRestored = () => {
      if (released) {
        return;
      }
      if (observedRevision !== observedWebGLContextRevision) {
        return;
      }
      if (webglContextRecoveryInFlight) {
        return;
      }
      webglContextRecoveryInFlight = true;
      console.info('WebGL context restored; rebuilding the renderer.', canvas);
      void recreateRenderer()
        .then(() => {
          window.dispatchEvent(
            new CustomEvent('stims:renderer-status', {
              detail: { status: 'context-restored' },
            }),
          );
        })
        .catch((error) => {
          console.warn(
            'WebGL renderer recovery after context restore failed.',
            error,
          );
          window.dispatchEvent(
            new CustomEvent('stims:renderer-status', {
              detail: { status: 'context-restore-failed' },
            }),
          );
        })
        .finally(() => {
          webglContextRecoveryInFlight = false;
        });
    };

    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener(
      'webglcontextrestored',
      handleContextRestored,
      false,
    );
    cleanupObservedWebGLContext = () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost, false);
      canvas.removeEventListener(
        'webglcontextrestored',
        handleContextRestored,
        false,
      );
    };
  }

  const renderer = (() => {
    const facade = createRendererFacade({
      getRenderer: () => activeRenderer,
      getRendererRecovery: () => webGpuRecovery,
      onDispose: () => {
        clearObservedWebGpuDevice();
        clearObservedWebGLContext();
        notifyRendererLifecycle({ type: 'disposed', handle });
      },
      driveAnimationLoop: initResult.backend === 'webgpu',
    });
    stopRendererAnimationLoop = facade.stopAnimationLoop;
    applyFacadeOverrides = facade.applyOverrides;
    reattachAnimationLoop = facade.reattachAnimationLoop;
    return facade.renderer;
  })();

  const handle: RendererHandle = {
    renderer,
    backend: initResult.backend,
    info: initResult,
    // Live canvas: a WebGL fallback or renderer recreation can swap the
    // element, and the pool's attach/detach must follow the swap.
    get canvas() {
      return activeCanvas;
    },
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
      releaseRendererLifecycle();
      activeOptions = {};
      activeViewport = undefined;
      stopRendererAnimationLoop?.();
      notifyRendererLifecycle({ type: 'released', handle });
    },
  };

  observeActiveWebGpuDevice();
  observeActiveWebGLContext();

  rendererLifecycles.set(handle, {
    release: releaseRendererLifecycle,
    retain: retainRendererLifecycle,
  });

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
    rendererLifecycles.get(entry.handle)?.retain();
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
    lastReleasedAt: 0,
  };

  const releaseHandle = handle.release;
  handle.release = () => {
    if (!poolEntry.inUse) {
      return;
    }
    releaseHandle();
    // Stop rendering and park the canvas, but keep the renderer itself
    // alive — the whole point of the pool is to let the next toy reuse it
    // without paying renderer-init cost again. Disposing here would free
    // the GPU context out from under a "free" pool entry, so a later
    // requestRenderer would hand back a dead renderer (finding: closing one
    // toy and opening another rendered black). Real disposal only happens
    // via resetRendererPool({ dispose: true }).
    handle.renderer.setAnimationLoop?.(null);
    poolEntry.inUse = false;
    poolEntry.lastReleasedAt = performance.now();
    detachCanvas(handle.canvas);
    trimIdleRendererPool();
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
  maxIdle = DEFAULT_MAX_IDLE_RENDERERS,
}: {
  dispose?: boolean;
  maxIdle?: number;
} = {}) {
  setMaxIdleRenderers(maxIdle);
  for (const entry of [...rendererPool]) {
    entry.inUse = false;
    entry.lastReleasedAt = performance.now();
    if (dispose) {
      disposeRendererPoolEntry(entry);
    } else {
      rendererLifecycles.get(entry.handle)?.release();
    }
  }
  trimIdleRendererPool();
  activeQuality = getActiveQualityPreset();
  _activeRenderPreferences = getActiveRenderPreferences();
  resetRendererRuntimeControls();
  runtimeControlSubscribers.clear();
  rendererCapabilitiesInitializer.reset();
}
