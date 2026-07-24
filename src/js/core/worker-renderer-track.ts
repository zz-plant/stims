import {
  getRendererOptimizationSupport,
  type RendererCapabilities,
  recordRendererOptimizationTelemetry,
} from './renderer-capabilities.ts';
import type { RendererRuntimeControls } from './renderer-settings.ts';
import type { RendererInitConfig } from './renderer-setup.ts';
import {
  isRendererWorkerResponseMessage,
  RENDERER_WORKER_MESSAGE_TYPES,
  type RendererWorkerFramePayload,
  type RendererWorkerPresetPayload,
  type RendererWorkerRequestMessage,
  type RendererWorkerResponseMessage,
} from './renderer-worker-protocol.ts';

export const RENDERER_WORKER_EXPERIMENT_SEARCH_PARAM = 'render-worker';
export const RENDERER_WORKER_EXPERIMENT_STORAGE_KEY =
  'stims:experiments:render-worker';

export type ExperimentalWorkerRendererTrack = {
  worker: Worker;
  postResize: (payload: {
    width: number;
    height: number;
    devicePixelRatio?: number;
  }) => void;
  postQualityUpdate: (payload: {
    runtimeControls: RendererRuntimeControls;
    options?: Partial<RendererInitConfig>;
  }) => void;
  postPreset: (payload: RendererWorkerPresetPayload) => void;
  postFrame: (payload: RendererWorkerFramePayload) => void;
  dispose: () => void;
};

export type ExperimentalWorkerRendererTrackOptions = {
  canvas: HTMLCanvasElement;
  capabilities: RendererCapabilities | null;
  width: number;
  height: number;
  devicePixelRatio?: number;
  options?: Partial<RendererInitConfig>;
  enabled?: boolean;
  workerFactory?: () => Worker;
  onMessage?: (message: RendererWorkerResponseMessage) => void;
};

function isExperimentEnabledFlag(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  return ['1', 'true', 'on', 'yes', 'enabled'].includes(
    value.trim().toLowerCase(),
  );
}

export function isRendererWorkerExperimentEnabled({
  location = globalThis.location,
  storage = globalThis.localStorage,
}: {
  location?: Pick<Location, 'search'> | null;
  storage?: Pick<Storage, 'getItem'> | null;
} = {}) {
  const searchValue = location?.search
    ? new URLSearchParams(location.search).get(
        RENDERER_WORKER_EXPERIMENT_SEARCH_PARAM,
      )
    : null;
  if (isExperimentEnabledFlag(searchValue)) {
    return true;
  }

  const storageValue = storage?.getItem?.(
    RENDERER_WORKER_EXPERIMENT_STORAGE_KEY,
  );
  return isExperimentEnabledFlag(storageValue);
}

export function canUseExperimentalWorkerRenderer({
  canvas,
  capabilities,
  enabled = isRendererWorkerExperimentEnabled(),
}: {
  canvas: HTMLCanvasElement | null | undefined;
  capabilities: RendererCapabilities | null | undefined;
  enabled?: boolean;
}) {
  if (!enabled || !canvas) {
    return false;
  }

  const optimization = getRendererOptimizationSupport(capabilities);
  return (
    capabilities?.preferredBackend === 'webgpu' &&
    optimization.workerOffscreenPipeline &&
    typeof canvas.transferControlToOffscreen === 'function'
  );
}

function createDefaultWorker() {
  return new Worker(new URL('./renderer-worker.ts', import.meta.url), {
    type: 'module',
  });
}

export function createExperimentalWorkerRendererTrack({
  canvas,
  capabilities,
  width,
  height,
  devicePixelRatio = globalThis.devicePixelRatio || 1,
  options = {},
  enabled = isRendererWorkerExperimentEnabled(),
  workerFactory = createDefaultWorker,
  onMessage,
}: ExperimentalWorkerRendererTrackOptions): ExperimentalWorkerRendererTrack | null {
  if (
    !canUseExperimentalWorkerRenderer({
      canvas,
      capabilities,
      enabled,
    })
  ) {
    return null;
  }

  const worker = workerFactory();
  const offscreenCanvas = canvas.transferControlToOffscreen();
  const queuedMessages: RendererWorkerRequestMessage[] = [];
  let isReady = false;
  let isDisposed = false;
  let hasInitFailed = false;

  const failClosed = () => {
    if (isDisposed) {
      return;
    }

    hasInitFailed = true;
    isDisposed = true;
    queuedMessages.length = 0;
    worker.removeEventListener('message', handleMessage as EventListener);
    worker.terminate();
  };

  const postWhenReady = (message: RendererWorkerRequestMessage) => {
    if (isDisposed || hasInitFailed) {
      return;
    }

    if (!isReady && message.type !== RENDERER_WORKER_MESSAGE_TYPES.dispose) {
      queuedMessages.push(message);
      return;
    }

    worker.postMessage(message);
  };

  const flushQueuedMessages = () => {
    if (!isReady || isDisposed || queuedMessages.length === 0) {
      return;
    }

    while (queuedMessages.length > 0) {
      const message = queuedMessages.shift();
      if (message) {
        worker.postMessage(message);
      }
    }
  };

  const handleMessage = (event: MessageEvent<unknown>) => {
    if (!isRendererWorkerResponseMessage(event.data)) {
      return;
    }

    if (event.data.type === RENDERER_WORKER_MESSAGE_TYPES.ready) {
      isReady = true;
      flushQueuedMessages();
    }

    if (event.data.type === RENDERER_WORKER_MESSAGE_TYPES.error && !isReady) {
      failClosed();
    }

    onMessage?.(event.data);
  };
  worker.addEventListener('message', handleMessage as EventListener);
  worker.postMessage(
    {
      type: RENDERER_WORKER_MESSAGE_TYPES.init,
      payload: {
        canvas: offscreenCanvas,
        width,
        height,
        devicePixelRatio,
        options,
      },
    },
    [offscreenCanvas],
  );
  recordRendererOptimizationTelemetry({
    counter: 'workerOffscreenUsage',
  });

  return {
    worker,
    postResize: ({
      width: nextWidth,
      height: nextHeight,
      devicePixelRatio: nextDevicePixelRatio = globalThis.devicePixelRatio || 1,
    }) => {
      postWhenReady({
        type: RENDERER_WORKER_MESSAGE_TYPES.resize,
        payload: {
          width: nextWidth,
          height: nextHeight,
          devicePixelRatio: nextDevicePixelRatio,
        },
      });
    },
    postQualityUpdate: ({ runtimeControls, options: nextOptions }) => {
      postWhenReady({
        type: RENDERER_WORKER_MESSAGE_TYPES.quality,
        payload: {
          runtimeControls,
          options: nextOptions,
        },
      });
    },
    postPreset: (payload) => {
      postWhenReady({
        type: RENDERER_WORKER_MESSAGE_TYPES.preset,
        payload,
      });
    },
    postFrame: (payload) => {
      postWhenReady({
        type: RENDERER_WORKER_MESSAGE_TYPES.frame,
        payload,
      });
    },
    dispose: () => {
      if (isDisposed) {
        return;
      }

      isDisposed = true;
      queuedMessages.length = 0;
      worker.postMessage({
        type: RENDERER_WORKER_MESSAGE_TYPES.dispose,
      });
      worker.removeEventListener('message', handleMessage as EventListener);
      worker.terminate();
    },
  };
}
