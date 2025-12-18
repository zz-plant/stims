import {
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

beforeAll(async () => {
  mock.module('three', () => {
    const AudioListener = mock(() => ({ add: mock(), context: { close: mock() } }));
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
    const AudioAnalyser = mock((audio, fftSize = 256) => {
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
    originalNavigatorDesc = Object.getOwnPropertyDescriptor(global, 'navigator');
    const nav = global.navigator;
    nav.mediaDevices = {
      getUserMedia: mock().mockResolvedValue('stream'),
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
      })
    );
  });

  test('initAudio rejects with denied error when permission is blocked', async () => {
    global.navigator.mediaDevices.getUserMedia = mock().mockRejectedValue(
      new DOMException('denied', 'NotAllowedError')
    );

    await expect(initAudio()).rejects.toBeInstanceOf(AudioAccessError);
    await expect(initAudio()).rejects.toEqual(expect.objectContaining({ reason: 'denied' }));
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
