import type { RendererRuntimeControls } from './renderer-settings.ts';
import type { RendererInitConfig } from './renderer-setup.ts';

export const RENDERER_WORKER_MESSAGE_TYPES = {
  init: 'renderer:init',
  resize: 'renderer:resize',
  quality: 'renderer:quality',
  preset: 'renderer:preset',
  frame: 'renderer:frame',
  dispose: 'renderer:dispose',
  ready: 'renderer:ready',
  status: 'renderer:status',
  error: 'renderer:error',
} as const;

export type RendererWorkerMessageType =
  (typeof RENDERER_WORKER_MESSAGE_TYPES)[keyof typeof RENDERER_WORKER_MESSAGE_TYPES];

export type RendererWorkerInitPayload = {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
  devicePixelRatio: number;
  options?: Partial<RendererInitConfig>;
};

export type RendererWorkerResizePayload = {
  width: number;
  height: number;
  devicePixelRatio: number;
};

export type RendererWorkerQualityPayload = {
  runtimeControls: RendererRuntimeControls;
  options?: Partial<RendererInitConfig>;
};

export type RendererWorkerPresetPayload = {
  id?: string | null;
  title?: string | null;
  source?: string | null;
};

export type RendererWorkerFramePayload = {
  now: number;
  deltaMs: number;
  audioLevel?: number;
  energy?: {
    bass?: number;
    mids?: number;
    treble?: number;
  };
  pointer?: {
    x?: number;
    y?: number;
    down?: boolean;
  };
};

export type RendererWorkerInitMessage = {
  type: typeof RENDERER_WORKER_MESSAGE_TYPES.init;
  payload: RendererWorkerInitPayload;
};

export type RendererWorkerResizeMessage = {
  type: typeof RENDERER_WORKER_MESSAGE_TYPES.resize;
  payload: RendererWorkerResizePayload;
};

export type RendererWorkerQualityMessage = {
  type: typeof RENDERER_WORKER_MESSAGE_TYPES.quality;
  payload: RendererWorkerQualityPayload;
};

export type RendererWorkerPresetMessage = {
  type: typeof RENDERER_WORKER_MESSAGE_TYPES.preset;
  payload: RendererWorkerPresetPayload;
};

export type RendererWorkerFrameMessage = {
  type: typeof RENDERER_WORKER_MESSAGE_TYPES.frame;
  payload: RendererWorkerFramePayload;
};

export type RendererWorkerDisposeMessage = {
  type: typeof RENDERER_WORKER_MESSAGE_TYPES.dispose;
};

export type RendererWorkerRequestMessage =
  | RendererWorkerInitMessage
  | RendererWorkerResizeMessage
  | RendererWorkerQualityMessage
  | RendererWorkerPresetMessage
  | RendererWorkerFrameMessage
  | RendererWorkerDisposeMessage;

export type RendererWorkerReadyMessage = {
  type: typeof RENDERER_WORKER_MESSAGE_TYPES.ready;
  payload: {
    backend: 'webgl' | 'webgpu';
    width: number;
    height: number;
  };
};

export type RendererWorkerStatusMessage = {
  type: typeof RENDERER_WORKER_MESSAGE_TYPES.status;
  payload: {
    phase:
      | 'initialized'
      | 'resized'
      | 'quality-updated'
      | 'preset-applied'
      | 'frame-submitted'
      | 'disposed';
  };
};

export type RendererWorkerErrorMessage = {
  type: typeof RENDERER_WORKER_MESSAGE_TYPES.error;
  payload: {
    message: string;
  };
};

export type RendererWorkerResponseMessage =
  | RendererWorkerReadyMessage
  | RendererWorkerStatusMessage
  | RendererWorkerErrorMessage;

export function isRendererWorkerResponseMessage(
  value: unknown,
): value is RendererWorkerResponseMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { type?: unknown };
  return (
    candidate.type === RENDERER_WORKER_MESSAGE_TYPES.ready ||
    candidate.type === RENDERER_WORKER_MESSAGE_TYPES.status ||
    candidate.type === RENDERER_WORKER_MESSAGE_TYPES.error
  );
}
