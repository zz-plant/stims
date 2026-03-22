import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { RendererCapabilities } from '../assets/js/core/renderer-capabilities.ts';
import { RENDERER_WORKER_MESSAGE_TYPES } from '../assets/js/core/renderer-worker-protocol.ts';
import {
  canUseExperimentalWorkerRenderer,
  createExperimentalWorkerRendererTrack,
  isRendererWorkerExperimentEnabled,
  RENDERER_WORKER_EXPERIMENT_SEARCH_PARAM,
  RENDERER_WORKER_EXPERIMENT_STORAGE_KEY,
} from '../assets/js/core/worker-renderer-track.ts';

const webgpuCapabilities: RendererCapabilities = {
  preferredBackend: 'webgpu',
  adapter: null,
  device: null,
  fallbackReason: null,
  fallbackReasonCode: null,
  shouldRetryWebGPU: false,
  forceWebGL: false,
  webgpu: {
    features: {
      bgra8unormStorage: true,
      float32Blendable: true,
      float32Filterable: true,
      shaderF16: true,
      subgroups: true,
      timestampQuery: true,
    },
    limits: {
      maxColorAttachments: 8,
      maxComputeInvocationsPerWorkgroup: 512,
      maxStorageBufferBindingSize: 1_073_741_824,
      maxTextureDimension2D: 8192,
    },
    workers: {
      workers: true,
      offscreenCanvas: true,
      transferControlToOffscreen: true,
    },
    optimization: {
      timestampQuery: true,
      shaderF16: true,
      subgroups: true,
      workers: true,
      offscreenCanvas: true,
      transferControlToOffscreen: true,
      workerOffscreenPipeline: true,
    },
    preferredCanvasFormat: 'bgra8unorm',
    performanceTier: 'high-end',
    recommendedQualityPreset: 'hi-fi',
  },
};

describe('worker renderer track gating', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  test('stays disabled by default even when worker offscreen support is available', () => {
    const canvas = document.createElement('canvas');
    canvas.transferControlToOffscreen = mock(
      () => ({ marker: 'offscreen' }) as unknown as OffscreenCanvas,
    );

    expect(
      canUseExperimentalWorkerRenderer({
        canvas,
        capabilities: webgpuCapabilities,
      }),
    ).toBe(false);
  });

  test('accepts either the query param or local storage opt-in flags', () => {
    expect(
      isRendererWorkerExperimentEnabled({
        location: {
          search: `?${RENDERER_WORKER_EXPERIMENT_SEARCH_PARAM}=1`,
        },
        storage: null,
      }),
    ).toBe(true);

    const storage = {
      getItem: (key: string) =>
        key === RENDERER_WORKER_EXPERIMENT_STORAGE_KEY ? 'enabled' : null,
    };
    expect(
      isRendererWorkerExperimentEnabled({
        location: { search: '' },
        storage,
      }),
    ).toBe(true);
  });
});

describe('worker renderer track messaging', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  test('queues outbound messages until the worker reports ready, then flushes them in order', () => {
    const postMessage = mock();
    let messageListener: ((event: MessageEvent<unknown>) => void) | null = null;
    const emitMessage = (event: MessageEvent<unknown>) => {
      if (!messageListener) {
        throw new Error('Expected worker message listener to be registered.');
      }

      messageListener(event);
    };
    const addEventListener = mock((type: string, listener: EventListener) => {
      if (type === 'message') {
        messageListener = listener as (event: MessageEvent<unknown>) => void;
      }
    });
    const removeEventListener = mock();
    const terminate = mock();
    const fakeWorker = {
      postMessage,
      addEventListener,
      removeEventListener,
      terminate,
    } as unknown as Worker;
    const workerFactory = mock(() => fakeWorker);
    const canvas = document.createElement('canvas');
    const offscreenCanvas = {
      marker: 'offscreen',
    } as unknown as OffscreenCanvas;
    canvas.transferControlToOffscreen = mock(() => offscreenCanvas);

    const track = createExperimentalWorkerRendererTrack({
      canvas,
      capabilities: webgpuCapabilities,
      width: 1280,
      height: 720,
      devicePixelRatio: 2,
      options: { maxPixelRatio: 1.5, renderScale: 0.8 },
      enabled: true,
      workerFactory,
    });

    expect(track).not.toBeNull();
    expect(workerFactory).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      {
        type: RENDERER_WORKER_MESSAGE_TYPES.init,
        payload: {
          canvas: offscreenCanvas,
          width: 1280,
          height: 720,
          devicePixelRatio: 2,
          options: { maxPixelRatio: 1.5, renderScale: 0.8 },
        },
      },
      [offscreenCanvas],
    );

    track?.postResize({ width: 1440, height: 900 });
    track?.postQualityUpdate({
      runtimeControls: {
        renderScale: 0.75,
        feedbackScale: 1,
        meshDensityMultiplier: 1,
        waveSampleMultiplier: 1,
        motionVectorDensityMultiplier: 1,
      },
      options: { exposure: 1.2 },
    });
    track?.postPreset({ id: 'signal-field', title: 'Signal Field' });
    track?.postFrame({
      now: 200,
      deltaMs: 16.67,
      audioLevel: 0.4,
      energy: { bass: 0.6, mids: 0.5, treble: 0.7 },
      pointer: { x: 0.25, y: 0.75, down: true },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);

    expect(messageListener).not.toBeNull();
    emitMessage({
      data: {
        type: RENDERER_WORKER_MESSAGE_TYPES.ready,
        payload: {
          backend: 'webgpu',
          width: 1280,
          height: 720,
        },
      },
    } as MessageEvent<unknown>);

    expect(postMessage).toHaveBeenNthCalledWith(2, {
      type: RENDERER_WORKER_MESSAGE_TYPES.resize,
      payload: {
        width: 1440,
        height: 900,
        devicePixelRatio: 1,
      },
    });
    expect(postMessage).toHaveBeenNthCalledWith(3, {
      type: RENDERER_WORKER_MESSAGE_TYPES.quality,
      payload: {
        runtimeControls: {
          renderScale: 0.75,
          feedbackScale: 1,
          meshDensityMultiplier: 1,
          waveSampleMultiplier: 1,
          motionVectorDensityMultiplier: 1,
        },
        options: { exposure: 1.2 },
      },
    });
    expect(postMessage).toHaveBeenNthCalledWith(4, {
      type: RENDERER_WORKER_MESSAGE_TYPES.preset,
      payload: { id: 'signal-field', title: 'Signal Field' },
    });
    expect(postMessage).toHaveBeenNthCalledWith(5, {
      type: RENDERER_WORKER_MESSAGE_TYPES.frame,
      payload: {
        now: 200,
        deltaMs: 16.67,
        audioLevel: 0.4,
        energy: { bass: 0.6, mids: 0.5, treble: 0.7 },
        pointer: { x: 0.25, y: 0.75, down: true },
      },
    });

    track?.dispose();

    expect(postMessage).toHaveBeenNthCalledWith(6, {
      type: RENDERER_WORKER_MESSAGE_TYPES.dispose,
    });
    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  test('forwards worker response messages to the optional callback', () => {
    const postMessage = mock();
    let messageListener: ((event: MessageEvent<unknown>) => void) | null = null;
    const emitMessage = (event: MessageEvent<unknown>) => {
      if (!messageListener) {
        throw new Error('Expected worker message listener to be registered.');
      }

      messageListener(event);
    };
    const addEventListener = mock((type: string, listener: EventListener) => {
      if (type === 'message') {
        messageListener = listener as (event: MessageEvent<unknown>) => void;
      }
    });
    const fakeWorker = {
      postMessage,
      addEventListener,
      removeEventListener: mock(),
      terminate: mock(),
    } as unknown as Worker;
    const canvas = document.createElement('canvas');
    const offscreenCanvas = {
      marker: 'offscreen',
    } as unknown as OffscreenCanvas;
    canvas.transferControlToOffscreen = mock(() => offscreenCanvas);
    const onMessage = mock();

    createExperimentalWorkerRendererTrack({
      canvas,
      capabilities: webgpuCapabilities,
      width: 640,
      height: 360,
      enabled: true,
      workerFactory: () => fakeWorker,
      onMessage,
    });

    expect(messageListener).not.toBeNull();
    emitMessage({
      data: {
        type: RENDERER_WORKER_MESSAGE_TYPES.status,
        payload: { phase: 'initialized' },
      },
    } as MessageEvent<unknown>);

    expect(onMessage).toHaveBeenCalledWith({
      type: RENDERER_WORKER_MESSAGE_TYPES.status,
      payload: { phase: 'initialized' },
    });
  });

  test('fails closed when the worker reports an init error before ready', () => {
    const postMessage = mock();
    let messageListener: ((event: MessageEvent<unknown>) => void) | null = null;
    const emitMessage = (event: MessageEvent<unknown>) => {
      if (!messageListener) {
        throw new Error('Expected worker message listener to be registered.');
      }

      messageListener(event);
    };
    const addEventListener = mock((type: string, listener: EventListener) => {
      if (type === 'message') {
        messageListener = listener as (event: MessageEvent<unknown>) => void;
      }
    });
    const removeEventListener = mock();
    const terminate = mock();
    const fakeWorker = {
      postMessage,
      addEventListener,
      removeEventListener,
      terminate,
    } as unknown as Worker;
    const canvas = document.createElement('canvas');
    const offscreenCanvas = {
      marker: 'offscreen',
    } as unknown as OffscreenCanvas;
    canvas.transferControlToOffscreen = mock(() => offscreenCanvas);
    const onMessage = mock();

    const track = createExperimentalWorkerRendererTrack({
      canvas,
      capabilities: webgpuCapabilities,
      width: 640,
      height: 360,
      enabled: true,
      workerFactory: () => fakeWorker,
      onMessage,
    });

    track?.postFrame({
      now: 16.67,
      deltaMs: 16.67,
      audioLevel: 0.5,
    });
    expect(postMessage).toHaveBeenCalledTimes(1);

    emitMessage({
      data: {
        type: RENDERER_WORKER_MESSAGE_TYPES.error,
        payload: {
          message:
            'Unable to acquire a WebGPU adapter inside the renderer worker.',
        },
      },
    } as MessageEvent<unknown>);

    expect(removeEventListener).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({
      type: RENDERER_WORKER_MESSAGE_TYPES.error,
      payload: {
        message:
          'Unable to acquire a WebGPU adapter inside the renderer worker.',
      },
    });

    track?.postResize({ width: 800, height: 600 });
    track?.postPreset({ id: 'after-error' });
    track?.dispose();

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(1);
  });
});
