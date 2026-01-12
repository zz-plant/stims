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
let getFrequencyData;
let AudioAccessError;
let originalAudioContext;
let originalAudioWorkletNode;

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

  const baseThree = await import('./three-stub.ts');
  mock.module('three', () => {
    const AudioListener = mock(() => ({
      add: mock(),
      remove: mock(),
      context: new FakeAudioContext(),
    }));
    const Audio = mock(() => ({
      setMediaStreamSource: mock(),
      stop: mock(),
      disconnect: mock(),
    }));
    const PositionalAudio = mock(() => ({
      setMediaStreamSource: mock(),
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
      Audio,
      AudioAnalyser,
      AudioListener,
      Camera,
      Object3D,
      PositionalAudio,
    };
  });

  ({ initAudio, getFrequencyData, AudioAccessError } = await import(
    '../assets/js/utils/audio-handler.ts'
  ));
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
    global.navigator.mediaDevices.getUserMedia = mock().mockRejectedValue(
      new DOMException('denied', 'NotAllowedError'),
    );

    await expect(initAudio()).rejects.toBeInstanceOf(AudioAccessError);
    await expect(initAudio()).rejects.toEqual(
      expect.objectContaining({ reason: 'denied' }),
    );
  });

  test('getFrequencyData returns array of the expected length', () => {
    const data = new Uint8Array(64);
    const analyser = {
      getFrequencyData: mock(() => data),
    };

    const result = getFrequencyData(analyser);

    expect(result).toBe(data);
    expect(analyser.getFrequencyData).toHaveBeenCalled();
  });
});
