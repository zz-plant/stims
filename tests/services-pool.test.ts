import { afterEach, describe, expect, mock, test } from 'bun:test';
import { requestRenderer, resetRendererPool } from '../assets/js/core/services/render-service.ts';
import { acquireAudioHandle, resetAudioPool } from '../assets/js/core/services/audio-service.ts';

describe('render-service pooling', () => {
  const fakeRenderer = {
    setPixelRatio: mock(),
    setSize: mock(),
    setAnimationLoop: mock(),
    dispose: mock(),
    toneMappingExposure: 1,
  };

  afterEach(() => {
    document.body.innerHTML = '';
    resetRendererPool({ dispose: true });
  });

  test('reuses renderer handle between toys', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const initRendererImpl = mock(async () => ({
      renderer: fakeRenderer,
      backend: 'webgl' as const,
      adapter: null,
      device: null,
      maxPixelRatio: 2,
      renderScale: 1,
      exposure: 1,
    }));

    const first = await requestRenderer({ host, initRendererImpl });
    first.release();

    const second = await requestRenderer({ host, initRendererImpl });

    expect(first.renderer).toBe(second.renderer);
    expect(first.canvas).toBe(second.canvas);
    expect(host.contains(second.canvas)).toBe(true);
    expect(initRendererImpl).toHaveBeenCalledTimes(1);
  });
});

describe('audio-service pooling', () => {
  const trackStop = mock();

  afterEach(async () => {
    trackStop.mockReset();
    delete (globalThis.navigator as { mediaDevices?: MediaDevices }).mediaDevices;
    await resetAudioPool({ stopStreams: true });
  });

  test('shares pooled microphone while active and tears down when idle', async () => {
    const fakeStream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream;

    const mediaDevices = { getUserMedia: mock(async () => fakeStream) };
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: mediaDevices,
    });

    const initAudioImpl = mock(async ({ stream }) => ({
      analyser: {} as unknown as AnalyserNode,
      listener: { context: { close: mock() } },
      audio: {},
      stream,
      cleanup: () => {},
    }));

    const first = await acquireAudioHandle({ initAudioImpl });
    const second = await acquireAudioHandle({ initAudioImpl });

    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(first.stream).toBe(second.stream);

    second.release();
    expect(trackStop).not.toHaveBeenCalled();

    first.release();
    expect(trackStop).toHaveBeenCalledTimes(1);

    const third = await acquireAudioHandle({ initAudioImpl });
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    third.release();
  });

  test('stops pooled stream on reset for navigation cleanup', async () => {
    const fakeStream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream;

    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: { getUserMedia: mock(async () => fakeStream) },
    });

    const initAudioImpl = mock(async ({ stream, stopStreamOnCleanup }) => ({
      analyser: {} as unknown as AnalyserNode,
      listener: { context: { close: mock() } },
      audio: {},
      stream,
      cleanup: () => {
        if (stopStreamOnCleanup && stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
      },
    }));

    const handle = await acquireAudioHandle({ initAudioImpl });
    handle.release();

    await resetAudioPool({ stopStreams: true });

    expect(trackStop).toHaveBeenCalled();
  });

  test('optionally tears down pooled stream on release', async () => {
    const fakeStream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream;

    const mediaDevices = { getUserMedia: mock(async () => fakeStream) };
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: mediaDevices,
    });

    const initAudioImpl = mock(async ({ stream }) => ({
      analyser: {} as unknown as AnalyserNode,
      listener: { context: { close: mock() } },
      audio: {},
      stream,
      cleanup: () => {},
    }));

    const handle = await acquireAudioHandle({ initAudioImpl, teardownOnRelease: true });
    handle.release();

    expect(trackStop).toHaveBeenCalledTimes(1);

    const next = await acquireAudioHandle({ initAudioImpl });
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    next.release();
  });
});
