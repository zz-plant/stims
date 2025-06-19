import { jest } from '@jest/globals';

let originalNavigatorDesc;
import {
  initAudio,
  getFrequencyData,
} from '../assets/js/utils/audio-handler.js';

describe('audio-handler utilities', () => {
  beforeEach(() => {
    const mockAnalyser = {
      frequencyBinCount: 128,
      getByteFrequencyData: jest.fn(),
    };
    const mockSource = { connect: jest.fn() };

    originalNavigatorDesc = Object.getOwnPropertyDescriptor(global, 'navigator');
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

    global.AudioContext = jest.fn(() => ({
      createAnalyser: jest.fn(() => mockAnalyser),
      createMediaStreamSource: jest.fn(() => mockSource),
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
    delete global.AudioContext;
  });

  test('initAudio resolves with analyser and data array', async () => {
    const { analyser, dataArray, audioContext, stream } = await initAudio();
    expect(analyser).toBeDefined();
    expect(dataArray).toBeInstanceOf(Uint8Array);
    expect(dataArray.length).toBe(analyser.frequencyBinCount);
    expect(audioContext).toBeDefined();
    expect(stream).toBeDefined();
  });

  test('initAudio supports custom fftSize', async () => {
    await expect(initAudio({ fftSize: 512 })).resolves.toBeDefined();
  });

  test('getFrequencyData returns array of the expected length', () => {
    const analyser = {
      frequencyBinCount: 64,
      getByteFrequencyData: jest.fn((arr) => arr.fill(1)),
    };

    const result = getFrequencyData(analyser);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(64);
    expect(analyser.getByteFrequencyData).toHaveBeenCalled();
  });
});
