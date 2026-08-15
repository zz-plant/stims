import { describe, expect, test } from 'bun:test';
import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import {
  getAuthorOptions,
  matchesAuthor,
  resolveAuthorUrl,
} from '../../src/js/frontend/workspace-helpers.ts';

const entry = (id: string, author?: string): PresetCatalogEntry => ({
  id,
  title: id,
  author,
});

/**
 * MilkDrop bylines are accretive credit chains. Filtering on the raw author
 * string split one author across spelling variants and hid anyone who never
 * published solo, so these guard the chain-aware behavior.
 */
describe('getAuthorOptions', () => {
  test('lists individual handles, not raw byline strings', () => {
    const options = getAuthorOptions([
      entry('a', 'Eo.S. + Phat'),
      entry('b', 'Krash & Rovastar'),
    ]);
    expect(options).toEqual(['Eo.S.', 'Krash', 'Phat', 'Rovastar']);
  });

  test('folds spelling variants of one author into a single option', () => {
    const options = getAuthorOptions([
      entry('a', 'Geiss'),
      entry('b', '_Geiss'),
      entry('c', 'geiss'),
      entry('d', 'Ryan Geiss'),
    ]);
    expect(options).toEqual(['Geiss']);
  });

  test('surfaces an author who only ever appears mid-chain', () => {
    // 102 catalog presets credit Phat; only 5 name him alone.
    const options = getAuthorOptions([
      entry('a', 'Eo.S. + Phat'),
      entry('b', 'Flexi + Phat'),
    ]);
    expect(options).toContain('Phat');
  });

  test('omits the Unknown placeholder', () => {
    expect(getAuthorOptions([entry('a', 'Unknown'), entry('b')])).toEqual([]);
  });
});

describe('matchesAuthor', () => {
  test('matches a handle anywhere in the chain', () => {
    const preset = entry('a', 'Stahlregen & Geiss + Rovastar + Krash');
    expect(matchesAuthor(preset, 'Krash')).toBe(true);
    expect(matchesAuthor(preset, 'Geiss')).toBe(true);
    expect(matchesAuthor(preset, 'Flexi')).toBe(false);
  });

  test('is insensitive to which spelling the filter was built from', () => {
    expect(matchesAuthor(entry('a', '_fishbrain + flexi'), 'fiShbRaiN')).toBe(
      true,
    );
  });

  test('a null filter keeps everything', () => {
    expect(matchesAuthor(entry('a', 'Geiss'), null)).toBe(true);
  });

  test('every listed option matches at least one preset', () => {
    const catalog = [
      entry('a', 'Eo.S. + Phat'),
      entry('b', 'Krash & Rovastar'),
      entry('c', '_Geiss'),
    ];
    for (const option of getAuthorOptions(catalog)) {
      expect(catalog.some((preset) => matchesAuthor(preset, option))).toBe(
        true,
      );
    }
  });
});

describe('resolveAuthorUrl', () => {
  test('links an author only to a page they publish under', () => {
    expect(resolveAuthorUrl('Geiss')).toContain('geisswerks.com');
    expect(resolveAuthorUrl('_Geiss')).toContain('geisswerks.com');
  });

  test('does not link a multi-author chain to one of its hands', () => {
    expect(resolveAuthorUrl('Flexi + Geiss')).toBeUndefined();
  });

  test('leaves an author with no published page unlinked', () => {
    expect(resolveAuthorUrl('Phat')).toBeUndefined();
    expect(resolveAuthorUrl('Stahlregen')).toBeUndefined();
  });

  test('an explicit per-preset URL always wins', () => {
    expect(resolveAuthorUrl('Phat', 'https://example.invalid/phat')).toBe(
      'https://example.invalid/phat',
    );
  });
});
