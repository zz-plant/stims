import { jest } from '@jest/globals';
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

    navigator.mediaDevices = {
      getUserMedia: jest.fn().mockResolvedValue('stream'),
    };

    global.AudioContext = jest.fn(() => ({
      createAnalyser: jest.fn(() => mockAnalyser),
      createMediaStreamSource: jest.fn(() => mockSource),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete navigator.mediaDevices;
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
