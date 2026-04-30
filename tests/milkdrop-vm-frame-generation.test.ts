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
      previousSamples: new Float32Array(176),
      previousMomentum: new Float32Array(176),
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

    // mode=1 with 96-source-length produces 136 samples.
    // Float32Array is fixed-size, so allocate the correct size for reuse to work.
    const sharedSamples = new Float32Array(136);
    const sharedMomentum = new Float32Array(136);
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
        liveSamples: sharedSamples,
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
        liveSamples: first.nextSamples,
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

  test('reuses provided main-wave visual and procedural payloads', () => {
    const signals = defaultSignalEnv();
    signals.time = 0.35;
    signals.beatPulse = 0.12;
    signals.trebleAtt = 0.28;
    signals.waveformData = new Uint8Array(72).fill(160);

    const reusableVisual = {
      positions: [99, 98, 97],
      color: { r: 0, g: 0, b: 0, a: 0 },
      alpha: 0,
      thickness: 0,
      drawMode: 'line' as const,
      additive: false,
      pointSize: 0,
      closed: false,
    };
    const reusableProcedural = {
      samples: [1, 2, 3],
      velocities: [4, 5, 6],
      mode: 0,
      centerX: 0,
      centerY: 0,
      scale: 1,
      mystery: 0,
      time: 0,
      beatPulse: 0,
      trebleAtt: 0,
      color: { r: 0, g: 0, b: 0, a: 0 },
      alpha: 0,
      additive: false,
      thickness: 0,
    };

    const visualFrame = buildMainWaveFrame({
      state: {
        wave_mode: 0,
        wave_x: 0.5,
        wave_y: 0.5,
        wave_scale: 1,
        wave_smoothing: 0.72,
        wave_a: 0.9,
      },
      signals,
      detailScale: 1,
      previousSamples: new Float32Array(96),
      previousMomentum: new Float32Array(96),
      useProcedural: false,
      reusableVisual,
    });

    expect(visualFrame.visual).toBe(reusableVisual);
    expect(visualFrame.visual.positions).toBe(reusableVisual.positions);
    expect(visualFrame.visual.positions.length).toBeGreaterThan(3);

    const proceduralFrame = buildMainWaveFrame({
      state: {
        wave_mode: 1,
        wave_x: 0.5,
        wave_y: 0.5,
        wave_scale: 1,
        wave_smoothing: 0.72,
        wave_a: 0.9,
      },
      signals,
      detailScale: 1,
      previousSamples: new Float32Array(96),
      previousMomentum: new Float32Array(96),
      useProcedural: true,
      reusableVisual,
      reusableProcedural,
    });

    expect(proceduralFrame.visual).toBe(reusableVisual);
    expect(proceduralFrame.visual.positions).toBe(reusableVisual.positions);
    expect(proceduralFrame.visual.positions).toHaveLength(0);
    expect(proceduralFrame.procedural).toBe(reusableProcedural);
    expect(proceduralFrame.procedural?.samples).toBe(
      reusableProcedural.samples,
    );
    expect(proceduralFrame.procedural?.velocities).toBe(
      reusableProcedural.velocities,
    );
    expect(proceduralFrame.procedural?.samples.length).toBeGreaterThan(3);
  });
});
