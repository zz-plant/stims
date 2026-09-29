import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * The idle preview loop and the audio-driven loop are two frame drivers for
 * one plugin pipeline. `resumePreview()` is called by the shell on every
 * preset load, so it must not start the idle loop on top of a live audio
 * loop — that ran every frame twice with two different signals, doubling
 * frame cost and leaking GPU buffers for the rest of the session.
 */

type Animate = (ctx: {
  toy: unknown;
  analyser: unknown;
  time: number;
  realTimeMs: number;
}) => void;

const fakeAnalyser = {
  getRmsLevel: () => 0,
  getWaveformData: () => new Uint8Array(8),
};

let audioAnimate: Animate | null = null;

mock.module('../../src/js/core/web-toy', () => ({
  default: class FakeWebToy {
    renderer = {
      setAnimationLoop: mock(() => {}),
    };
    updateRendererSettings() {}
    stopAudio() {}
    dispose() {}
  },
}));

mock.module('../../src/js/core/toy-audio', () => ({
  startToyAudio: async (toy: unknown, animate: Animate) => {
    audioAnimate = animate;
    return { toy, analyser: fakeAnalyser, time: 0, realTimeMs: 0 };
  },
  resolveToyAudioOptions: () => ({}),
}));

mock.module('../../src/js/core/animation-loop', () => ({
  getContextFrequencyData: () => new Uint8Array(8),
  virtualTimeSource: null,
}));

const freshImport = async () =>
  import(`../../src/js/core/toy-runtime.ts?ts=${Date.now()}-${Math.random()}`);

describe('toy runtime preview loop', () => {
  const rafCallbacks: Array<FrameRequestCallback> = [];
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCaf = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    rafCallbacks.length = 0;
    audioAnimate = null;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    }) as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCaf;
  });

  const pumpIdleFrames = (count: number) => {
    for (let i = 0; i < count; i += 1) {
      const pending = rafCallbacks.splice(0, rafCallbacks.length);
      for (const cb of pending) cb(performance.now() + i * 16.7);
    }
  };

  test('resumePreview does not start the idle loop while audio drives frames', async () => {
    const { createToyRuntime } = await freshImport();
    const update = mock((_frame: { analyser: unknown }) => {});
    const runtime = createToyRuntime({
      container: document.createElement('div'),
      performance: { applyRendererSettings: false },
      plugins: [{ update }],
    });

    await runtime.startAudio();
    expect(audioAnimate).not.toBeNull();
    rafCallbacks.length = 0;
    update.mockClear();

    // What the shell does on every preset load.
    runtime.resumePreview?.();

    // Only the audio callback should be advancing the pipeline.
    audioAnimate?.({
      toy: {},
      analyser: fakeAnalyser,
      time: 1,
      realTimeMs: 1000,
    });
    pumpIdleFrames(3);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toMatchObject({ analyser: fakeAnalyser });
  });

  test('resumePreview restarts the idle loop once audio has stopped', async () => {
    const { createToyRuntime } = await freshImport();
    const update = mock((_frame: { analyser: unknown }) => {});
    const runtime = createToyRuntime({
      container: document.createElement('div'),
      performance: { applyRendererSettings: false },
      plugins: [{ update }],
    });

    await runtime.startAudio();
    runtime.stopAudio();
    runtime.pausePreview?.();
    rafCallbacks.length = 0;
    update.mockClear();

    runtime.resumePreview?.();
    pumpIdleFrames(3);

    expect(update.mock.calls.length).toBeGreaterThan(0);
    expect(update.mock.calls[0]?.[0]).toMatchObject({ analyser: null });
  });

  test('a held stage renders nothing until stepped, then exactly one frame per step', async () => {
    const { createToyRuntime } = await freshImport();
    const update = mock((_frame: { analyser: unknown }) => {});
    const runtime = createToyRuntime({
      container: document.createElement('div'),
      performance: { applyRendererSettings: false },
      plugins: [{ update }],
    });
    await runtime.startAudio();
    update.mockClear();
    const tick = (time: number) =>
      audioAnimate?.({
        toy: {},
        analyser: fakeAnalyser,
        time,
        realTimeMs: time * 1000,
      });

    expect(runtime.stepHeldFrame?.()).toBe(false);
    runtime.setFrameHold?.(true);
    tick(1);
    tick(1.02);
    expect(update).toHaveBeenCalledTimes(0);

    expect(runtime.stepHeldFrame?.()).toBe(true);
    tick(1.04);
    tick(1.06);
    tick(1.08);
    expect(update).toHaveBeenCalledTimes(1);

    // A burst of clicks queues a few frames, not an unbounded run.
    for (let i = 0; i < 20; i += 1) runtime.stepHeldFrame?.();
    for (let i = 0; i < 20; i += 1) tick(1.1 + i * 0.02);
    expect(update.mock.calls.length).toBeLessThanOrEqual(1 + 4);

    // Releasing drops anything still queued and resumes normal frames.
    runtime.stepHeldFrame?.();
    runtime.setFrameHold?.(false);
    update.mockClear();
    tick(2);
    tick(2.02);
    expect(update).toHaveBeenCalledTimes(2);

    // Steps queued before a release do not leak into the next hold.
    runtime.setFrameHold?.(true);
    runtime.stepHeldFrame?.();
    runtime.stepHeldFrame?.();
    runtime.setFrameHold?.(false);
    runtime.setFrameHold?.(true);
    update.mockClear();
    tick(3);
    tick(3.02);
    expect(update).toHaveBeenCalledTimes(0);
  });
});
