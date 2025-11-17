import { jest } from '@jest/globals';
import PatternRecognizer from '../assets/js/utils/patternRecognition.ts';

describe('PatternRecognizer', () => {
  test('updatePatternBuffer stores analyser data', () => {
    const analyser = {
      getFrequencyData: jest.fn(() => new Uint8Array([1, 2, 3])),
    };
    const recognizer = new PatternRecognizer(analyser, 2);

    recognizer.updatePatternBuffer();

    expect(analyser.getFrequencyData).toHaveBeenCalled();
    expect(recognizer.patternBuffer.length).toBe(1);
    expect(recognizer.patternBuffer[0]).toEqual([1, 2, 3]);
  });

  test('detectPattern returns pattern when arrays match within tolerance', () => {
    const dataSets = [
      [10, 20, 30],
      [12, 19, 29],
    ];
    let call = 0;
    const analyser = {
      getFrequencyData: jest.fn(() => dataSets[call++]),
    };
    const recognizer = new PatternRecognizer(analyser, 2);

    recognizer.updatePatternBuffer();
    recognizer.updatePatternBuffer();

    const result = recognizer.detectPattern();
    expect(result).toEqual(dataSets[1]);
  });
});
