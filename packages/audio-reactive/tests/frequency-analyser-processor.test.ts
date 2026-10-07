/**
 * Drives FrequencyAnalyserProcessor directly under the fake
 * AudioWorkletGlobalScope installed by tests/setup.ts. Carried over from
 * stims/tests/unit/audio-worklet.test.ts, minus the cases that exercised the
 * main-thread FrequencyAnalyser wrapper (which stayed in Stims).
 */
import { describe, expect, test } from 'bun:test';
import type { HarmonicPercussiveLevels } from '../src/harmonic-percussive.ts';
import type { FakeMessagePort } from './setup.ts';
import { registeredProcessors } from './setup.ts';

type ProcessorInstance = {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  port: FakeMessagePort;
};
type ProcessorConstructor = new (
  options?: AudioWorkletNodeOptions,
) => ProcessorInstance;

await import('../src/frequency-analyser-processor.ts');

function getProcessorClass(): ProcessorConstructor {
  const ctor = registeredProcessors.get('frequency-analyser');
  if (!ctor) throw new Error('frequency-analyser was not registered');
  return ctor as ProcessorConstructor;
}

function sineAtBin(
  fftSize: number,
  sampleRate: number,
  binIndex: number,
  amplitude: number,
) {
  const frequency = (binIndex * sampleRate) / fftSize;
  const samples = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i += 1) {
    samples[i] =
      amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return samples;
}

/** Feed `samples` in 128-frame render quanta, the way the audio thread does. */
function feedQuanta(processor: ProcessorInstance, samples: Float32Array) {
  for (let offset = 0; offset < samples.length; offset += 128) {
    processor.process(
      [[samples.subarray(offset, offset + 128)]],
      [[new Float32Array(128)]],
    );
  }
}

describe('FrequencyAnalyserProcessor', () => {
  test('registers under the name "frequency-analyser"', () => {
    expect(registeredProcessors.has('frequency-analyser')).toBe(true);
  });

  test('computes off-thread FFT, energy, averages, and transient metrics', () => {
    const ProcessorClass = getProcessorClass();
    const processor = new ProcessorClass({
      processorOptions: { fftSize: 64, sampleRate: 44100, messageEvery: 1 },
    });

    const inputs = [[new Float32Array(64).fill(0.5)]];
    const outputs = [[new Float32Array(64)]];

    expect(processor.process(inputs, outputs)).toBe(true);
    expect(processor.port.posted.length).toBeGreaterThan(0);

    const [payload, transfers] = processor.port.posted[0];
    expect(payload.frequencyData).toBeInstanceOf(ArrayBuffer);
    expect(payload.waveformData).toBeInstanceOf(ArrayBuffer);
    expect(payload.timeDomainData).toBeInstanceOf(ArrayBuffer);
    expect(transfers).toHaveLength(3);
    expect(typeof payload.rms).toBe('number');
    expect(typeof payload.zeroCrossingRate).toBe('number');
    expect(typeof payload.spectralFlux).toBe('number');
    expect(typeof payload.spectralCrest).toBe('number');
    expect(typeof payload.spectralCentroid).toBe('number');
    expect(typeof payload.spectralFlatness).toBe('number');
    expect(typeof payload.spectralRolloff).toBe('number');
    expect(payload.energy).toEqual({
      bass: expect.any(Number),
      mid: expect.any(Number),
      treble: expect.any(Number),
    });
    expect(payload.energyAverages).toEqual({
      bass: expect.any(Number),
      mid: expect.any(Number),
      treble: expect.any(Number),
    });
    expect(payload.beatDetection).toEqual({
      isBeat: expect.any(Boolean),
      beatIntensity: expect.any(Number),
      beatBass: expect.any(Boolean),
      beatMid: expect.any(Boolean),
      beatTreble: expect.any(Boolean),
      bassBeatIntensity: expect.any(Number),
      midBeatIntensity: expect.any(Number),
      trebleBeatIntensity: expect.any(Number),
    });
    expect(payload.transientMetrics).toEqual({
      subBassEnv: expect.any(Number),
      kickTransient: expect.any(Number),
      vocalMidEnv: expect.any(Number),
      snareSnap: expect.any(Number),
    });
    expect(payload.harmonicPercussive).toEqual({
      percussive: expect.any(Number),
      harmonic: expect.any(Number),
      percussiveLow: expect.any(Number),
      percussiveMid: expect.any(Number),
      percussiveHigh: expect.any(Number),
      percussiveRatio: expect.any(Number),
    });
  });

  test('HPSS reports a sustained tone as harmonic', () => {
    const ProcessorClass = getProcessorClass();
    const fftSize = 512;
    const sampleRate = 44100;
    const processor = new ProcessorClass({
      processorOptions: { fftSize, sampleRate, messageEvery: 1 },
    });
    const samples = sineAtBin(fftSize, sampleRate, 8, 0.2);
    // Several FFT buffers so the time-median has sustained history.
    for (let frame = 0; frame < 8; frame += 1) {
      feedQuanta(processor, samples);
    }
    const posted = processor.port.posted;
    expect(posted.length).toBeGreaterThan(0);
    const hp = posted[posted.length - 1][0]
      .harmonicPercussive as HarmonicPercussiveLevels;
    expect(hp.harmonic).toBeGreaterThan(hp.percussive * 5);
    expect(hp.percussiveRatio).toBeLessThan(0.2);
  });

  test('frequency bytes use the AnalyserNode decibel scale, not linear magnitude', () => {
    // Regression: a linear magnitude->byte mapping left realistic music
    // (-20..-40 dBFS) at byte values 0-12, flatlining every downstream band
    // level while AnalyserNode produced 100-200 for the same signal. The
    // worklet must match AnalyserNode's [-100, -30] dB byte window.
    const ProcessorClass = getProcessorClass();
    const fftSize = 512;
    const sampleRate = 44100;
    const processor = new ProcessorClass({
      processorOptions: { fftSize, sampleRate, messageEvery: 1 },
    });
    // -20 dBFS sine centred on bin 8 (~689 Hz).
    feedQuanta(processor, sineAtBin(fftSize, sampleRate, 8, 0.1));

    const posted = processor.port.posted;
    expect(posted.length).toBeGreaterThan(0);
    const spectrum = new Uint8Array(
      posted[posted.length - 1][0].frequencyData as ArrayBuffer,
    );
    const peak = Math.max(...spectrum);
    expect(peak).toBeGreaterThan(100);
    expect(peak).toBeLessThanOrEqual(255);
  });

  test('stereo input posts L/R spectra and waveforms with five transfers', () => {
    const ProcessorClass = getProcessorClass();
    const fftSize = 256;
    const processor = new ProcessorClass({
      processorOptions: { fftSize, sampleRate: 44100, messageEvery: 1 },
    });
    // Different bins are orthogonal over a full period, so the channels are
    // uncorrelated; the louder left side tips the balance positive.
    const left = sineAtBin(fftSize, 44100, 4, 0.3);
    const right = sineAtBin(fftSize, 44100, 5, 0.1);
    for (let offset = 0; offset < fftSize; offset += 128) {
      processor.process(
        [
          [
            left.subarray(offset, offset + 128),
            right.subarray(offset, offset + 128),
          ],
        ],
        [[new Float32Array(128)]],
      );
    }
    const [payload, transfers] =
      processor.port.posted[processor.port.posted.length - 1];
    expect(transfers).toHaveLength(5);
    expect(payload.frequencyDataL).toBe(payload.frequencyData);
    expect(payload.frequencyDataR).toBeInstanceOf(ArrayBuffer);
    expect(payload.waveformDataR).toBeInstanceOf(ArrayBuffer);
    expect(payload.stereoBalance as number).toBeGreaterThan(0.3);
    expect(payload.stereoWidth as number).toBeGreaterThan(0.5);
  });

  test('recycle-buffers messages are reused for the next packet', () => {
    const ProcessorClass = getProcessorClass();
    const fftSize = 64;
    const processor = new ProcessorClass({
      processorOptions: { fftSize, sampleRate: 44100, messageEvery: 1 },
    });
    const quantum = [[new Float32Array(fftSize).fill(0.25)]];
    processor.process(quantum, [[new Float32Array(fftSize)]]);
    const first = processor.port.posted[0][0];
    const recycled = first.frequencyData as ArrayBuffer;
    processor.port.onmessage?.({
      data: {
        type: 'recycle-buffers',
        freq: [recycled],
        wave: [],
        timeDomain: [],
      },
    } as MessageEvent);
    // The processor pops a free buffer right after posting, so a buffer
    // returned after packet N is picked up when packet N+1 is posted and
    // becomes the storage for packet N+2.
    processor.process(quantum, [[new Float32Array(fftSize)]]);
    processor.process(quantum, [[new Float32Array(fftSize)]]);
    const third = processor.port.posted[2][0];
    expect(third.frequencyData).toBe(recycled);
    expect(processor.port.posted[1][0].frequencyData).not.toBe(recycled);
  });
});
