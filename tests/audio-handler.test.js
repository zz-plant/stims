import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test';

let originalNavigatorDesc;
let initAudio;
let DEFAULT_MICROPHONE_CONSTRAINTS;
let getFrequencyData;
let FrequencyAnalyser;
let stylizeFrequencyData;
let originalAudioContext;
let originalAudioWorkletNode;
let AudioCtor;
let PositionalAudioCtor;

class FakeAudioWorklet {
  addModule = mock().mockResolvedValue(undefined);
}

class FakeAudioContext {
  audioWorklet = new FakeAudioWorklet();
  destination = {};

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
    frequencyBinCount: 128,
    getByteFrequencyData: mock(),
    getByteTimeDomainData: mock((target) => target.fill(128)),
    connect: mock(),
    disconnect: mock(),
  }));
  close = mock();
}

class FakeAudioWorkletNode {
  static instances = [];

  port = { onmessage: null, postMessage: mock() };
  connect = mock();
  disconnect = mock();

  constructor() {
    FakeAudioWorkletNode.instances.push(this);
  }
}

beforeAll(async () => {
  originalAudioContext = global.AudioContext;
  originalAudioWorkletNode = global.AudioWorkletNode;
  global.AudioContext = FakeAudioContext;
  global.AudioWorkletNode = FakeAudioWorkletNode;

  const baseThree = await import('three');
  mock.module('three', () => {
    const AudioListener = mock(() => ({
      add: mock(),
      remove: mock(),
      context: new FakeAudioContext(),
    }));
    AudioCtor = mock(() => ({
      setMediaStreamSource: mock(),
      setVolume: mock(),
      stop: mock(),
      disconnect: mock(),
    }));
    PositionalAudioCtor = mock(() => ({
      setMediaStreamSource: mock(),
      setVolume: mock(),
      stop: mock(),
      disconnect: mock(),
    }));
    const AudioAnalyser = mock((_audio, fftSize = 256) => {
      const data = new Uint8Array(fftSize / 2);
      return {
        analyser: { disconnect: mock() },
        frequencyBinCount: data.length,
        getFrequencyData: mock(() => data),
      };
    });

    class Camera {
      add = mock();
      remove = mock();
    }

    class Object3D {
      add = mock();
      remove = mock();
    }

    return {
      __esModule: true,
      ...baseThree,
      Audio: AudioCtor,
      AudioAnalyser,
      AudioListener,
      Camera,
      Object3D,
      PositionalAudio: PositionalAudioCtor,
    };
  });

  ({
    DEFAULT_MICROPHONE_CONSTRAINTS,
    FrequencyAnalyser,
    initAudio,
    getFrequencyData,
    stylizeFrequencyData,
  } = await import('../assets/js/core/audio-handler.ts'));
});

describe('audio-handler utilities', () => {
  beforeEach(() => {
    FakeAudioWorkletNode.instances.length = 0;
    originalNavigatorDesc = Object.getOwnPropertyDescriptor(
      global,
      'navigator',
    );
    const nav = global.navigator;
    const track = { stop: mock() };
    const stream = { getTracks: mock(() => [track]) };

    Object.defineProperty(nav, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        getUserMedia: mock().mockResolvedValue(stream),
      },
    });
    global.navigator = nav;
  });

  afterEach(() => {
    if (originalNavigatorDesc) {
      Object.defineProperty(global, 'navigator', originalNavigatorDesc);
      originalNavigatorDesc = undefined;
    } else {
      delete global.navigator;
    }
  });

  afterAll(() => {
    if (originalAudioContext) {
      global.AudioContext = originalAudioContext;
    } else {
      delete global.AudioContext;
    }

    if (originalAudioWorkletNode) {
      global.AudioWorkletNode = originalAudioWorkletNode;
    } else {
      delete global.AudioWorkletNode;
    }

    mock.restore();
  });

  test('initAudio resolves with analyser and listener', async () => {
    const { analyser, listener, audio, stream } = await initAudio();
    expect(analyser).toBeDefined();
    expect(listener).toBeDefined();
    expect(audio).toBeDefined();
    expect(stream).toBeDefined();
  });

  test('initAudio requests microphone with non-call defaults', async () => {
    await initAudio();

    expect(global.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(
      DEFAULT_MICROPHONE_CONSTRAINTS,
    );
  });

  test('initAudio disables monitoring by default to prevent microphone echo', async () => {
    await initAudio();

    const audioInstance = AudioCtor.mock.results[0]?.value;
    expect(audioInstance?.setVolume).toHaveBeenCalledWith(0);
  });

  test('initAudio can keep monitoring enabled when requested', async () => {
    await initAudio({ monitorInput: true });

    const audioInstance = AudioCtor.mock.results.at(-1)?.value;
    expect(audioInstance?.setVolume).not.toHaveBeenCalled();
  });

  test('initAudio can create positional audio', async () => {
    const { audio } = await initAudio({
      positional: true,
      object: { add: mock(), remove: mock() },
    });
    expect(audio).toBeDefined();
  });

  test('initAudio supports custom fftSize', async () => {
    await expect(initAudio({ fftSize: 512 })).resolves.toBeDefined();
  });

  test('initAudio loads the analyser worklet from the shared utils path', async () => {
    await initAudio();

    const listenerInstance = await import('three').then(
      ({ AudioListener }) => AudioListener.mock.results[0]?.value,
    );
    const addModuleArg =
      listenerInstance?.context?.audioWorklet?.addModule?.mock.calls[0]?.[0];

    expect(String(addModuleArg)).toContain(
      '/assets/js/utils/frequency-analyser-processor.ts',
    );
  });

  test('FrequencyAnalyser uses AudioWorklet messages when the worklet path succeeds', async () => {
    const context = new FakeAudioContext();
    const analyser = await FrequencyAnalyser.create(
      context,
      /** @type {MediaStream} */ ({}),
      64,
    );
    const workletNode = FakeAudioWorkletNode.instances.at(-1);

    expect(workletNode).toBeDefined();

    const frequencyData = new Uint8Array(32);
    frequencyData[0] = 255;
    frequencyData[3] = 128;
    frequencyData[8] = 64;
    const waveform = new Uint8Array(64);
    for (let index = 0; index < waveform.length; index += 1) {
      waveform[index] = Math.round(
        (index / Math.max(1, waveform.length - 1)) * 255,
      );
    }

    workletNode.port.onmessage?.({
      data: {
        frequencyData,
        waveformData: waveform,
        rms: 0.42,
      },
    });

    expect(Array.from(analyser.getWaveformData())).toEqual(
      Array.from(waveform),
    );
    expect(analyser.getRmsLevel()).toBe(0.42);
    const bands = analyser.getMultiBandEnergy();
    expect(bands.bass).toBeGreaterThan(bands.mid);
    expect(bands.mid).toBeGreaterThan(bands.treble);
    expect(bands.bass).toBeGreaterThan(0.95);
  });

  test('initAudio rejects with unsupported error when media devices are missing', async () => {
    Object.defineProperty(global.navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    await expect(initAudio()).rejects.toEqual(
      expect.objectContaining({
        reason: 'unsupported',
        message: expect.stringContaining('does not support'),
      }),
    );
  });

  test('initAudio rejects with denied error when permission is blocked', async () => {
    const consoleErrorSpy = mock(() => {});
    const originalConsoleError = console.error;
    console.error = consoleErrorSpy;

    Object.defineProperty(global.navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: {
        getUserMedia: mock().mockRejectedValue(
          new DOMException('denied', 'NotAllowedError'),
        ),
      },
    });

    try {
      await expect(initAudio()).rejects.toEqual(
        expect.objectContaining({
          reason: 'denied',
          name: 'AudioAccessError',
        }),
      );
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('getFrequencyData returns a stylized copy without mutating analyser data', () => {
    const data = new Uint8Array([8, 12, 17, 15, 10, 7, 4, 2]);
    const analyser = {
      getFrequencyData: mock(() => data),
    };

    const result = getFrequencyData(analyser);

    expect(result).toHaveLength(data.length);
    expect(result).not.toBe(data);
    expect([...data]).toEqual([8, 12, 17, 15, 10, 7, 4, 2]);
    expect(Math.max(...result)).toBeLessThan(17);
    expect(analyser.getFrequencyData).toHaveBeenCalled();
  });

  test('FrequencyAnalyser exposes time-domain waveform data', async () => {
    const context = new FakeAudioContext();
    context.audioWorklet = undefined;
    const analyser = await FrequencyAnalyser.create(
      context,
      { getTracks: () => [] },
      256,
    );

    const waveform = analyser.getWaveformData();

    expect(waveform).toBeInstanceOf(Uint8Array);
    expect(waveform).toHaveLength(256);
    expect([...waveform.slice(0, 4)]).toEqual([128, 128, 128, 128]);
  });

  test('stylizeFrequencyData leaves silent buffers untouched', () => {
    const data = new Uint8Array(16);

    const result = stylizeFrequencyData(data);

    expect(result).toBe(data);
    expect([...result]).toEqual(new Array(16).fill(0));
  });

  test('stylizeFrequencyData boosts bass-led spectra without clipping everything', () => {
    const data = new Uint8Array([18, 34, 52, 76, 68, 48, 28, 16, 10, 6]);

    stylizeFrequencyData(data);

    expect(data[0]).toBeGreaterThan(18);
    expect(data[2]).toBeGreaterThan(52);
    expect(data[8]).toBeGreaterThan(10);
    expect(Math.max(...data)).toBeLessThan(255);
  });

  test('stylizeFrequencyData damps very low activity instead of exaggerating it', () => {
    const data = new Uint8Array([6, 8, 11, 10, 7, 5, 4, 3]);

    stylizeFrequencyData(data);

    expect(Math.max(...data)).toBeLessThan(11);
    expect(data[0]).toBeLessThan(6);
    expect(data[2]).toBeLessThan(11);
  });
});
