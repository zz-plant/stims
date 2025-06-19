import { jest } from '@jest/globals';
import {
  applyAudioRotation,
  applyAudioScale,
} from '../assets/js/utils/animation-utils.js';

describe('animation-utils', () => {
  test('applyAudioRotation updates rotation based on average frequency', () => {
    const object = { rotation: { x: 0, y: 0 } };
    const audioData = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]);

    applyAudioRotation(object, audioData, 0.1);

    const avg = audioData.reduce((a, b) => a + b, 0) / audioData.length;
    const expected = 0.1 * (avg / 255);
    expect(object.rotation.x).toBeCloseTo(expected);
    expect(object.rotation.y).toBeCloseTo(expected);
  });

  test('applyAudioScale sets scale based on specified band', () => {
    const called = [];
    const object = {
      scale: { set: jest.fn((x, y, z) => called.push([x, y, z])) },
    };
    const audioData = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]);

    applyAudioScale(object, audioData, 50, 'high');

    const highAvg =
      audioData
        .slice(Math.trunc(audioData.length * 0.66))
        .reduce((acc, val) => acc + val, 0) /
      (audioData.length * 0.33);
    const scale = 1 + highAvg / 50;
    expect(object.scale.set).toHaveBeenCalledWith(scale, scale, scale);
    expect(called[0]).toEqual([scale, scale, scale]);
  });
});
