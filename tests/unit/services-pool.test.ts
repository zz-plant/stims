import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type {
  Audio,
  AudioListener,
  PositionalAudio,
  WebGLRenderer,
} from 'three';
import type { FrequencyAnalyser } from '../../src/js/core/audio-handler.ts';
import { DEFAULT_MICROPHONE_CONSTRAINTS } from '../../src/js/core/audio-handler.ts';
import type {
  RendererInitConfig,
  RendererInitResult,
} from '../../src/js/core/renderer-setup.ts';
import {
  acquireAudioHandle,
  resetAudioPool,
} from '../../src/js/core/services/audio-service.ts';
import type {
  getRendererRuntimeControls as getControlsType,
  requestRenderer as requestType,
  resetRendererPool as resetPoolType,
  setRendererRuntimeControls as setControlsType,
  setMaxIdleRenderers as setMaxIdleRenderersType,
  subscribeToRendererRuntimeControls as subscribeType,
} from '../../src/js/core/services/render-service.ts';
import { resetSettingsPanelState } from '../../src/js/core/settings-panel.ts';
import { setQualityPresetById } from '../../src/js/core/state/quality-preset-store.ts';
import { resetRenderPreferenceStore } from '../../src/js/core/state/render-preference-store.ts';
import { flushTasks, importFresh } from '../test-helpers.ts';

let getRendererRuntimeControls: typeof getControlsType;
let requestRenderer: typeof requestType;
let resetRendererPool: typeof resetPoolType;
let setMaxIdleRenderers: typeof setMaxIdleRenderersType;
let setRendererRuntimeControls: typeof setControlsType;
let subscribeToRendererRuntimeControls: typeof subscribeType;

describe('render-service pooling', () => {
  let originalConcurrency: number | undefined;

  beforeEach(async () => {
    window.localStorage.clear();
    resetRenderPreferenceStore();
    resetSettingsPanelState();
    delete (window as unknown as { __stims_webgpu_performance_tier?: string })
      .__stims_webgpu_performance_tier;
    try {
      window.sessionStorage?.removeItem('stims:webgpu-performance-tier');
    } catch {}

    originalConcurrency = navigator.hardwareConcurrency;
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      value: 4,
      configurable: true,
    });

    const renderService = await importFresh<
      typeof import('../../src/js/core/services/render-service.ts')
    >('../../src/js/core/services/render-service.ts');
    getRendererRuntimeControls = renderService.getRendererRuntimeControls;
    requestRenderer = renderService.requestRenderer;
    resetRendererPool = renderService.resetRendererPool;
    setMaxIdleRenderers = renderService.setMaxIdleRenderers;
    setRendererRuntimeControls = renderService.setRendererRuntimeControls;
    subscribeToRendererRuntimeControls =
      renderService.subscribeToRendererRuntimeControls;

    resetRendererPool({ dispose: true });
  });

  const setPixelRatioMock = mock();
  const setSizeMock = mock();
  const fakeRenderer = {
    setPixelRatio: setPixelRatioMock,
    setSize: setSizeMock,
    setAnimationLoop: mock(),
    dispose: mock(),
    toneMappingExposure: 1,
  } as unknown as WebGLRenderer;

  afterEach(() => {
    setPixelRatioMock.mockReset();
    setSizeMock.mockReset();
    document.body.innerHTML = '';
    window.localStorage.clear();
    resetRenderPreferenceStore();
    resetSettingsPanelState();
    if (resetRendererPool) {
      resetRendererPool({ dispose: true });
    }
    delete (window as unknown as { __stims_webgpu_performance_tier?: string })
      .__stims_webgpu_performance_tier;
    try {
      window.sessionStorage?.removeItem('stims:webgpu-performance-tier');
    } catch {}
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 1,
    });
    if (originalConcurrency !== undefined) {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        value: originalConcurrency,
        configurable: true,
      });
    }
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
      adaptiveMaxPixelRatioMultiplier: 1,
      adaptiveRenderScaleMultiplier: 1,
      adaptiveDensityMultiplier: 1,
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

  test('bounds idle renderers across repeated concurrent acquire and release cycles', async () => {
    setMaxIdleRenderers(2);
    const renderers: Array<{
      setAnimationLoop: ReturnType<typeof mock>;
      dispose: ReturnType<typeof mock>;
    }> = [];
    const initRendererImpl = mock(async () => {
      const renderer = {
        setPixelRatio: mock(),
        setSize: mock(),
        setAnimationLoop: mock(),
        dispose: mock(),
        toneMappingExposure: 1,
      };
      renderers.push(renderer);
      return {
        renderer: renderer as unknown as WebGLRenderer,
        backend: 'webgl' as const,
        adapter: null,
        device: null,
        maxPixelRatio: 2,
        renderScale: 1,
        adaptiveMaxPixelRatioMultiplier: 1,
        adaptiveRenderScaleMultiplier: 1,
        adaptiveDensityMultiplier: 1,
        exposure: 1,
      };
    });

    const firstCycle = await Promise.all(
      Array.from({ length: 5 }, () => requestRenderer({ initRendererImpl })),
    );
    firstCycle[0].release();
    firstCycle[1].release();
    firstCycle[2].release();

    expect(renderers[0].dispose).toHaveBeenCalledTimes(1);
    expect(renderers[1].dispose).toHaveBeenCalledTimes(0);
    expect(renderers[2].dispose).toHaveBeenCalledTimes(0);
    // Renderers that remain checked out must never be candidates for eviction.
    expect(renderers[3].dispose).toHaveBeenCalledTimes(0);
    expect(renderers[4].dispose).toHaveBeenCalledTimes(0);

    firstCycle[3].release();
    firstCycle[4].release();
    expect(
      renderers.filter((renderer) => renderer.dispose.mock.calls.length === 0),
    ).toHaveLength(2);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const handles = await Promise.all(
        Array.from({ length: 4 }, () => requestRenderer({ initRendererImpl })),
      );
      handles.forEach((handle) => handle.release());
      expect(
        renderers.filter(
          (renderer) => renderer.dispose.mock.calls.length === 0,
        ),
      ).toHaveLength(2);
    }

    for (const renderer of renderers.filter(
      (candidate) => candidate.dispose.mock.calls.length > 0,
    )) {
      expect(renderer.setAnimationLoop).toHaveBeenCalledWith(null);
    }
  });

  test('shares runtime optimization controls through the render service', async () => {
    const updates = mock();
    const unsubscribe = subscribeToRendererRuntimeControls(updates);

    expect(updates).toHaveBeenCalledWith({
      renderScale: 1,
      feedbackScale: 1,
      meshDensityMultiplier: 1,
      waveSampleMultiplier: 1,
      motionVectorDensityMultiplier: 1,
    });

    const next = setRendererRuntimeControls({
      feedbackScale: 0.75,
      meshDensityMultiplier: 1.25,
    });

    expect(next).toEqual({
      renderScale: 1,
      feedbackScale: 0.75,
      meshDensityMultiplier: 1.25,
      waveSampleMultiplier: 1,
      motionVectorDensityMultiplier: 1,
    });
    expect(getRendererRuntimeControls()).toEqual(next);

    unsubscribe();
  });

  test('applies runtime renderScale overrides to new and pooled renderers', async () => {
    const initRendererImpl = mock(
      async (_canvas: HTMLCanvasElement, _config: RendererInitConfig = {}) => ({
        renderer: fakeRenderer,
        backend: 'webgl' as const,
        adapter: null,
        device: null,
        maxPixelRatio: 2,
        renderScale: 1,
        adaptiveMaxPixelRatioMultiplier: 1,
        adaptiveRenderScaleMultiplier: 1,
        adaptiveDensityMultiplier: 1,
        exposure: 1,
      }),
    );

    // Init renderScale is runtimeControls.renderScale × quality renderScale.
    // Pin a preset with renderScale 1 so this test isolates the runtime factor
    // from the device-tier default (balanced is 0.85).
    setQualityPresetById('hi-fi');
    setRendererRuntimeControls({ renderScale: 0.5 });

    const first = await requestRenderer({ initRendererImpl });
    const firstInitCall = initRendererImpl.mock.calls[0] as unknown as
      | [HTMLCanvasElement, { renderScale?: number }]
      | undefined;

    expect(firstInitCall?.[0]).toBe(first.canvas);
    expect(firstInitCall?.[1]).toMatchObject({
      renderScale: 0.5,
    });

    first.release();
    setPixelRatioMock.mockClear();

    const second = await requestRenderer({ initRendererImpl });

    expect(second).toBe(first);
    expect(setPixelRatioMock).toHaveBeenCalled();

    setRendererRuntimeControls({ renderScale: 0.25 });

    expect(setPixelRatioMock).toHaveBeenLastCalledWith(0.4);
  });

  test('preserves active renderer overrides when runtime controls reapply', async () => {
    const initRendererImpl = mock(async () => ({
      renderer: fakeRenderer,
      backend: 'webgl' as const,
      adapter: null,
      device: null,
      maxPixelRatio: 2,
      renderScale: 1,
      adaptiveMaxPixelRatioMultiplier: 1,
      adaptiveRenderScaleMultiplier: 1,
      adaptiveDensityMultiplier: 1,
      exposure: 1,
    }));

    const handle = await requestRenderer({
      initRendererImpl,
      options: { maxPixelRatio: 0.75, renderScale: 1 },
    });

    setPixelRatioMock.mockClear();
    setRendererRuntimeControls({ renderScale: 0.9 });

    expect(handle.getRuntimeControls()).toEqual({
      renderScale: 0.9,
      feedbackScale: 1,
      meshDensityMultiplier: 1,
      waveSampleMultiplier: 1,
      motionVectorDensityMultiplier: 1,
    });
    expect(setPixelRatioMock).toHaveBeenLastCalledWith(0.75);
  });

  test('keeps the active webgpu renderer stable across animation frames', async () => {
    const originalRequestAnimationFrame = window.requestAnimationFrame;
    const originalCancelAnimationFrame = window.cancelAnimationFrame;
    const originalGlobalRequestAnimationFrame =
      globalThis.requestAnimationFrame;
    const originalGlobalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    let nextAnimationFrameId = 1;
    let pendingFrames = new Map<number, FrameRequestCallback>();

    try {
      const requestAnimationFrameMock = ((callback: FrameRequestCallback) => {
        const frameId = nextAnimationFrameId;
        nextAnimationFrameId += 1;
        pendingFrames.set(frameId, callback);
        return frameId;
      }) as typeof window.requestAnimationFrame;
      const cancelAnimationFrameMock = ((frameId: number) => {
        pendingFrames.delete(frameId);
      }) as typeof window.cancelAnimationFrame;

      window.requestAnimationFrame = requestAnimationFrameMock;
      window.cancelAnimationFrame = cancelAnimationFrameMock;
      globalThis.requestAnimationFrame = requestAnimationFrameMock;
      globalThis.cancelAnimationFrame = cancelAnimationFrameMock;

      const flushFrame = async (time: number) => {
        const queuedFrames = [...pendingFrames.values()];
        pendingFrames = new Map();
        queuedFrames.forEach((callback) => callback(time));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      };
      const waitForScheduledFrame = async () => {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          if (pendingFrames.size > 0) {
            return;
          }
          await Promise.resolve();
        }
      };

      const stableRenderer = {
        setPixelRatio: mock(),
        setSize: mock(),
        setAnimationLoop: mock(),
        render: mock(),
        dispose: mock(),
        toneMappingExposure: 1,
      } as unknown as WebGLRenderer;
      const initRendererImpl = mock(async () => ({
        renderer: stableRenderer,
        backend: 'webgpu' as const,
        adapter: null,
        device: null,
        maxPixelRatio: 1.75,
        renderScale: 1,
        adaptiveMaxPixelRatioMultiplier: 1,
        adaptiveRenderScaleMultiplier: 1,
        adaptiveDensityMultiplier: 1,
        exposure: 1,
      }));

      const handle = await requestRenderer({ initRendererImpl });
      const frameCallback = mock(() => {
        handle.renderer.render({} as never, {} as never);
      });

      expect(initRendererImpl).toHaveBeenCalledTimes(1);
      expect(handle.renderer).not.toBe(stableRenderer);

      handle.renderer.setAnimationLoop?.(frameCallback);
      await waitForScheduledFrame();
      await flushFrame(16);
      await waitForScheduledFrame();
      await flushFrame(32);
      await Promise.resolve();
      await Promise.resolve();

      expect(initRendererImpl).toHaveBeenCalledTimes(1);
      expect(stableRenderer.dispose).toHaveBeenCalledTimes(0);
      expect(stableRenderer.render).toHaveBeenCalledTimes(2);
      expect(frameCallback).toHaveBeenCalledTimes(2);

      handle.renderer.setAnimationLoop?.(null);
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame;
      window.cancelAnimationFrame = originalCancelAnimationFrame;
      globalThis.requestAnimationFrame = originalGlobalRequestAnimationFrame;
      globalThis.cancelAnimationFrame = originalGlobalCancelAnimationFrame;
    }
  });

  test('recovers the active webgpu renderer after device loss', async () => {
    const originalConsoleWarn = console.warn;
    const consoleWarn = mock(() => {});
    console.warn = consoleWarn;

    try {
      let resolveLost: ((value: { message: string }) => void) | undefined;
      const lost = new Promise<{ message: string }>((resolve) => {
        resolveLost = resolve;
      });

      const firstRenderer = {
        setPixelRatio: mock(),
        setSize: mock(),
        setAnimationLoop: mock(),
        render: mock(),
        dispose: mock(),
        toneMappingExposure: 1,
      } as unknown as WebGLRenderer;
      const secondRenderer = {
        setPixelRatio: mock(),
        setSize: mock(),
        setAnimationLoop: mock(),
        render: mock(),
        dispose: mock(),
        toneMappingExposure: 1,
      } as unknown as WebGLRenderer;
      const initResults: RendererInitResult[] = [
        {
          renderer: firstRenderer,
          backend: 'webgpu' as const,
          adapter: {
            requestDevice: mock(async () => ({ label: 'first-next' })),
          } as unknown as GPUAdapter,
          device: { lost } as unknown as GPUDevice,
          maxPixelRatio: 1.75,
          renderScale: 1,
          adaptiveMaxPixelRatioMultiplier: 1,
          adaptiveRenderScaleMultiplier: 1,
          adaptiveDensityMultiplier: 1,
          exposure: 1,
        },
        {
          renderer: secondRenderer,
          backend: 'webgpu' as const,
          adapter: {
            requestDevice: mock(async () => ({ label: 'second-next' })),
          } as unknown as GPUAdapter,
          device: {
            lost: new Promise(() => {}),
          } as unknown as GPUDevice,
          maxPixelRatio: 1.75,
          renderScale: 1,
          adaptiveMaxPixelRatioMultiplier: 1,
          adaptiveRenderScaleMultiplier: 1,
          adaptiveDensityMultiplier: 1,
          exposure: 1,
        },
      ];
      const initRendererImpl = mock(async () => initResults.shift() ?? null);

      const handle = await requestRenderer({ initRendererImpl });
      expect(initRendererImpl).toHaveBeenCalledTimes(1);
      const triggerLost = resolveLost;
      triggerLost?.({ message: 'mock device loss' });
      // Recovery waits out a ~100ms retry cooldown; poll for the re-init
      // instead of sleeping a fixed padded interval.
      const recoveryStart = performance.now();
      while (
        initRendererImpl.mock.calls.length < 2 &&
        performance.now() - recoveryStart < 2000
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await flushTasks(4);

      handle.renderer.render({} as never, {} as never);

      expect(initRendererImpl).toHaveBeenCalledTimes(2);
      expect(firstRenderer.dispose).toHaveBeenCalledTimes(1);
      expect(secondRenderer.render).toHaveBeenCalledTimes(1);
      expect(handle.backend).toBe('webgpu');
    } finally {
      console.warn = originalConsoleWarn;
    }
  });
});

describe('audio-service pooling', () => {
  const trackStop = mock();

  afterEach(async () => {
    trackStop.mockReset();
    delete (globalThis.navigator as { mediaDevices?: MediaDevices })
      .mediaDevices;
    await resetAudioPool({ stopStreams: true });
  });

  test('shares pooled microphone while active and keeps it warm between toys', async () => {
    const fakeStream = {
      getTracks: () => [{ stop: trackStop }],
      getAudioTracks: () => [
        { readyState: 'live', addEventListener: () => {} },
      ],
    } as unknown as MediaStream;

    const mediaDevices = { getUserMedia: mock(async () => fakeStream) };
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: mediaDevices,
    });

    const initAudioImpl = mock(async ({ stream }) => ({
      analyser: {} as FrequencyAnalyser,
      listener: { context: { close: mock() } } as unknown as AudioListener,
      audio: {} as Audio | PositionalAudio,
      stream,
      cleanup: () => {},
      permissionState: 'granted' as PermissionState,
    }));

    const first = await acquireAudioHandle({ initAudioImpl });
    const second = await acquireAudioHandle({ initAudioImpl });

    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith(
      DEFAULT_MICROPHONE_CONSTRAINTS,
    );
    expect(first.stream).toBe(second.stream);

    second.release();
    expect(trackStop).not.toHaveBeenCalled();

    first.release();
    expect(trackStop).not.toHaveBeenCalled();

    const third = await acquireAudioHandle({ initAudioImpl });
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
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
      analyser: {} as FrequencyAnalyser,
      listener: { context: { close: mock() } } as unknown as AudioListener,
      audio: {} as Audio | PositionalAudio,
      stream,
      cleanup: () => {
        if (stopStreamOnCleanup && stream) {
          stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        }
      },
      permissionState: 'granted' as PermissionState,
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
      analyser: {} as FrequencyAnalyser,
      listener: { context: { close: mock() } } as unknown as AudioListener,
      audio: {} as Audio | PositionalAudio,
      stream,
      cleanup: () => {},
      permissionState: 'granted' as PermissionState,
    }));

    const handle = await acquireAudioHandle({
      initAudioImpl,
      teardownOnRelease: true,
    });
    handle.release();

    expect(trackStop).toHaveBeenCalledTimes(1);

    const next = await acquireAudioHandle({ initAudioImpl });
    expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    next.release();
  });

  test('stops a permission-requested stream when it is passed directly', async () => {
    trackStop.mockReset();
    const fakeStream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream;

    const initAudioImpl = mock(async ({ stream, stopStreamOnCleanup }) => ({
      analyser: {} as FrequencyAnalyser,
      listener: { context: { close: mock() } } as unknown as AudioListener,
      audio: {} as Audio | PositionalAudio,
      stream,
      cleanup: () => {
        if (stopStreamOnCleanup && stream) {
          stream.getTracks().forEach((track: MediaStreamTrack) => track.stop());
        }
      },
      permissionState: 'granted' as PermissionState,
    }));

    const handle = await acquireAudioHandle({
      stream: fakeStream,
      stopStreamOnCleanup: true,
      initAudioImpl,
    });

    expect(initAudioImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: fakeStream,
        closeContextOnCleanup: false,
        stopStreamOnCleanup: true,
      }),
    );
    handle.release();

    expect(trackStop).toHaveBeenCalledTimes(1);
  });

  test('audio handle release is idempotent', async () => {
    const cleanup = mock();
    trackStop.mockReset();
    const fakeStream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream;

    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: { getUserMedia: mock(async () => fakeStream) },
    });

    const initAudioImpl = mock(async ({ stream }) => ({
      analyser: {} as FrequencyAnalyser,
      listener: { context: { close: mock() } } as unknown as AudioListener,
      audio: {} as Audio | PositionalAudio,
      stream,
      cleanup,
      permissionState: 'granted' as PermissionState,
    }));

    const handle = await acquireAudioHandle({
      initAudioImpl,
      teardownOnRelease: true,
    });
    handle.release();
    handle.release();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalledTimes(1);
  });
});
