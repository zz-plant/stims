import { jest } from '@jest/globals';
import PatternRecognizer from '../assets/js/utils/patternRecognition.js';

describe('PatternRecognizer', () => {
  test('detectPattern returns pattern when last two patterns match', () => {
    const patterns = [new Uint8Array([1, 1, 1]), new Uint8Array([1, 1, 1])];
    let call = 0;
    const analyser = {
      frequencyBinCount: 3,
      getByteFrequencyData: jest.fn((arr) => arr.set(patterns[call++])),
    };
    const recognizer = new PatternRecognizer(analyser, 2);

    recognizer.updatePatternBuffer();
    recognizer.updatePatternBuffer();

    const result = recognizer.detectPattern();
    expect(result).toEqual([...patterns[1]]);
  });

  test('detectPattern returns null when patterns differ', () => {
    const patterns = [
      new Uint8Array([1, 1, 1]),
      new Uint8Array([200, 200, 200]),
    ];
    let call = 0;
    const analyser = {
      frequencyBinCount: 3,
      getByteFrequencyData: jest.fn((arr) => arr.set(patterns[call++])),
    };
    const recognizer = new PatternRecognizer(analyser, 2);

    recognizer.updatePatternBuffer();
    recognizer.updatePatternBuffer();

    const result = recognizer.detectPattern();
    expect(result).toBeNull();
  });
});
