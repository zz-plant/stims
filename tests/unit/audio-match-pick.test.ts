import { describe, expect, test } from 'bun:test';
import { pickAudioMatch } from '../../src/js/core/services/audio-matcher.ts';

const ranks: Record<string, number> = {
  'curated-pick': 11,
  'deep-catalog': 1349,
};
const rankOf = (presetId: string) => ranks[presetId];

describe('pickAudioMatch', () => {
  test('among results the similarity cannot separate, the best-curated preset wins', () => {
    expect(
      pickAudioMatch(
        [
          { presetId: 'deep-catalog', score: 0.931 },
          { presetId: 'curated-pick', score: 0.925 },
        ],
        rankOf,
      )?.presetId,
    ).toBe('curated-pick');
  });

  test('a clearly better match is not overruled by curation', () => {
    expect(
      pickAudioMatch(
        [
          { presetId: 'deep-catalog', score: 0.95 },
          { presetId: 'curated-pick', score: 0.8 },
        ],
        rankOf,
      )?.presetId,
    ).toBe('deep-catalog');
  });

  test('offers nothing below the similarity floor, and nothing for no results', () => {
    expect(
      pickAudioMatch([{ presetId: 'curated-pick', score: 0.6 }], rankOf),
    ).toBeNull();
    expect(pickAudioMatch([], rankOf)).toBeNull();
  });

  test('an unranked preset loses a tie to a ranked one', () => {
    expect(
      pickAudioMatch(
        [
          { presetId: 'unranked', score: 0.9 },
          { presetId: 'deep-catalog', score: 0.9 },
        ],
        rankOf,
      )?.presetId,
    ).toBe('deep-catalog');
  });
});
