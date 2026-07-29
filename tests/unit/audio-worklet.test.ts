import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { FrequencyAnalyser } from '../../src/js/core/audio-handler.ts';

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

await import('../../src/js/utils/frequency-analyser-processor.ts');

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
  });
});
