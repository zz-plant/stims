import { describe, expect, test } from 'bun:test';
import {
  deriveMashupCredit,
  deriveRemixCredit,
  formatPresetCredit,
  formatPresetWorkTitle,
  parsePresetCredit,
  presetFamilyKey,
  splitPresetDisplay,
} from '../../src/js/milkdrop/preset-credit.ts';

describe('parsePresetCredit', () => {
  test('single author, plain title', () => {
    const credit = parsePresetCredit('Geiss - Casino');
    expect(credit.authors).toEqual(['Geiss']);
    expect(credit.title).toBe('Casino');
    expect(credit.mixName).toBeNull();
    expect(credit.editNote).toBeNull();
    expect(credit.mashupOf).toBeNull();
  });

  test('accretive three-deep chain', () => {
    const credit = parsePresetCredit('Stahlregen + Geiss + Shifter - Babylon');
    expect(credit.authors).toEqual(['Stahlregen', 'Geiss', 'Shifter']);
    expect(credit.title).toBe('Babylon');
  });

  test('mixed separators in a six-author byline with mix name', () => {
    const credit = parsePresetCredit(
      'Stahlregen & Geiss + Rovastar + Illusion + Krash + Rozzor - Cyclopean Shift (Eyeless Mix)',
    );
    expect(credit.authors).toEqual([
      'Stahlregen',
      'Geiss',
      'Rovastar',
      'Illusion',
      'Krash',
      'Rozzor',
    ]);
    expect(credit.title).toBe('Cyclopean Shift');
    expect(credit.mixName).toBe('Eyeless Mix');
  });

  test('comma and "and" as author separators', () => {
    expect(
      parsePresetCredit('Flexi, Rovastar + Geiss - Fractopia').authors,
    ).toEqual(['Flexi', 'Rovastar', 'Geiss']);
    expect(
      parsePresetCredit('Illusion and Rovastar - Grand Odyssey Mod').authors,
    ).toEqual(['Illusion', 'Rovastar']);
  });

  test('dotted names survive author splitting', () => {
    const credit = parsePresetCredit('Eo.S. + Phat - Cubetrace v2');
    expect(credit.authors).toEqual(['Eo.S.', 'Phat']);
    expect(credit.title).toBe('Cubetrace v2');
  });

  test('vs marks a mashup of two named presets', () => {
    const credit = parsePresetCredit(
      'Flexi, Rovastar + Geiss - Fractopia vs Bas Relief',
    );
    expect(credit.mashupOf).toEqual(['Fractopia', 'Bas Relief']);
    expect(credit.title).toBe('Fractopia vs Bas Relief');
  });

  test('parenthetical mix name containing a dash stays intact', () => {
    const credit = parsePresetCredit(
      'Aderrasi - Airhandler (Last Breath - Calm)',
    );
    expect(credit.authors).toEqual(['Aderrasi']);
    expect(credit.title).toBe('Airhandler');
    expect(credit.mixName).toBe('Last Breath - Calm');
  });

  test('bracketed edit marker after a mix name', () => {
    const credit = parsePresetCredit(
      'Aderrasi + Flexi - Airhandler (Last Breath - Calm) [moebius morbid vision edit]',
    );
    expect(credit.authors).toEqual(['Aderrasi', 'Flexi']);
    expect(credit.mixName).toBe('Last Breath - Calm');
    expect(credit.editNote).toBe('moebius morbid vision edit');
  });

  test('slug-dash hazard: only the first dash splits the author', () => {
    const credit = parsePresetCredit(
      'Eos - Dark - Side - Of - The - Moon - Clean - Mix',
    );
    expect(credit.authors).toEqual(['Eos']);
    expect(credit.title).toBe('Dark - Side - Of - The - Moon - Clean - Mix');
  });

  test('no convention: falls back to the author hint', () => {
    const credit = parsePresetCredit('My First Preset', 'kanav');
    expect(credit.authors).toEqual(['kanav']);
    expect(credit.title).toBe('My First Preset');
  });

  test('parenthetical-only title is not treated as a mix name', () => {
    const credit = parsePresetCredit('(untitled)');
    expect(credit.title).toBe('(untitled)');
    expect(credit.mixName).toBeNull();
  });
});

describe('format round-trips', () => {
  test.each([
    'Stahlregen + Geiss + Shifter - Babylon',
    'Krash + Rovastar - Cerebral Demons (Stars Remix)',
    'Aderrasi + Geiss - Airhandler (Square Mix)',
    'Aderrasi + Flexi - Airhandler (Last Breath - Calm) [moebius morbid vision edit]',
  ])('parse → format is identity for %s', (title) => {
    expect(formatPresetCredit(parsePresetCredit(title))).toBe(title);
  });

  test('work title drops the byline but keeps lineage markers', () => {
    const credit = parsePresetCredit(
      'Zylot - In Death There Is Life (Geiss Layered Mix)',
    );
    expect(formatPresetWorkTitle(credit)).toBe(
      'In Death There Is Life (Geiss Layered Mix)',
    );
  });
});

describe('splitPresetDisplay', () => {
  test('strips the redundant author prefix for byline surfaces', () => {
    expect(
      splitPresetDisplay('Eo.S. + Phat - Cubetrace v2', 'Eo.S. + Phat'),
    ).toEqual({
      title: 'Cubetrace v2',
      byline: 'Eo.S. + Phat',
    });
  });

  test('title chain wins over a narrower stored author field', () => {
    const { title, byline } = splitPresetDisplay(
      'shifter + Aderrasi - Airhandler (Sadako)',
      'shifter',
    );
    expect(title).toBe('Airhandler (Sadako)');
    expect(byline).toBe('shifter + Aderrasi');
  });

  test('unconventional titles pass through untouched', () => {
    expect(splitPresetDisplay('My First Preset')).toEqual({
      title: 'My First Preset',
      byline: null,
    });
  });
});

describe('presetFamilyKey', () => {
  test('every mix and author combination of a work shares one family', () => {
    const family = [
      'Aderrasi - Airhandler (Kali Mix)',
      'Aderrasi + Geiss - Airhandler (Square Mix)',
      'shifter + Aderrasi - Airhandler (Sadako)',
      'beta106i - Airhandler (Last Breath - Crab Handler)',
    ].map((title) => presetFamilyKey(parsePresetCredit(title)));
    expect(new Set(family).size).toBe(1);
    expect(family[0]).toBe('airhandler');
  });
});

describe('deriveRemixCredit', () => {
  const root = parsePresetCredit('Aderrasi - Airhandler');
  const mixed = parsePresetCredit('Aderrasi - Airhandler (Kali Mix)');

  test('named remixer joins the byline and names the mix', () => {
    const credit = deriveRemixCredit(root, { remixer: 'Geiss' });
    expect(formatPresetCredit(credit)).toBe(
      'Aderrasi + Geiss - Airhandler (Geiss Mix)',
    );
  });

  test('anonymous remix of a root work gains the mix slot', () => {
    expect(formatPresetCredit(deriveRemixCredit(root))).toBe(
      'Aderrasi - Airhandler (Remix)',
    );
  });

  test('remix of an existing mix keeps it and gains an edit marker', () => {
    expect(formatPresetCredit(deriveRemixCredit(mixed))).toBe(
      'Aderrasi - Airhandler (Kali Mix) [remix]',
    );
  });

  test('serial disambiguates repeated remixes', () => {
    expect(formatPresetCredit(deriveRemixCredit(root, { serial: 2 }))).toBe(
      'Aderrasi - Airhandler (Remix 2)',
    );
    expect(formatPresetCredit(deriveRemixCredit(mixed, { serial: 3 }))).toBe(
      'Aderrasi - Airhandler (Kali Mix) [remix 3]',
    );
  });

  test('explicit mix name replaces the slot without stacking markers', () => {
    const credit = deriveRemixCredit(mixed, {
      remixer: 'Stars',
      mixName: 'Stars Remix',
    });
    expect(formatPresetCredit(credit)).toBe(
      'Aderrasi + Stars - Airhandler (Stars Remix)',
    );
  });

  test('remixer already in the chain is not duplicated', () => {
    const credit = deriveRemixCredit(root, { remixer: 'aderrasi' });
    expect(credit.authors).toEqual(['Aderrasi']);
  });
});

describe('deriveMashupCredit', () => {
  test('unions author chains and joins titles with vs', () => {
    const a = parsePresetCredit('Rovastar - Fractopia');
    const b = parsePresetCredit('Geiss + Rovastar - Bas Relief');
    const credit = deriveMashupCredit(a, b, { remixer: 'Flexi' });
    expect(formatPresetCredit(credit)).toBe(
      'Rovastar + Geiss + Flexi - Fractopia vs Bas Relief',
    );
    expect(credit.mashupOf).toEqual(['Fractopia', 'Bas Relief']);
  });
});
