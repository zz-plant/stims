/* global GPU */

import {
  ACESFilmicToneMapping,
  Color,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
} from 'three';
import type { RendererInitConfig } from './renderer-setup.ts';
import {
  RENDERER_WORKER_MESSAGE_TYPES,
  type RendererWorkerFramePayload,
  type RendererWorkerPresetPayload,
  type RendererWorkerQualityPayload,
  type RendererWorkerRequestMessage,
  type RendererWorkerResizePayload,
  type RendererWorkerResponseMessage,
} from './renderer-worker-protocol.ts';
import { WebGPURenderer } from './webgpu-renderer.ts';

const scope = globalThis as typeof globalThis & {
  postMessage: (message: RendererWorkerResponseMessage) => void;
  addEventListener: (
    type: 'message',
    listener: (
      event: MessageEvent<RendererWorkerRequestMessage>,
    ) => void | Promise<void>,
  ) => void;
};

type WorkerRendererState = {
  renderer: WebGPURenderer | null;
  scene: Scene | null;
  camera: PerspectiveCamera | null;
  canvas: OffscreenCanvas | null;
  width: number;
  height: number;
  devicePixelRatio: number;
  options: Partial<RendererInitConfig>;
  latestPreset: RendererWorkerPresetPayload | null;
  latestFrame: RendererWorkerFramePayload | null;
};

const state: WorkerRendererState = {
  renderer: null,
  scene: null,
  camera: null,
  canvas: null,
  width: 1,
  height: 1,
  devicePixelRatio: 1,
  options: {},
  latestPreset: null,
  latestFrame: null,
};

function postMessage(message: RendererWorkerResponseMessage) {
  scope.postMessage(message);
}

function resolveEffectivePixelRatio({
  devicePixelRatio,
  renderScale = 1,
  maxPixelRatio = 1.5,
}: {
  devicePixelRatio: number;
  renderScale?: number;
  maxPixelRatio?: number;
}) {
  return Math.min(devicePixelRatio * renderScale, maxPixelRatio);
}

function applyRendererOptions(
  renderer: WebGPURenderer,
  {
    width,
    height,
    devicePixelRatio,
    options,
  }: {
    width: number;
    height: number;
    devicePixelRatio: number;
    options: Partial<RendererInitConfig>;
  },
) {
  renderer.setPixelRatio(
    resolveEffectivePixelRatio({
      devicePixelRatio,
      renderScale: options.renderScale,
      maxPixelRatio: options.maxPixelRatio,
    }),
  );
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = options.exposure ?? 1;
}

async function initRenderer({
  canvas,
  width,
  height,
  devicePixelRatio,
  options = {},
}: {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  devicePixelRatio: number;
  options?: Partial<RendererInitConfig>;
}) {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu?.requestAdapter) {
    throw new Error('WebGPU is unavailable inside the renderer worker.');
  }

  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new Error(
      'Unable to acquire a WebGPU adapter inside the renderer worker.',
    );
  }

  if (
    (
      adapter as GPUAdapter & {
        isFallbackAdapter?: boolean;
      }
    ).isFallbackAdapter
  ) {
    throw new Error(
      'Renderer worker rejected a fallback WebGPU adapter. Use the main-thread WebGL fallback instead.',
    );
  }

  const device = await adapter.requestDevice();
  const renderer = new WebGPURenderer({
    canvas,
    antialias: options.antialias ?? true,
    alpha: options.alpha ?? false,
    device,
  });
  if ('init' in renderer && typeof renderer.init === 'function') {
    await renderer.init();
  }

  const scene = new Scene();
  scene.background = new Color(0x05070d);
  const camera = new PerspectiveCamera(45, width / height, 0.1, 10);
  camera.position.z = 1;

  state.renderer = renderer;
  state.scene = scene;
  state.camera = camera;
  state.canvas = canvas;
  state.width = width;
  state.height = height;
  state.devicePixelRatio = devicePixelRatio;
  state.options = options;

  applyRendererOptions(renderer, {
    width,
    height,
    devicePixelRatio,
    options,
  });

  postMessage({
    type: RENDERER_WORKER_MESSAGE_TYPES.ready,
    payload: {
      backend: 'webgpu',
      width,
      height,
    },
  });
  postMessage({
    type: RENDERER_WORKER_MESSAGE_TYPES.status,
    payload: { phase: 'initialized' },
  });
}

function ensureRendererReady() {
  if (!state.renderer || !state.scene || !state.camera) {
    throw new Error(
      'Renderer worker received a message before initialization completed.',
    );
  }

  return {
    renderer: state.renderer,
    scene: state.scene,
    camera: state.camera,
  };
}

function handleResize({
  width,
  height,
  devicePixelRatio,
}: RendererWorkerResizePayload) {
  const { renderer, camera } = ensureRendererReady();
  state.width = width;
  state.height = height;
  state.devicePixelRatio = devicePixelRatio;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  applyRendererOptions(renderer, {
    width,
    height,
    devicePixelRatio,
    options: state.options,
  });
  postMessage({
    type: RENDERER_WORKER_MESSAGE_TYPES.status,
    payload: { phase: 'resized' },
  });
}

function handleQualityUpdate({
  runtimeControls,
  options = {},
}: RendererWorkerQualityPayload) {
  const { renderer } = ensureRendererReady();
  state.options = {
    ...state.options,
    ...options,
    renderScale:
      (options.renderScale ?? state.options.renderScale ?? 1) *
      runtimeControls.renderScale,
  };
  applyRendererOptions(renderer, {
    width: state.width,
    height: state.height,
    devicePixelRatio: state.devicePixelRatio,
    options: state.options,
  });
  postMessage({
    type: RENDERER_WORKER_MESSAGE_TYPES.status,
    payload: { phase: 'quality-updated' },
  });
}

function handlePreset(payload: RendererWorkerPresetPayload) {
  const { scene } = ensureRendererReady();
  state.latestPreset = payload;
  const titleHash = `${payload.id ?? ''}:${payload.title ?? ''}:${payload.source ?? ''}`;
  let accumulator = 0;
  for (let index = 0; index < titleHash.length; index += 1) {
    accumulator =
      (accumulator + titleHash.charCodeAt(index) * (index + 1)) % 255;
  }
  scene.background = new Color(
    accumulator / 255,
    Math.max(0.05, accumulator / 510),
    Math.max(0.1, 1 - accumulator / 320),
  );
  postMessage({
    type: RENDERER_WORKER_MESSAGE_TYPES.status,
    payload: { phase: 'preset-applied' },
  });
}

function handleFrame(payload: RendererWorkerFramePayload) {
  const { renderer, scene, camera } = ensureRendererReady();
  state.latestFrame = payload;

  const bass = payload.energy?.bass ?? payload.audioLevel ?? 0;
  const mids = payload.energy?.mids ?? 0;
  const treble = payload.energy?.treble ?? 0;
  const pointerX = payload.pointer?.x ?? 0.5;
  const pointerY = payload.pointer?.y ?? 0.5;

  scene.background = new Color(
    Math.min(1, 0.04 + bass * 0.65 + pointerX * 0.12),
    Math.min(1, 0.05 + mids * 0.55 + pointerY * 0.1),
    Math.min(1, 0.1 + treble * 0.65 + (payload.pointer?.down ? 0.1 : 0)),
  );

  renderer.render(scene, camera);
  postMessage({
    type: RENDERER_WORKER_MESSAGE_TYPES.status,
    payload: { phase: 'frame-submitted' },
  });
}

function disposeRenderer() {
  state.renderer?.dispose?.();
  state.renderer = null;
  state.scene = null;
  state.camera = null;
  state.canvas = null;
  state.latestPreset = null;
  state.latestFrame = null;
  postMessage({
    type: RENDERER_WORKER_MESSAGE_TYPES.status,
    payload: { phase: 'disposed' },
  });
}

scope.addEventListener(
  'message',
  async (event: MessageEvent<RendererWorkerRequestMessage>) => {
    try {
      switch (event.data.type) {
        case RENDERER_WORKER_MESSAGE_TYPES.init:
          await initRenderer(event.data.payload);
          break;
        case RENDERER_WORKER_MESSAGE_TYPES.resize:
          handleResize(event.data.payload);
          break;
        case RENDERER_WORKER_MESSAGE_TYPES.quality:
          handleQualityUpdate(event.data.payload);
          break;
        case RENDERER_WORKER_MESSAGE_TYPES.preset:
          handlePreset(event.data.payload);
          break;
        case RENDERER_WORKER_MESSAGE_TYPES.frame:
          handleFrame(event.data.payload);
          break;
        case RENDERER_WORKER_MESSAGE_TYPES.dispose:
          disposeRenderer();
          break;
        default:
          throw new Error('Renderer worker received an unknown message type.');
      }
    } catch (error) {
      postMessage({
        type: RENDERER_WORKER_MESSAGE_TYPES.error,
        payload: {
          message:
            error instanceof Error
              ? error.message
              : 'Unknown renderer worker failure.',
        },
      });
    }
  },
);
