import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { FrequencyAnalyser } from '../../src/js/core/audio-handler.ts';
import type { HarmonicPercussiveLevels } from '../../src/js/utils/audio/harmonic-percussive.ts';

type ProcessorConstructor = new (
  options?: AudioWorkletNodeOptions,
) => {
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
  port: {
    postMessage: {
      mock: {
        calls: Array<[Record<string, unknown>, Transferable[] | undefined]>;
      };
    };
  };
};

const registeredProcessors = new Map<string, ProcessorConstructor>();

class MockAudioWorkletProcessor {
  port = {
    postMessage: mock((_message: unknown, _transfers?: Transferable[]) => {}),
    onmessage: null as ((ev: MessageEvent) => void) | null,
  };
}

(
  globalThis as unknown as {
    AudioWorkletProcessor: typeof MockAudioWorkletProcessor;
  }
).AudioWorkletProcessor = MockAudioWorkletProcessor;

(
  globalThis as unknown as {
    registerProcessor: (
      name: string,
      processorCtor: ProcessorConstructor,
    ) => void;
  }
).registerProcessor = (name: string, processorCtor: ProcessorConstructor) => {
  registeredProcessors.set(name, processorCtor);
};

await import('../../src/js/utils/audio/frequency-analyser-processor.ts');

describe('Off-main-thread AudioWorklet DSP processing', () => {
  beforeEach(() => {
    mock.restore();
  });

  test('registers frequency-analyser processor', () => {
    expect(registeredProcessors.has('frequency-analyser')).toBe(true);
  });

  test('FrequencyAnalyserProcessor computes off-thread FFT, energy, averages, and transient metrics', () => {
    const ProcessorClass = registeredProcessors.get('frequency-analyser');
    expect(ProcessorClass).toBeDefined();
    if (!ProcessorClass) return;

    const processor = new ProcessorClass({
      processorOptions: {
        fftSize: 64,
        sampleRate: 44100,
        messageEvery: 1,
      },
    });

    const inputs = [[new Float32Array(64).fill(0.5)]];
    const outputs = [[new Float32Array(64)]];

    const result = processor.process(inputs, outputs);
    expect(result).toBe(true);

    const postMessageCalls = processor.port.postMessage.mock.calls;
    expect(postMessageCalls.length).toBeGreaterThan(0);

    const payload = postMessageCalls[0][0];
    expect(payload).toBeDefined();
    expect(payload.frequencyData).toBeDefined();
    expect(payload.waveformData).toBeDefined();
    expect(payload.timeDomainData).toBeDefined();
    expect(typeof payload.rms).toBe('number');
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

  test('worklet HPSS reports a sustained tone as harmonic', () => {
    const ProcessorClass = registeredProcessors.get('frequency-analyser');
    expect(ProcessorClass).toBeDefined();
    if (!ProcessorClass) return;

    const fftSize = 512;
    const sampleRate = 44100;
    const processor = new ProcessorClass({
      processorOptions: { fftSize, sampleRate, messageEvery: 1 },
    });

    const amplitude = 0.2;
    const binIndex = 8;
    const frequency = (binIndex * sampleRate) / fftSize;
    const samples = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i += 1) {
      samples[i] =
        amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    }
    // Feed several FFT buffers so the time-median has sustained history.
    for (let frame = 0; frame < 8; frame += 1) {
      for (let offset = 0; offset < fftSize; offset += 128) {
        processor.process(
          [[samples.subarray(offset, offset + 128)]],
          [[new Float32Array(128)]],
        );
      }
    }

    const calls = processor.port.postMessage.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const payload = calls[calls.length - 1][0];
    const hp = payload.harmonicPercussive as HarmonicPercussiveLevels;
    expect(hp.harmonic).toBeGreaterThan(hp.percussive * 5);
    expect(hp.percussiveRatio).toBeLessThan(0.2);
  });

  test('FrequencyAnalyser seamlessly consumes worklet energy and transient metrics', async () => {
    class FakeWorkletNode {
      port = {
        onmessage: null as ((ev: MessageEvent) => void) | null,
        postMessage: mock(),
      };
      connect = mock();
      disconnect = mock();
    }

    const fakeWorkletNode = new FakeWorkletNode();

    class FakeContext {
      state = 'running';
      sampleRate = 44100;
      destination = {};
      audioWorklet = {
        addModule: mock().mockResolvedValue(undefined),
      };
      createMediaStreamSource = mock(() => ({
        connect: mock(),
        disconnect: mock(),
      }));
      createGain = mock(() => ({
        gain: { value: 1 },
        connect: mock(),
        disconnect: mock(),
      }));
      createAnalyser = mock(() => ({
        fftSize: 0,
        frequencyBinCount: 32,
        getByteFrequencyData: mock(),
        getByteTimeDomainData: mock(),
        connect: mock(),
        disconnect: mock(),
      }));
      resume = mock().mockResolvedValue(undefined);
    }

    const origWorkletNode = globalThis.AudioWorkletNode;
    (globalThis as unknown as { AudioWorkletNode: unknown }).AudioWorkletNode =
      mock(() => fakeWorkletNode);

    try {
      const context = new FakeContext() as unknown as AudioContext;
      const stream = { getAudioTracks: () => [] } as unknown as MediaStream;

      const analyser = await FrequencyAnalyser.create(context, stream, 64);

      fakeWorkletNode.port.onmessage?.({
        data: {
          frequencyData: new Uint8Array(32).fill(128),
          waveformData: new Uint8Array(64).fill(128),
          rms: 0.5,
          energy: { bass: 0.8, mid: 0.4, treble: 0.2 },
          energyAverages: { bass: 0.75, mid: 0.35, treble: 0.15 },
          transientMetrics: {
            subBassEnv: 0.9,
            kickTransient: 0.65,
            vocalMidEnv: 0.45,
            snareSnap: 0.3,
          },
          harmonicPercussive: {
            percussive: 0.6,
            harmonic: 0.2,
            percussiveLow: 0.5,
            percussiveMid: 0.7,
            percussiveHigh: 0.4,
            percussiveRatio: 0.75,
          },
        },
      } as MessageEvent);

      expect(analyser.getMultiBandEnergy()).toEqual({
        bass: 0.8,
        mid: 0.4,
        treble: 0.2,
      });

      expect(analyser.getEnergyAverages()).toEqual({
        bass: 0.75,
        mid: 0.35,
        treble: 0.15,
      });

      expect(analyser.getTransientMetrics()).toEqual({
        subBassEnv: 0.9,
        kickTransient: 0.65,
        vocalMidEnv: 0.45,
        snareSnap: 0.3,
      });

      expect(analyser.getHarmonicPercussiveLevels()).toEqual({
        percussive: 0.6,
        harmonic: 0.2,
        percussiveLow: 0.5,
        percussiveMid: 0.7,
        percussiveHigh: 0.4,
        percussiveRatio: 0.75,
      });
    } finally {
      globalThis.AudioWorkletNode = origWorkletNode;
    }
  });

  test('FrequencyAnalyser falls back to AnalyserNode when AudioWorklet is unsupported or fails', async () => {
    class FallbackContext {
      state = 'running';
      sampleRate = 44100;
      destination = {};
      audioWorklet = undefined;
      createMediaStreamSource = mock(() => ({
        connect: mock(),
        disconnect: mock(),
      }));
      createGain = mock(() => ({
        gain: { value: 1 },
        connect: mock(),
        disconnect: mock(),
      }));
      createAnalyser = mock(() => ({
        fftSize: 64,
        frequencyBinCount: 32,
        getByteFrequencyData: mock((target: Uint8Array) => {
          target.fill(100);
        }),
        getByteTimeDomainData: mock((target: Uint8Array) => {
          target.fill(128);
        }),
        connect: mock(),
        disconnect: mock(),
      }));
      resume = mock().mockResolvedValue(undefined);
    }

    const context = new FallbackContext() as unknown as AudioContext;
    const stream = { getAudioTracks: () => [] } as unknown as MediaStream;

    const analyser = await FrequencyAnalyser.create(context, stream, 64);
    const freq = analyser.getFrequencyData();
    expect(freq).toBeInstanceOf(Uint8Array);
    expect(freq.length).toBe(32);

    const energy = analyser.getMultiBandEnergy();
    expect(energy.bass).toBeGreaterThan(0);
    expect(energy.mid).toBeGreaterThan(0);
    expect(energy.treble).toBeGreaterThan(0);

    const transients = analyser.getTransientMetrics();
    expect(transients.subBassEnv).toBeGreaterThanOrEqual(0);
    expect(transients.kickTransient).toBeGreaterThanOrEqual(0);

    // No worklet -> no worklet HPSS levels; the analyser-node path must not
    // fabricate them (the signal processor falls back to its own analysis).
    expect(analyser.getHarmonicPercussiveLevels()).toBeNull();
  });

  test('frequency bytes use the AnalyserNode decibel scale, not linear magnitude', () => {
    // Regression: linear magnitude→byte mapping left realistic music
    // (−20…−40 dBFS) at byte values 0–12, flatlining every downstream band
    // level while the AnalyserNode fallback path produced 100–200 for the
    // same signal. The worklet must match AnalyserNode's [−100, −30] dB
    // byte window so both paths feed the pipeline the same scale.
    const ProcessorClass = registeredProcessors.get('frequency-analyser');
    expect(ProcessorClass).toBeDefined();
    if (!ProcessorClass) return;

    const fftSize = 512;
    const sampleRate = 44100;
    const processor = new ProcessorClass({
      processorOptions: { fftSize, sampleRate, messageEvery: 1 },
    });

    // −20 dBFS sine centred on a bin (bin 8 → ~689 Hz).
    const amplitude = 0.1;
    const binIndex = 8;
    const frequency = (binIndex * sampleRate) / fftSize;
    const samples = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i += 1) {
      samples[i] =
        amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    }
    // Feed in render quanta of 128 frames until the FFT buffer fills.
    for (let offset = 0; offset < fftSize; offset += 128) {
      processor.process(
        [[samples.subarray(offset, offset + 128)]],
        [[new Float32Array(128)]],
      );
    }

    const calls = processor.port.postMessage.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const spectrum = new Uint8Array(
      calls[calls.length - 1][0].frequencyData as ArrayBuffer,
    );
    const peak = Math.max(...spectrum);
    // −20 dBFS sits well inside the [−100, −30] window: linear mapping gave
    // a peak of ~13 here; the dB mapping must land far above that.
    expect(peak).toBeGreaterThan(100);
    expect(peak).toBeLessThanOrEqual(255);
  });
});
