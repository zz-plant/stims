import { describe, expect, test } from 'bun:test';
import {
  isRendererWorkerResponseMessage,
  RENDERER_WORKER_MESSAGE_TYPES,
} from '../../src/js/core/renderer-worker-protocol.ts';

describe('renderer-worker-protocol', () => {
  test('defines message types for lifecycle, frame pacing, and responses', () => {
    expect(RENDERER_WORKER_MESSAGE_TYPES.init).toBe('renderer:init');
    expect(RENDERER_WORKER_MESSAGE_TYPES.resize).toBe('renderer:resize');
    expect(RENDERER_WORKER_MESSAGE_TYPES.frame).toBe('renderer:frame');
    expect(RENDERER_WORKER_MESSAGE_TYPES.ready).toBe('renderer:ready');
    expect(RENDERER_WORKER_MESSAGE_TYPES.status).toBe('renderer:status');
    expect(RENDERER_WORKER_MESSAGE_TYPES.error).toBe('renderer:error');
  });

  test('isRendererWorkerResponseMessage validates worker responses', () => {
    expect(isRendererWorkerResponseMessage(null)).toBe(false);
    expect(isRendererWorkerResponseMessage(undefined)).toBe(false);
    expect(isRendererWorkerResponseMessage({})).toBe(false);
    expect(
      isRendererWorkerResponseMessage({
        type: 'renderer:ready',
        payload: { backend: 'webgl', width: 800, height: 600 },
      }),
    ).toBe(true);
    expect(
      isRendererWorkerResponseMessage({
        type: 'renderer:status',
        payload: { phase: 'initialized' },
      }),
    ).toBe(true);
    expect(
      isRendererWorkerResponseMessage({
        type: 'renderer:error',
        payload: { message: 'WebGPU device creation timeout' },
      }),
    ).toBe(true);
    expect(
      isRendererWorkerResponseMessage({
        type: 'renderer:unknown',
      }),
    ).toBe(false);
  });
});
