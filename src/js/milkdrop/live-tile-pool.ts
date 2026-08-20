// Live tile pool: runs a bounded set of real MilkDrop pipelines at micro
// resolution (one canvas + WebGL context each) so catalog tiles can show the
// actual preset, animated, instead of a static preview frame.
//
// Validated by the tile-lab experiment (see docs in memory + tests/manual/tile-lab.html):
// GL cost per tile is ~0.5ms; the budget is CPU vm.step (~2ms for classic
// presets after the invisible-motion-vector fix), so a pool of ~10 tiles
// stepping at ~15fps fits comfortably on the main thread. Browsers cap live
// WebGL contexts (~16 per page), which is what `maxEngines` really guards.
//
// The pool is framework-free. React integration lives in
// src/js/frontend/hooks/use-live-preset-tile.ts.

import { Scene, WebGLRenderer } from 'three';
import { initCamera } from '../core/camera-setup.ts';
import {
  createMilkdropPostprocessingComposer,
  type PostprocessingPipeline,
  shouldRenderMilkdropPostprocessing,
} from '../core/postprocessing.ts';
import { compileMilkdropPresetSource } from './compiler.ts';
import { createMilkdropRendererAdapter } from './renderer-adapter-factory.ts';
import { createMilkdropSignalTracker } from './runtime-signals.ts';
import type { MilkdropRuntimeSignals } from './types.ts';
import { createMilkdropVM } from './vm.ts';

const SPECTRUM_BINS = 128;

export type MilkdropLiveTileAudioFrame = {
  time: number;
  deltaMs: number;
  frequencyData: Uint8Array;
  waveformData: Uint8Array;
};

export type MilkdropLiveTileEngine = {
  step: (frame: MilkdropLiveTileAudioFrame) => void;
  dispose: () => void;
};

export type MilkdropLiveTileEngineFactory = (init: {
  canvas: HTMLCanvasElement;
  presetId: string;
  raw: string;
  tileSize: number;
}) => MilkdropLiveTileEngine;

export type MilkdropLiveTileStatus =
  | 'queued'
  | 'booting'
  | 'live'
  | 'failed'
  | 'released';

export type MilkdropLiveTileHandle = {
  presetId: string;
  canvas: HTMLCanvasElement;
  getStatus: () => MilkdropLiveTileStatus;
  release: () => void;
};

export type MilkdropLiveTilePoolOptions = {
  loadPresetRaw: (id: string) => Promise<string | null>;
  /** Real analyser arrays when audio is playing; null falls back to the
   * synthetic pulse. */
  audioProvider?: () => {
    frequencyData: Uint8Array;
    waveformData: Uint8Array;
  } | null;
  /** 0..1-ish scalar that modulates the synthetic pulse so idle tiles still
   * follow the room's energy (engine-audio-energy-store on the React side). */
  energyProvider?: () => number;
  maxEngines?: number;
  /**
   * Optional live capacity signal (e.g. from the adaptive quality
   * controller). Sampled on each boot/evict decision; the effective engine
   * cap is min(maxEngines, capacityProvider()), floored at 1, so the tile
   * pool sheds engines instead of competing with a struggling stage.
   */
  capacityProvider?: () => number;
  tileSize?: number;
  stepIntervalMs?: number;
  /** Stepping budget per scheduler tick, so a burst of due tiles cannot eat
   * a whole main-thread frame. */
  maxStepMsPerTick?: number;
  createEngine?: MilkdropLiveTileEngineFactory;
  scheduleFrame?: (cb: () => void) => number;
  cancelFrame?: (handle: number) => void;
  /** Defaults to an IntersectionObserver on each tile canvas; pass false in
   * tests or when the host manages visibility itself. */
  observeVisibility?: boolean;
  now?: () => number;
};

export type MilkdropLiveTilePool = {
  acquire: (presetId: string) => MilkdropLiveTileHandle;
  /** Number of live (booted) engines. */
  engineCount: () => number;
  dispose: () => void;
};

type TileRecord = {
  presetId: string;
  canvas: HTMLCanvasElement;
  engine: MilkdropLiveTileEngine | null;
  status: MilkdropLiveTileStatus;
  refCount: number;
  visible: boolean;
  lastActiveAt: number;
  nextStepAt: number;
  bootStarted: boolean;
};

export function createMilkdropDefaultTileEngine(init: {
  canvas: HTMLCanvasElement;
  presetId: string;
  raw: string;
  tileSize: number;
}): MilkdropLiveTileEngine {
  const compiled = compileMilkdropPresetSource(init.raw, { id: init.presetId });
  const renderer = new WebGLRenderer({
    canvas: init.canvas,
    antialias: false,
    powerPreference: 'low-power',
  });
  renderer.setSize(init.tileSize, init.tileSize, false);
  renderer.setPixelRatio(1);
  const scene = new Scene();
  const camera = initCamera({ aspect: 1 });
  const adapter = createMilkdropRendererAdapter({
    scene,
    camera,
    renderer,
    backend: 'webgl',
    preset: compiled,
    fallbackCustomWaves: true,
  });
  adapter.attach();
  const vm = createMilkdropVM(compiled);
  vm.setRenderBackend('webgl');
  // Mesh/particle/wave detail proportional to the micro viewport.
  vm.setDetailScale(0.25);
  const tracker = createMilkdropSignalTracker();
  let post: PostprocessingPipeline | null = null;

  return {
    step(frame) {
      const baseSignals = tracker.update({
        time: frame.time / 1000,
        deltaMs: frame.deltaMs,
        analyser: null,
        frequencyData: frame.frequencyData,
        waveformData: frame.waveformData,
      });
      const signals = baseSignals as MilkdropRuntimeSignals;
      signals.aspect = 1;
      signals.pixelsx = init.tileSize;
      signals.pixelsy = init.tileSize;
      const frameState = vm.step(signals);
      const presented = adapter.render({ frameState, blendState: null });
      if (presented) {
        return;
      }
      // Mirror the stage frame loop: non-shader presets get echo/trail
      // emulation from the postprocessing composer when profiled for it.
      const profile = frameState.post.postprocessingProfile ?? null;
      if (
        profile &&
        shouldRenderMilkdropPostprocessing({
          backend: 'webgl',
          renderer,
          profile,
        })
      ) {
        if (post) {
          post.applyProfile(profile);
        } else {
          post = createMilkdropPostprocessingComposer({
            renderer,
            scene,
            camera,
            profile,
          });
        }
        if (post) {
          post.updateSize();
          post.render();
          return;
        }
      }
      renderer.render(scene, camera);
    },
    dispose() {
      post?.dispose?.();
      adapter.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

function defaultScheduleFrame(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(cb);
  }
  return setTimeout(cb, 33) as unknown as number;
}

function defaultCancelFrame(handle: number) {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}

export function createMilkdropLiveTilePool(
  options: MilkdropLiveTilePoolOptions,
): MilkdropLiveTilePool {
  const maxEngines = options.maxEngines ?? 10;
  const tileSize = options.tileSize ?? 128;
  const stepIntervalMs = options.stepIntervalMs ?? 66;
  const maxStepMsPerTick = options.maxStepMsPerTick ?? 6;
  const createEngine = options.createEngine ?? createMilkdropDefaultTileEngine;
  const scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame;
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame;
  const observeVisibility = options.observeVisibility ?? true;
  const now = options.now ?? (() => performance.now());

  const records = new Map<string, TileRecord>();
  const bootQueue: TileRecord[] = [];
  let frameHandle: number | null = null;
  let disposed = false;
  let lastTickAt = now();
  let stepCursor = 0;

  const syntheticFrequency = new Uint8Array(SPECTRUM_BINS);
  const syntheticWaveform = new Uint8Array(SPECTRUM_BINS);

  const intersectionObserver =
    observeVisibility && typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => {
          for (const entry of entries) {
            const record = canvasToRecord.get(entry.target);
            if (record) {
              record.visible = entry.isIntersecting;
              if (entry.isIntersecting) {
                record.lastActiveAt = now();
              }
            }
          }
        })
      : null;
  const canvasToRecord = new WeakMap<Element, TileRecord>();

  function fillSyntheticAudio(timeMs: number) {
    const energy = Math.min(1.5, Math.max(0, options.energyProvider?.() ?? 1));
    const beat = Math.sin((2 * Math.PI * timeMs) / 500) ** 2 * energy;
    for (let i = 0; i < SPECTRUM_BINS; i += 1) {
      syntheticFrequency[i] = Math.round(
        Math.min(255, (0.3 + 0.7 * beat) * 255 * Math.exp(-i / 48)),
      );
      syntheticWaveform[i] =
        128 + Math.round(90 * beat * Math.sin(i * 0.35 + timeMs * 0.02));
    }
  }

  function ensureScheduled() {
    if (disposed || frameHandle !== null) {
      return;
    }
    frameHandle = scheduleFrame(tick);
  }

  function effectiveMaxEngines() {
    const provided = options.capacityProvider?.();
    if (typeof provided !== 'number' || !Number.isFinite(provided)) {
      return maxEngines;
    }
    return Math.max(1, Math.min(maxEngines, Math.floor(provided)));
  }

  function evictForCapacity() {
    if (engineCount() < effectiveMaxEngines()) {
      return true;
    }
    let candidate: TileRecord | null = null;
    for (const record of records.values()) {
      if (!record.engine) {
        continue;
      }
      const evictable = record.refCount === 0 || !record.visible;
      if (!evictable) {
        continue;
      }
      if (!candidate) {
        candidate = record;
        continue;
      }
      // Prefer fully released records, then the least recently active.
      const recordReleased = record.refCount === 0;
      const candidateReleased = candidate.refCount === 0;
      const better =
        recordReleased !== candidateReleased
          ? recordReleased
          : record.lastActiveAt < candidate.lastActiveAt;
      if (better) {
        candidate = record;
      }
    }
    if (!candidate) {
      return false;
    }
    destroyRecord(candidate);
    return true;
  }

  function destroyRecord(record: TileRecord) {
    if (record.engine) {
      try {
        record.engine.dispose();
      } catch {
        // A lost context during dispose must not take the pool down.
      }
      record.engine = null;
    }
    intersectionObserver?.unobserve(record.canvas);
    records.delete(record.presetId);
    const queueIndex = bootQueue.indexOf(record);
    if (queueIndex >= 0) {
      bootQueue.splice(queueIndex, 1);
    }
    if (record.status !== 'failed') {
      record.status = 'released';
    }
  }

  function bootNext() {
    // Boot at most one tile per tick; compile is 10-60ms and synchronous, so
    // a scroll that reveals a row of tiles staggers instead of hitching.
    const index = bootQueue.findIndex((record) => record.visible);
    const record =
      index >= 0 ? bootQueue.splice(index, 1)[0] : bootQueue.shift();
    if (!record || record.bootStarted || record.refCount === 0) {
      return;
    }
    if (!evictForCapacity()) {
      // No capacity; push back and retry later.
      bootQueue.push(record);
      return;
    }
    record.bootStarted = true;
    record.status = 'booting';
    void options
      .loadPresetRaw(record.presetId)
      .then((raw) => {
        if (disposed || record.refCount === 0 || !raw) {
          record.status = raw ? 'released' : 'failed';
          record.bootStarted = false;
          return;
        }
        try {
          record.engine = createEngine({
            canvas: record.canvas,
            presetId: record.presetId,
            raw,
            tileSize,
          });
          record.status = 'live';
          record.nextStepAt = 0;
        } catch {
          record.status = 'failed';
        }
      })
      .catch(() => {
        record.status = 'failed';
      });
  }

  function tick() {
    frameHandle = null;
    if (disposed) {
      return;
    }
    const tickStart = now();
    const deltaMs = Math.min(100, tickStart - lastTickAt);
    lastTickAt = tickStart;

    bootNext();

    const live = [...records.values()].filter(
      (record) =>
        record.engine && record.visible && record.nextStepAt <= tickStart,
    );
    if (live.length > 0) {
      const external = options.audioProvider?.() ?? null;
      if (!external) {
        fillSyntheticAudio(tickStart);
      }
      const frequencyData = external?.frequencyData ?? syntheticFrequency;
      const waveformData = external?.waveformData ?? syntheticWaveform;
      // Rotate the starting index so budget exhaustion doesn't starve the
      // same tiles every tick.
      stepCursor = (stepCursor + 1) % live.length;
      for (let i = 0; i < live.length; i += 1) {
        if (now() - tickStart > maxStepMsPerTick) {
          break;
        }
        const record = live[(stepCursor + i) % live.length];
        try {
          record.engine?.step({
            time: tickStart,
            deltaMs: Math.max(deltaMs, 1),
            frequencyData,
            waveformData,
          });
          record.nextStepAt = tickStart + stepIntervalMs;
          record.lastActiveAt = tickStart;
        } catch {
          record.status = 'failed';
          try {
            record.engine?.dispose();
          } catch {
            // Ignore secondary failures while tearing down a broken tile.
          }
          record.engine = null;
        }
      }
    }

    if (records.size > 0 || bootQueue.length > 0) {
      ensureScheduled();
    }
  }

  function engineCount() {
    let count = 0;
    for (const record of records.values()) {
      if (record.engine) {
        count += 1;
      }
    }
    return count;
  }

  function acquire(presetId: string): MilkdropLiveTileHandle {
    const existing = records.get(presetId);
    const record: TileRecord = existing ?? {
      presetId,
      canvas: document.createElement('canvas'),
      engine: null,
      status: 'queued',
      refCount: 0,
      visible: !observeVisibility,
      lastActiveAt: now(),
      nextStepAt: 0,
      bootStarted: false,
    };
    if (!existing) {
      record.canvas.width = tileSize;
      record.canvas.height = tileSize;
      records.set(presetId, record);
      canvasToRecord.set(record.canvas, record);
      intersectionObserver?.observe(record.canvas);
      bootQueue.push(record);
    }
    record.refCount += 1;
    record.lastActiveAt = now();
    if (
      existing &&
      !existing.engine &&
      !existing.bootStarted &&
      existing.status !== 'failed' &&
      !bootQueue.includes(existing)
    ) {
      // Re-acquired after being dequeued (released before boot): boot again.
      existing.status = 'queued';
      bootQueue.push(existing);
    }
    ensureScheduled();

    let released = false;
    return {
      presetId,
      canvas: record.canvas,
      getStatus: () => record.status,
      release: () => {
        if (released) {
          return;
        }
        released = true;
        record.refCount = Math.max(0, record.refCount - 1);
        // Keep released engines warm for LRU revival; capacity pressure from
        // evictForCapacity reclaims them when needed.
      },
    };
  }

  return {
    acquire,
    engineCount,
    dispose() {
      disposed = true;
      if (frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }
      for (const record of [...records.values()]) {
        destroyRecord(record);
      }
      intersectionObserver?.disconnect();
      records.clear();
      bootQueue.length = 0;
    },
  };
}
