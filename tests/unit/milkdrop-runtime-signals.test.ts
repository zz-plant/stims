import { describe, expect, test } from 'bun:test';
import type { FrequencyAnalyser } from '../../src/js/core/audio-handler.ts';
import { createMilkdropSignalTracker } from '../../src/js/milkdrop/runtime-signals.ts';

function filledData(value: number, length = 128) {
  const data = new Uint8Array(length);
  data.fill(value);
  return data;
}

function pulseData({
  bass = 0,
  mid = 0,
  treble = 0,
  length = 128,
}: {
  bass?: number;
  mid?: number;
  treble?: number;
  length?: number;
}) {
  const data = new Uint8Array(length);
  data.fill(8);
  for (let index = 0; index < length; index += 1) {
    const ratio = index / Math.max(1, length - 1);
    const value = ratio < 0.12 ? bass : ratio < 0.5 ? mid : treble;
    data[index] = Math.round(value * 255);
  }
  return data;
}

function waveformData() {
  const data = new Uint8Array(128);
  for (let index = 0; index < data.length; index += 1) {
    const ratio = index / Math.max(1, data.length - 1);
    data[index] = Math.round(128 + Math.sin(ratio * Math.PI * 4) * 72);
  }
  return data;
}

function highEnergyData() {
  return filledData(255);
}

describe('milkdrop runtime signals', () => {
  test('samples expensive spectral features once every four frames', () => {
    const tracker = createMilkdropSignalTracker();
    let spectralFeatureCalls = 0;
    const analyserStub = {
      getMultiBandEnergy: () => ({ bass: 0.5, mid: 0.3, treble: 0.2 }),
      getRmsLevel: () => 0.4,
      getSampleRate: () => 48_000,
      getSpectralFeatures: () => {
        spectralFeatureCalls += 1;
        return {
          rms: 0.4,
          spectralCentroid: 6_000,
          spectralFlatness: 0.25,
          spectralRolloff: 12_000,
        };
      },
    } as unknown as FrequencyAnalyser;

    for (let index = 0; index < 8; index += 1) {
      tracker.update({
        time: index / 60,
        deltaMs: 1000 / 60,
        analyser: analyserStub,
        frequencyData: filledData(96),
        waveformData: waveformData(),
      });
    }

    expect(spectralFeatureCalls).toBe(2);
  });

  test('increments frame count and emits stable ranges with fallback data', () => {
    const tracker = createMilkdropSignalTracker();

    // Capture snapshots before each subsequent update since the tracker
    // reuses a shared mutable cache object to avoid per-frame allocations.
    const quiet = {
      ...tracker.update({
        time: 0,
        deltaMs: 16.7,
        analyser: null,
        frequencyData: filledData(24),
        waveformData: waveformData(),
      }),
    };
    const pulse = {
      ...tracker.update({
        time: 0.24,
        deltaMs: 16.7,
        analyser: null,
        frequencyData: pulseData({ bass: 1, mid: 0.45, treble: 0.18 }),
        waveformData: waveformData(),
      }),
    };
    const sustain = {
      ...tracker.update({
        time: 0.32,
        deltaMs: 16.7,
        analyser: null,
        frequencyData: pulseData({ bass: 1, mid: 0.45, treble: 0.18 }),
        waveformData: waveformData(),
      }),
    };

    expect(quiet.frame).toBe(1);
    expect(pulse.frame).toBe(2);
    expect(quiet.weightedEnergy).toBeLessThanOrEqual(1);
    expect(pulse.bass).toBeGreaterThan(quiet.bass);
    expect(pulse.beat).toBe(1);
    expect(pulse.beatPulse).toBeGreaterThan(0.3);
    expect(sustain.beat).toBe(0);
    expect(sustain.beatPulse).toBeLessThan(pulse.beatPulse);
    expect(pulse.beat_pulse).toBe(pulse.beatPulse);
    expect(pulse.vol).toBeCloseTo(pulse.rms, 6);
    expect(pulse.music).toBeCloseTo(pulse.weightedEnergy, 6);
    expect(pulse.waveformData).toBeInstanceOf(Uint8Array);
    expect(pulse.waveformData?.length).toBe(128);
  });

  test('exposes analyser float PCM buffers on the signal cache', () => {
    const tracker = createMilkdropSignalTracker();
    const floatMono = new Float32Array(128).fill(0.25);
    const floatL = new Float32Array(128).fill(-0.5);
    const floatR = new Float32Array(128).fill(0.5);
    const analyserStub = {
      getMultiBandEnergy: () => ({ bass: 0.5, mid: 0.3, treble: 0.2 }),
      getRmsLevel: () => 0.4,
      getSampleRate: () => 48_000,
      getWaveformFloatData: () => floatMono,
      getWaveformFloatDataL: () => floatL,
      getWaveformFloatDataR: () => floatR,
    } as unknown as FrequencyAnalyser;

    const signals = tracker.update({
      time: 0,
      deltaMs: 16.7,
      analyser: analyserStub,
      frequencyData: filledData(96),
      waveformData: waveformData(),
    });

    expect(signals.waveformFloatData).toBe(floatMono);
    expect(signals.waveformFloatDataL).toBe(floatL);
    expect(signals.waveformFloatDataR).toBe(floatR);

    // An analyser without the float getters must leave the fields null,
    // so the wave sampler falls back to the byte path.
    const legacy = tracker.update({
      time: 0.02,
      deltaMs: 16.7,
      analyser: {
        getMultiBandEnergy: () => ({ bass: 0.5, mid: 0.3, treble: 0.2 }),
        getRmsLevel: () => 0.4,
        getSampleRate: () => 48_000,
      } as unknown as FrequencyAnalyser,
      frequencyData: filledData(96),
      waveformData: waveformData(),
    });

    expect(legacy.waveformFloatData).toBeNull();
    expect(legacy.waveformFloatDataL).toBeNull();
    expect(legacy.waveformFloatDataR).toBeNull();
  });

  test('uses analyser-provided bands and smoothed RMS when available', () => {
    const tracker = createMilkdropSignalTracker();
    const analyserStub = {
      getMultiBandEnergy: () => ({ bass: 0.75, mid: 0.4, treble: 0.25 }),
      getRmsLevel: () => 0.8,
      getSampleRate: () => 48_000,
    } as unknown as FrequencyAnalyser;

    const update = tracker.update({
      time: 0.4,
      deltaMs: 16.7,
      analyser: analyserStub,
      frequencyData: new Uint8Array(64),
      waveformData: waveformData(),
    });

    // Bands are exposed on MilkDrop's relative scale, so a steady level reads
    // as 1.0 ("as loud as this track usually is") rather than its raw 0..1
    // magnitude. The first frame seeds the long average, so it reads exactly 1.
    expect(update.bass).toBeCloseTo(1, 6);
    expect(update.mid).toBeCloseTo(update.mids, 6);
    expect(update.treb).toBeCloseTo(update.treble, 6);
    expect(update.mids).toBeCloseTo(1, 6);
    expect(update.treble).toBeCloseTo(1, 6);
    expect(update.bass_att).toBeCloseTo(update.bassAtt, 6);
    expect(update.mid_att).toBeCloseTo(update.midsAtt, 6);
    expect(update.treb_att).toBeCloseTo(update.trebleAtt, 6);
    expect(update.rms).toBeGreaterThan(0.2);
    expect(update.rms).toBeLessThan(0.4);
  });

  test('scales bands relative to their own long-term average so above(bass, 1) can fire', () => {
    const tracker = createMilkdropSignalTracker();
    const quiet = pulseData({ bass: 0.3, mid: 0.2, treble: 0.12 });
    const loud = pulseData({ bass: 1, mid: 0.7, treble: 0.5 });

    // Settle the long average against a steady quiet passage.
    let steady = tracker.update({
      time: 0,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: quiet,
      waveformData: waveformData(),
    });
    for (let frame = 1; frame < 240; frame += 1) {
      steady = tracker.update({
        time: frame * 0.0167,
        deltaMs: 16.7,
        analyser: null,
        frequencyData: quiet,
        waveformData: waveformData(),
      });
    }
    expect(steady.bass).toBeCloseTo(1, 1);

    const hit = tracker.update({
      time: 240 * 0.0167,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: loud,
      waveformData: waveformData(),
    });
    expect(hit.bass).toBeGreaterThan(1);
  });

  test('keeps attenuation followers energized after a bass transient', () => {
    const tracker = createMilkdropSignalTracker();
    const ambient = pulseData({ bass: 0.16, mid: 0.12, treble: 0.08 });
    const transient = pulseData({ bass: 1, mid: 0.22, treble: 0.1 });
    let time = 0;
    const advance = (frequencyData: Uint8Array) => {
      time += 0.0167;
      return tracker.update({
        time,
        deltaMs: 16.7,
        analyser: null,
        frequencyData,
        waveformData: waveformData(),
      });
    };

    // Settle the long-term average on the ambient level so the transient is
    // measured against the passage it actually sits in.
    for (let frame = 0; frame < 240; frame += 1) {
      advance(ambient);
    }

    let pulse = advance(transient);
    for (let frame = 1; frame < 8; frame += 1) {
      pulse = advance(transient);
    }
    // Hold the tail long enough for the attenuation follower to be measured
    // against it — a single frame only shows the follower still climbing.
    let release = pulse;
    for (let frame = 0; frame < 8; frame += 1) {
      release = advance(ambient);
    }

    expect(pulse.bassAtt).toBeGreaterThan(0.25);
    expect(release.bassAtt).toBeGreaterThan(release.bass);
    expect(release.bassAtt).toBeLessThanOrEqual(pulse.bassAtt);
  });

  test('lets beatPulse decay over multiple frames instead of collapsing immediately', () => {
    const tracker = createMilkdropSignalTracker();

    tracker.update({
      time: 0,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: filledData(16),
      waveformData: waveformData(),
    });

    const pulse = {
      ...tracker.update({
        time: 0.18,
        deltaMs: 16.7,
        analyser: null,
        frequencyData: pulseData({ bass: 1, mid: 0.28, treble: 0.14 }),
        waveformData: waveformData(),
      }),
    };
    const decayOne = {
      ...tracker.update({
        time: 0.24,
        deltaMs: 16.7,
        analyser: null,
        frequencyData: pulseData({ bass: 0.22, mid: 0.16, treble: 0.09 }),
        waveformData: waveformData(),
      }),
    };
    const decayTwo = {
      ...tracker.update({
        time: 0.3,
        deltaMs: 16.7,
        analyser: null,
        frequencyData: pulseData({ bass: 0.14, mid: 0.1, treble: 0.06 }),
        waveformData: waveformData(),
      }),
    };

    expect(pulse.beat).toBe(1);
    expect(pulse.beatPulse).toBeGreaterThan(0.3);
    expect(decayOne.beat).toBe(0);
    expect(decayOne.beatPulse).toBeGreaterThan(0.1);
    expect(decayOne.beatPulse).toBeLessThan(pulse.beatPulse);
    expect(decayTwo.beatPulse).toBeLessThan(decayOne.beatPulse);
    expect(decayTwo.beatPulse).toBeGreaterThan(0.04);
  });

  test('builds MilkDrop spectrum samples from the captured frame data', () => {
    const tracker = createMilkdropSignalTracker();
    const rawSpectrum = pulseData({ bass: 1, mid: 0.18, treble: 0.04 });
    const analyserStub = {
      getMultiBandEnergy: () => ({ bass: 0.68, mid: 0.3, treble: 0.12 }),
      getRmsLevel: () => 0.55,
      getSampleRate: () => 48_000,
      getFrequencyData: () => rawSpectrum,
    } as unknown as FrequencyAnalyser;

    const update = tracker.update({
      time: 0.2,
      deltaMs: 16.7,
      analyser: analyserStub,
      frequencyData: rawSpectrum,
      waveformData: waveformData(),
    });

    expect(update.frequencyData[0]).toBeGreaterThan(0);
    expect(update.frequencyData[0]).toBeGreaterThan(
      update.frequencyData[update.frequencyData.length - 1] ?? 0,
    );
  });

  test('reuses the frame spectrum snapshot without pulling analyser data again', () => {
    const tracker = createMilkdropSignalTracker();
    const frameSpectrum = pulseData({ bass: 0.9, mid: 0.22, treble: 0.08 });
    const analyserSpectrum = pulseData({ bass: 0.05, mid: 0.2, treble: 1 });
    let frequencyReads = 0;
    let energyInput: Uint8Array | undefined;
    const analyserStub = {
      getFrequencyData: () => {
        frequencyReads += 1;
        return analyserSpectrum;
      },
      getMultiBandEnergy: (data?: Uint8Array) => {
        energyInput = data;
        return { bass: 0.7, mid: 0.3, treble: 0.1 };
      },
      getRmsLevel: () => 0.5,
      getSampleRate: () => 48_000,
    } as unknown as FrequencyAnalyser;

    tracker.update({
      time: 0.2,
      deltaMs: 16.7,
      analyser: analyserStub,
      frequencyData: frameSpectrum,
      waveformData: waveformData(),
    });

    expect(frequencyReads).toBe(0);
    expect(energyInput).toBe(frameSpectrum);
  });

  test('normalizes quieter material so weighted energy still stays responsive', () => {
    const tracker = createMilkdropSignalTracker();
    tracker.update({
      time: 0,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: filledData(18),
      waveformData: waveformData(),
    });

    const quietPulse = tracker.update({
      time: 0.24,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: pulseData({ bass: 0.18, mid: 0.12, treble: 0.08 }),
      waveformData: waveformData(),
    });

    expect(quietPulse.weightedEnergy).toBeGreaterThan(0.2);
    expect(quietPulse.music).toBeCloseTo(quietPulse.weightedEnergy, 6);
  });

  test('reset restarts frame numbering and tracker state', () => {
    const tracker = createMilkdropSignalTracker();
    tracker.update({
      time: 0.1,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: pulseData({ bass: 1, mid: 0.4, treble: 0.2 }),
      waveformData: waveformData(),
    });
    tracker.update({
      time: 0.35,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: pulseData({ bass: 1, mid: 0.4, treble: 0.2 }),
      waveformData: waveformData(),
    });

    tracker.reset();

    const afterReset = tracker.update({
      time: 0.5,
      deltaMs: 16.7,
      analyser: null,
      frequencyData: highEnergyData(),
      waveformData: waveformData(),
    });
    expect(afterReset.frame).toBe(1);
    expect(afterReset.bassAtt).toBeGreaterThanOrEqual(0);
  });
});
