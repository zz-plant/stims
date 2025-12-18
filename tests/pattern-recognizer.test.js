import { jest } from '@jest/globals';
import PatternRecognizer from '../assets/js/utils/patternRecognition.ts';

describe('PatternRecognizer', () => {
  const createAnalyser = (responses) => {
    let call = 0;
    return {
      getFrequencyData: jest.fn(() => responses[call++]),
    };
  };

  test('updatePatternBuffer stores analyser data as arrays', () => {
    const analyser = createAnalyser([new Uint8Array([1, 2, 3])]);
    const recognizer = new PatternRecognizer(analyser, 2);

    recognizer.updatePatternBuffer();

    expect(analyser.getFrequencyData).toHaveBeenCalled();
    expect(recognizer.patternBuffer.length).toBe(2);
    expect(Array.from(recognizer.patternBuffer[0])).toEqual([1, 2, 3]);
  });

  test('detectPattern returns pattern when consecutive data matches exactly', () => {
    const matchingData = [new Uint8Array([1, 1, 1]), new Uint8Array([1, 1, 1])];
    const analyser = createAnalyser(matchingData);
    const recognizer = new PatternRecognizer(analyser, 2);

    recognizer.updatePatternBuffer();
    recognizer.updatePatternBuffer();

    const result = recognizer.detectPattern();
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([...matchingData[1]]);
  });

  test('detectPattern respects tolerance when patterns are close', () => {
    const nearMatches = [
      new Uint8Array([10, 20, 30]),
      new Uint8Array([12, 19, 29]),
    ];
    const analyser = createAnalyser(nearMatches);
    const recognizer = new PatternRecognizer(analyser, 2);

    recognizer.updatePatternBuffer();
    recognizer.updatePatternBuffer();

    const result = recognizer.detectPattern();
    expect(Array.from(result)).toEqual([...nearMatches[1]]);
  });

  test('detectPattern returns a copy that is not mutated by later writes', () => {
    const sequences = [
      new Uint8Array([5, 5, 5]),
      new Uint8Array([5, 5, 5]),
      new Uint8Array([9, 9, 9]),
    ];
    const analyser = createAnalyser(sequences);
    const recognizer = new PatternRecognizer(analyser, 2);

    recognizer.updatePatternBuffer();
    recognizer.updatePatternBuffer();

    const result = recognizer.detectPattern();
    expect(Array.from(result)).toEqual([5, 5, 5]);

    recognizer.updatePatternBuffer();

    expect(Array.from(result)).toEqual([5, 5, 5]);
  });

  test('detectPattern returns null when patterns differ beyond tolerance', () => {
    const mismatchedData = [
      new Uint8Array([1, 1, 1]),
      new Uint8Array([200, 200, 200]),
    ];
    const analyser = createAnalyser(mismatchedData);
    const recognizer = new PatternRecognizer(analyser, 2);

    recognizer.updatePatternBuffer();
    recognizer.updatePatternBuffer();

    const result = recognizer.detectPattern();
    expect(result).toBeNull();
  });
});
