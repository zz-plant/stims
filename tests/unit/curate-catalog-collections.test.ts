/**
 * Hall-of-fame authors are matched as whole names inside the catalog's
 * collaborator strings, not as substrings of any author.
 */
import { describe, expect, test } from 'bun:test';
import { isHallOfFameAuthor } from '../../scripts/curate-catalog-collections.ts';

describe('isHallOfFameAuthor', () => {
  test('a listed name inside a collaboration counts', () => {
    expect(isHallOfFameAuthor('_Che + Geiss')).toBe(true);
    expect(isHallOfFameAuthor('Rozzor & Che')).toBe(true);
    expect(isHallOfFameAuthor('Phat_Rovastar')).toBe(true);
    expect(isHallOfFameAuthor('Eo.S.+Phat')).toBe(true);
    expect(isHallOfFameAuthor('Idiot24-7')).toBe(true);
  });

  test('a listed name inside a longer word does not', () => {
    // `che` and `orb` put both of these in the hall of fame
    expect(isHallOfFameAuthor('niko radiative bunchess')).toBe(false);
    expect(isHallOfFameAuthor('Orbasonic')).toBe(false);
  });

  test('a missing author is not a member', () => {
    expect(isHallOfFameAuthor(undefined)).toBe(false);
  });
});
