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
    connect: mock(),
    disconnect: mock(),
  }));
  close = mock();
}

class FakeAudioWorkletNode {
  port = { onmessage: null, postMessage: mock() };
  connect = mock();
  disconnect = mock();
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
    initAudio,
    getFrequencyData,
    stylizeFrequencyData,
  } = await import('../assets/js/utils/audio-handler.ts'));
});

describe('audio-handler utilities', () => {
  beforeEach(() => {
    originalNavigatorDesc = Object.getOwnPropertyDescriptor(
      global,
      'navigator',
    );
    const nav = global.navigator;
    const track = { stop: mock() };
    const stream = { getTracks: mock(() => [track]) };

    nav.mediaDevices = {
      getUserMedia: mock().mockResolvedValue(stream),
    };
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

  test('initAudio rejects with unsupported error when media devices are missing', async () => {
    delete global.navigator.mediaDevices;

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

    global.navigator.mediaDevices.getUserMedia = mock().mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    );

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
