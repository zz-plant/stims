/* global GPU */

import {
  ACESFilmicToneMapping,
  Color,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
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
  renderer: WebGLRenderer | WebGPURenderer | null;
  scene: Scene | null;
  camera: PerspectiveCamera | null;
  canvas: OffscreenCanvas | null;
  width: number;
  height: number;
  devicePixelRatio: number;
  options: Partial<RendererInitConfig>;
  latestPreset: RendererWorkerPresetPayload | null;
  latestFrame: RendererWorkerFramePayload | null;
  backend: 'webgl' | 'webgpu' | null;
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
  backend: null,
};

/** Reusable Color buffer to avoid per-frame heap allocations. */
const _reusableColor = new Color();

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
  renderer: WebGLRenderer | WebGPURenderer,
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

async function initWebGPURenderer({
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
}): Promise<
  { backend: 'webgpu'; success: true } | { success: false; error: string }
> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu?.requestAdapter) {
    return {
      success: false,
      error:
        'WebGPU is unavailable inside the renderer worker. Will attempt WebGL fallback.',
    };
  }

  let adapter: GPUAdapter | null = null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (_error) {
    return {
      success: false,
      error:
        'Unable to acquire a WebGPU adapter inside the renderer worker. Will attempt WebGL fallback.',
    };
  }
  if (!adapter) {
    return {
      success: false,
      error:
        'No WebGPU adapter available in the renderer worker. Will attempt WebGL fallback.',
    };
  }

  if (
    (
      adapter as GPUAdapter & {
        isFallbackAdapter?: boolean;
      }
    ).isFallbackAdapter
  ) {
    return {
      success: false,
      error:
        'Renderer worker rejected a fallback WebGPU adapter. Will attempt WebGL fallback.',
    };
  }

  let device: GPUDevice | null = null;
  try {
    device = await adapter.requestDevice();
  } catch (_error) {
    return {
      success: false,
      error:
        'Unable to acquire a WebGPU device in the renderer worker. Will attempt WebGL fallback.',
    };
  }

  try {
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
    state.backend = 'webgpu';

    applyRendererOptions(renderer, {
      width,
      height,
      devicePixelRatio,
      options,
    });

    return { backend: 'webgpu', success: true };
  } catch (_error) {
    return {
      success: false,
      error:
        'WebGPU renderer creation failed in the worker. Will attempt WebGL fallback.',
    };
  }
}

function initWebGLRenderer({
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
}): { backend: 'webgl'; success: true } | { success: false; error: string } {
  try {
    const glContext = canvas.getContext('webgl2', {
      antialias: options.antialias ?? true,
      alpha: options.alpha ?? false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
      stencil: true,
      preserveDrawingBuffer: false,
    }) as WebGL2RenderingContext | null;

    if (!glContext) {
      return {
        success: false,
        error: 'WebGL2 context is unavailable in the renderer worker.',
      };
    }

    const renderer = new WebGLRenderer({
      canvas,
      context: glContext,
      antialias: options.antialias ?? true,
      alpha: options.alpha ?? false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
      stencil: true,
      preserveDrawingBuffer: false,
    });

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
    state.backend = 'webgl';

    applyRendererOptions(renderer, {
      width,
      height,
      devicePixelRatio,
      options,
    });

    return { backend: 'webgl', success: true };
  } catch (_error) {
    return {
      success: false,
      error: 'Failed to initialize WebGL renderer in the worker.',
    };
  }
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
  // Attempt WebGPU first
  const webgpuResult = await initWebGPURenderer({
    canvas,
    width,
    height,
    devicePixelRatio,
    options,
  });

  if (webgpuResult.success) {
    postMessage({
      type: RENDERER_WORKER_MESSAGE_TYPES.ready,
      payload: {
        backend: webgpuResult.backend,
        width,
        height,
      },
    });
    postMessage({
      type: RENDERER_WORKER_MESSAGE_TYPES.status,
      payload: { phase: 'initialized' },
    });
    return;
  }

  // Fallback to WebGL
  console.info(
    `Renderer worker WebGPU init failed: ${webgpuResult.error} Falling back to WebGL.`,
  );

  const webglResult = initWebGLRenderer({
    canvas,
    width,
    height,
    devicePixelRatio,
    options,
  });

  if (webglResult.success) {
    postMessage({
      type: RENDERER_WORKER_MESSAGE_TYPES.ready,
      payload: {
        backend: webglResult.backend,
        width,
        height,
      },
    });
    postMessage({
      type: RENDERER_WORKER_MESSAGE_TYPES.status,
      payload: { phase: 'initialized' },
    });
    return;
  }

  throw new Error(
    `Renderer worker failed to initialize with either backend. WebGPU error: ${webgpuResult.error}. WebGL error: ${webglResult.error}`,
  );
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
    backend: state.backend as 'webgl' | 'webgpu',
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
  _reusableColor.set(
    accumulator / 255,
    Math.max(0.05, accumulator / 510),
    Math.max(0.1, 1 - accumulator / 320),
  );
  scene.background = _reusableColor;
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

  _reusableColor.set(
    Math.min(1, 0.04 + bass * 0.65 + pointerX * 0.12),
    Math.min(1, 0.05 + mids * 0.55 + pointerY * 0.1),
    Math.min(1, 0.1 + treble * 0.65 + (payload.pointer?.down ? 0.1 : 0)),
  );
  scene.background = _reusableColor;

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
