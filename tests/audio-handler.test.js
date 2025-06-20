import { jest } from '@jest/globals';

let originalNavigatorDesc;
import {
  initAudio,
  getFrequencyData,
} from '../assets/js/utils/audio-handler.ts';

describe('audio-handler utilities', () => {
  beforeEach(() => {
    const mockAnalyserNode = {
      frequencyBinCount: 128,
      getByteFrequencyData: jest.fn(),
      connect: jest.fn(),
    };
    const mockSource = { connect: jest.fn() };

    originalNavigatorDesc = Object.getOwnPropertyDescriptor(
      global,
      'navigator'
    );
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      writable: true,
      value: {
        mediaDevices: {
          getUserMedia: jest.fn().mockResolvedValue('stream'),
        },
      },
    });

    global.window = global.window || {};
    global.window.navigator = global.navigator;
    global.window.AudioContext = jest.fn(() => ({
      createAnalyser: jest.fn(() => mockAnalyserNode),
      createMediaStreamSource: jest.fn(() => mockSource),
      createGain: jest.fn(() => ({ connect: jest.fn() })),
      createPanner: jest.fn(() => ({ connect: jest.fn() })),
      destination: {},
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalNavigatorDesc) {
      Object.defineProperty(global, 'navigator', originalNavigatorDesc);
      originalNavigatorDesc = undefined;
    } else {
      delete global.navigator;
    }
    if (global.window) {
      delete global.window.navigator;
    }
    delete global.window.AudioContext;
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
      object: { add: jest.fn() },
    });
    expect(audio).toBeDefined();
  });

  test('initAudio supports custom fftSize', async () => {
    await expect(initAudio({ fftSize: 512 })).resolves.toBeDefined();
  });

  test('getFrequencyData returns array of the expected length', () => {
    const data = new Uint8Array(64);
    const analyser = {
      getFrequencyData: jest.fn(() => data),
    };

    const result = getFrequencyData(analyser);

    expect(result).toBe(data);
    expect(analyser.getFrequencyData).toHaveBeenCalled();
  });
});
