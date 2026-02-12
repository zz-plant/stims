import { describe, expect, mock, test } from 'bun:test';
import PatternRecognizer from '../assets/js/utils/patternRecognition.ts';

describe('PatternRecognizer', () => {
  const createAnalyser = (responses) => {
    let call = 0;
    return {
      getFrequencyData: mock(() => responses[call++]),
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

  test('comparePatterns returns false for empty or uneven patterns', () => {
    const analyser = createAnalyser([new Uint8Array([1])]);
    const recognizer = new PatternRecognizer(analyser, 2);

    expect(
      recognizer.comparePatterns(new Uint8Array([]), new Uint8Array([])),
    ).toBe(false);
    expect(
      recognizer.comparePatterns(new Uint8Array([1, 2]), new Uint8Array([1])),
    ).toBe(false);
  });

  test('comparePatterns clamps invalid tolerance values', () => {
    const analyser = createAnalyser([new Uint8Array([1])]);
    const recognizer = new PatternRecognizer(analyser, 2);

    expect(
      recognizer.comparePatterns(
        new Uint8Array([10, 10]),
        new Uint8Array([10, 10]),
        Number.NaN,
      ),
    ).toBe(true);
    expect(
      recognizer.comparePatterns(
        new Uint8Array([10, 10]),
        new Uint8Array([15, 15]),
        -1,
      ),
    ).toBe(true);
    expect(
      recognizer.comparePatterns(
        new Uint8Array([10, 10]),
        new Uint8Array([10, 11]),
        2,
      ),
    ).toBe(false);
  });
});
