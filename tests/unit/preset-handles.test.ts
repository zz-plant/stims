import { describe, expect, test } from 'bun:test';
import {
  canonicalHandle,
  creditedHandles,
  creditsHandle,
  isKnownHandle,
  normalizeHandleKey,
  parseLeadingHandles,
  resolveHandleKey,
} from '../../src/js/milkdrop/preset-handles.ts';

describe('normalizeHandleKey', () => {
  test('strips sort-order prefixes, casing, and trailing dots', () => {
    expect(normalizeHandleKey('_Geiss')).toBe('geiss');
    expect(normalizeHandleKey('  _geiss ')).toBe('geiss');
    expect(normalizeHandleKey('Eo.S.')).toBe('eo.s');
    expect(normalizeHandleKey('!!!---flexi')).toBe('flexi');
    expect(normalizeHandleKey('[Ishan]')).toBe('ishan');
  });
});

describe('canonicalHandle', () => {
  test('restores the spelling the author published under', () => {
    expect(canonicalHandle('fishbrain')).toBe('fiShbRaiN');
    expect(canonicalHandle('fiSHbRAiN')).toBe('fiShbRaiN');
    expect(canonicalHandle('_Eo.S.')).toBe('Eo.S.');
    expect(canonicalHandle('orb')).toBe('ORB');
    expect(canonicalHandle('ryan geiss')).toBe('Geiss');
  });

  test('leaves unregistered handles alone rather than inventing casing', () => {
    expect(canonicalHandle('some new author')).toBe('some new author');
    expect(canonicalHandle('_27_super_goats')).toBe('27_super_goats');
    expect(isKnownHandle('some new author')).toBe(false);
  });

  test('lowercase handles stay lowercase when that is how they published', () => {
    expect(canonicalHandle('Shifter')).toBe('shifter');
    expect(canonicalHandle('suksma')).toBe('suksma');
  });
});

describe('creditedHandles', () => {
  test('returns the whole accretive chain, earliest hand first', () => {
    expect(
      creditedHandles('Stahlregen & Geiss + Rovastar + Illusion + Krash'),
    ).toEqual(['Stahlregen', 'Geiss', 'Rovastar', 'Illusion', 'Krash']);
  });

  test('handles the separators the catalog actually uses', () => {
    expect(creditedHandles('Hexcollie, Bdrv, Geiss, Flexi n Aderrasi')).toEqual(
      ['Hexcollie', 'BDRV', 'Geiss', 'Flexi', 'Aderrasi'],
    );
    expect(creditedHandles('Unchained vs Rovastar vs Zylot')).toEqual([
      'Unchained',
      'Rovastar',
      'Zylot',
    ]);
    expect(creditedHandles('bdrv et.AL Eo.s. + Phat')).toEqual([
      'BDRV',
      'Eo.S.',
      'Phat',
    ]);
  });

  test('deduplicates a handle repeated across spellings', () => {
    expect(creditedHandles('Flexi + flexi + _Flexi')).toEqual(['Flexi']);
  });

  test('drops the Unknown placeholder', () => {
    expect(creditedHandles('Unknown')).toEqual([]);
    expect(creditedHandles('')).toEqual([]);
    expect(creditedHandles(undefined)).toEqual([]);
  });

  test('splits underscore-joined handles only when every part is known', () => {
    expect(creditedHandles('Phat_Eo.S.')).toEqual(['Phat', 'Eo.S.']);
    expect(creditedHandles('Phat_Rovastar')).toEqual(['Phat', 'Rovastar']);
    // Underscores that live *inside* a handle must survive.
    expect(creditedHandles('27_super_goats')).toEqual(['27_super_goats']);
    expect(creditedHandles('Fumbling_Foo & Flexi')).toEqual([
      'Fumbling_Foo',
      'Flexi',
    ]);
  });

  test('splits a space-joined chain only when every part is known', () => {
    expect(creditedHandles('aderassi geiss')).toEqual(['Aderrasi', 'Geiss']);
    // Multi-word handles are known as a whole and must not be shredded.
    expect(creditedHandles('amandio c')).toEqual(['amandio c']);
    expect(creditedHandles('Redi Jedi')).toEqual(['Redi Jedi']);
    expect(creditedHandles('Studio Music')).toEqual(['Studio Music']);
    // An unrecognized phrase stays whole rather than inventing authors.
    expect(creditedHandles('A New Wave Trend in Milk')).toEqual([
      'A New Wave Trend in Milk',
    ]);
  });

  test('equals joins a chain too', () => {
    expect(creditedHandles('Flexi = Phat')).toEqual(['Flexi', 'Phat']);
  });

  test('credits both hands of a tribute, and only the confirmable one otherwise', () => {
    expect(creditedHandles('AdamFX 2 Geiss')).toEqual(['AdamFX', 'Geiss']);
    expect(creditedHandles('A Milk Art Detail 2 flexi')).toEqual(['Flexi']);
  });

  test('a trailing technique credit is not part of the handle', () => {
    expect(creditedHandles('martin [shadow harlequins shape code]')).toEqual([
      'Martin',
    ]);
    // ...but a fully bracketed fragment is a handle, not a technique note.
    expect(creditedHandles('[Ishan]')).toEqual(['Ishan']);
  });
});

describe('creditsHandle', () => {
  test('matches anywhere in the chain, not just a solo byline', () => {
    expect(creditsHandle('Eo.S. + Phat', 'Phat')).toBe(true);
    expect(creditsHandle('Eo.S. + Phat', 'phat')).toBe(true);
    expect(creditsHandle('Eo.S. + Phat', 'Eo.S.')).toBe(true);
    expect(creditsHandle('Eo.S. + Phat', 'Geiss')).toBe(false);
  });

  test('is spelling-insensitive on both sides', () => {
    expect(creditsHandle('_fishbrain + flexi', 'fiShbRaiN')).toBe(true);
    expect(creditsHandle('fiSHbRAiN + Geiss', 'fishbrain')).toBe(true);
  });
});

describe('parseLeadingHandles', () => {
  test('recovers a chain from a title that never used the " - " convention', () => {
    expect(parseLeadingHandles('Eo.S.+Phat -Eater_v2')).toEqual({
      handles: ['Eo.S.', 'Phat'],
      rest: 'Eater_v2',
    });
    expect(parseLeadingHandles('Flexi + Phat fractal Star_Child')).toEqual({
      handles: ['Flexi', 'Phat'],
      rest: 'fractal Star_Child',
    });
  });

  test('refuses to guess at an unrecognized leading token', () => {
    expect(parseLeadingHandles('BrainStain-Blackwidow')).toBeNull();
    expect(parseLeadingHandles('Fvese-butterfly')).toBeNull();
    expect(parseLeadingHandles('444')).toBeNull();
  });

  test('requires a boundary so one handle cannot eat a longer word', () => {
    expect(parseLeadingHandles('27_super_goats-orbus_maximus')).toBeNull();
  });

  test('returns null when no work title survives the chain', () => {
    expect(parseLeadingHandles('Geiss')).toBeNull();
    expect(parseLeadingHandles('Eo.S. + Phat')).toBeNull();
  });

  test('a failed probe does not eat text off the front of the title', () => {
    // "al" is filler, "Phat" is a handle — but "shapes" is not, so the rest
    // must start at "shapes", never mid-word.
    expect(parseLeadingHandles('bdrv + al Phat shapes are cool')).toEqual({
      handles: ['BDRV', 'Phat'],
      rest: 'shapes are cool',
    });
  });
});

describe('resolveHandleKey', () => {
  test('follows aliases to one registry key', () => {
    expect(resolveHandleKey('Ryan Geiss')).toBe('geiss');
    expect(resolveHandleKey('_Geiss')).toBe('geiss');
    expect(resolveHandleKey('Aderassi')).toBe('aderrasi');
    expect(resolveHandleKey('shadow harlequin')).toBe('shadowharlequin');
  });
});
