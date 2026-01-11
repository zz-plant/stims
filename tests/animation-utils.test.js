import { describe, expect, mock, test } from 'bun:test';
import {
  applyAudioRotation,
  applyAudioScale,
} from '../assets/js/utils/animation-utils.ts';

function expectedBandAverage(audioData, startRatio, endRatio) {
  const startIndex = Math.max(0, Math.floor(audioData.length * startRatio));
  const endIndex = Math.min(
    audioData.length,
    Math.ceil(audioData.length * endRatio),
  );
  const bucketWidth =
    Math.ceil(audioData.length * endRatio) -
    Math.floor(audioData.length * startRatio);

  if (bucketWidth <= 0 || endIndex <= startIndex) return 0;

  let sum = 0;
  for (let i = startIndex; i < endIndex; i++) {
    sum += audioData[i];
  }

  return sum / bucketWidth;
}

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

  test('applyAudioRotation uses consistent bucket widths for low/mid/high bands', () => {
    const audioData = new Uint8Array([
      5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60,
    ]);
    const object = { rotation: { x: 0, y: 0 } };

    const bands = [
      { name: 'low', ratios: [0, 0.33] },
      { name: 'mid', ratios: [0.33, 0.66] },
      { name: 'high', ratios: [0.66, 1] },
    ];

    bands.forEach(({ name, ratios }) => {
      object.rotation.x = 0;
      object.rotation.y = 0;
      const expectedAvg = expectedBandAverage(audioData, ratios[0], ratios[1]);

      applyAudioRotation(object, audioData, 0.2, name);

      const expectedRotation = 0.2 * (expectedAvg / 255);
      expect(object.rotation.x).toBeCloseTo(expectedRotation);
      expect(object.rotation.y).toBeCloseTo(expectedRotation);
    });
  });

  test('applyAudioRotation handles zero-length buckets safely', () => {
    const object = { rotation: { x: 1, y: 1 } };
    const audioData = new Uint8Array();

    applyAudioRotation(object, audioData, 0.5, 'low');

    expect(object.rotation.x).toBe(1);
    expect(object.rotation.y).toBe(1);
  });

  test('applyAudioScale sets scale based on specified band', () => {
    const called = [];
    const object = {
      scale: { set: mock((x, y, z) => called.push([x, y, z])) },
    };
    const audioData = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90]);

    applyAudioScale(object, audioData, 50, 'high');

    const highAvg = expectedBandAverage(audioData, 0.66, 1);
    const scale = 1 + highAvg / 50;
    expect(object.scale.set).toHaveBeenCalledWith(scale, scale, scale);
    expect(called[0]).toEqual([scale, scale, scale]);
  });
});
