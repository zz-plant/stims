import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { RENDERER_WORKER_MESSAGE_TYPES } from '../assets/js/core/renderer-worker-protocol.ts';

const freshImport = async () =>
  import(
    `../assets/js/core/renderer-worker.ts?t=${Date.now()}-${Math.random()}`
  );

describe('renderer worker WebGPU safety', () => {
  const originalPostMessage = globalThis.postMessage;
  const originalAddEventListener = globalThis.addEventListener;
  const originalNavigator = global.navigator;

  let messageListener:
    | ((event: MessageEvent<unknown>) => void | Promise<void>)
    | null = null;

  beforeEach(() => {
    messageListener = null;
  });

  afterEach(() => {
    mock.restore();
    Object.defineProperty(globalThis, 'postMessage', {
      configurable: true,
      writable: true,
      value: originalPostMessage,
    });
    Object.defineProperty(globalThis, 'addEventListener', {
      configurable: true,
      writable: true,
      value: originalAddEventListener,
    });
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: originalNavigator,
    });
  });

  test('rejects fallback WebGPU adapters before requesting a device', async () => {
    const postMessage = mock();
    const requestDevice = mock(async () => ({ label: 'fallback-device' }));
    const requestAdapter = mock(async () => ({
      isFallbackAdapter: true,
      requestDevice,
    }));

    Object.defineProperty(globalThis, 'postMessage', {
      configurable: true,
      writable: true,
      value: postMessage,
    });
    Object.defineProperty(globalThis, 'addEventListener', {
      configurable: true,
      writable: true,
      value: mock(
        (
          type: string,
          listener: (event: MessageEvent<unknown>) => void | Promise<void>,
        ) => {
          if (type === 'message') {
            messageListener = listener;
          }
        },
      ),
    });
    Object.defineProperty(global, 'navigator', {
      writable: true,
      configurable: true,
      value: {
        gpu: {
          requestAdapter,
        },
      },
    });

    await freshImport();

    expect(messageListener).not.toBeNull();
    await messageListener?.({
      data: {
        type: RENDERER_WORKER_MESSAGE_TYPES.init,
        payload: {
          canvas: { marker: 'offscreen' } as unknown as OffscreenCanvas,
          width: 640,
          height: 360,
          devicePixelRatio: 2,
          options: {},
        },
      },
    } as MessageEvent<unknown>);

    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestDevice).toHaveBeenCalledTimes(0);
    expect(postMessage).toHaveBeenCalledWith({
      type: RENDERER_WORKER_MESSAGE_TYPES.error,
      payload: {
        message:
          'Renderer worker rejected a fallback WebGPU adapter. Use the main-thread WebGL fallback instead.',
      },
    });
  });
});
