import { describe, expect, test } from 'bun:test';
import {
  buildMainWaveFrame,
  defaultSignalEnv,
} from '../assets/js/milkdrop/vm/frame-generation.ts';

describe('milkdrop vm frame generation', () => {
  test('builds deterministic main-wave visuals from explicit inputs', () => {
    const signals = defaultSignalEnv();
    signals.time = 0.25;
    signals.beatPulse = 0.2;
    signals.trebleAtt = 0.35;
    const waveformData = new Uint8Array(64);
    for (let index = 0; index < waveformData.length; index += 1) {
      waveformData[index] = 128 + ((index % 8) - 4) * 10;
    }
    signals.waveformData = waveformData;

    const built = buildMainWaveFrame({
      state: {
        wave_mode: 0,
        wave_x: 0.5,
        wave_y: 0.5,
        wave_scale: 1.1,
        wave_smoothing: 0.5,
        wave_mystery: 0.2,
        wave_r: 0.2,
        wave_g: 0.4,
        wave_b: 0.6,
        wave_a: 0.8,
        wave_brighten: 1,
      },
      signals,
      detailScale: 1,
      previousSamples: Array.from({ length: 176 }, () => 0),
      previousMomentum: Array.from({ length: 176 }, () => 0),
      useProcedural: false,
    });

    expect(built.visual.positions.length).toBeGreaterThan(0);
    expect(built.visual.positions.length % 3).toBe(0);
    expect(built.visual.color.b).toBeCloseTo(1, 5);
    expect(built.visual.closed).toBe(true);
    expect(built.procedural).toBeNull();
    expect(built.nextSamples[0]).not.toBeNaN();
    expect(built.nextMomentum[0]).not.toBeNaN();
  });

  test('supports reusing previous sample and momentum arrays as output buffers', () => {
    const signals = defaultSignalEnv();
    signals.time = 0.15;
    signals.beatPulse = 0.1;
    signals.trebleAtt = 0.2;
    const waveformData = new Uint8Array(96);
    waveformData.fill(160);
    signals.waveformData = waveformData;

    const sharedSamples = new Array<number>(96).fill(0);
    const sharedMomentum = new Array<number>(96).fill(0);
    const frameState = {
      wave_mode: 1,
      wave_x: 0.5,
      wave_y: 0.5,
      wave_scale: 1,
      wave_smoothing: 0.72,
      wave_a: 0.9,
    };

    const first = buildMainWaveFrame({
      state: frameState,
      signals,
      detailScale: 1,
      previousSamples: sharedSamples,
      previousMomentum: sharedMomentum,
      buffers: {
        liveSamples: [],
        smoothedSamples: sharedSamples,
        momentumSamples: sharedMomentum,
      },
      useProcedural: false,
    });
    const second = buildMainWaveFrame({
      state: frameState,
      signals: { ...signals, frame: 2, time: 0.2 },
      detailScale: 1,
      previousSamples: first.nextSamples,
      previousMomentum: first.nextMomentum,
      buffers: {
        liveSamples: [],
        smoothedSamples: first.nextSamples,
        momentumSamples: first.nextMomentum,
      },
      useProcedural: false,
    });

    expect(first.nextSamples).toBe(sharedSamples);
    expect(first.nextMomentum).toBe(sharedMomentum);
    expect(second.nextSamples).toBe(sharedSamples);
    expect(second.nextMomentum).toBe(sharedMomentum);
    expect(second.visual.positions.length).toBeGreaterThan(0);
    expect(second.nextSamples.every((value) => Number.isFinite(value))).toBe(
      true,
    );
    expect(second.nextMomentum.every((value) => Number.isFinite(value))).toBe(
      true,
    );
  });
});
