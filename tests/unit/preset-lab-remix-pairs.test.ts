/**
 * lab:remix-pairs: what counts as an edit between a base work and its remix.
 *
 * The dataset is only useful if its "changes" are real edits. The cases here
 * pin the three ways a naive text diff lies: a default written out on one
 * side and omitted on the other, a renumbered equation block, and settings
 * on a custom shape that is switched off and so never drawn.
 */
import { describe, expect, test } from 'bun:test';
import {
  diffPresets,
  listRemixPairs,
} from '../../scripts/preset-lab-remix-pairs.ts';

const base = `[preset00]
fDecay=0.980000
zoom=1.000000
per_frame_1=zoom = 1 + 0.1*bass;
per_frame_2=rot = 0.01*time;
`;

describe('diffPresets', () => {
  test('a preset against itself has no changes and similarity 1', () => {
    const diff = diffPresets(base, base);
    expect(diff.scalarChanges).toEqual([]);
    expect(diff.programChanges).toEqual([]);
    expect(diff.similarity).toBe(1);
  });

  test('a written-out default is not an edit', () => {
    // bAdditiveWaves defaults to 0 and wave_a to its default; writing either
    // out explicitly changes nothing about the preset.
    const verbose = base.replace(
      '[preset00]\n',
      '[preset00]\nbAdditiveWaves=0\nfDecay=0.98\n',
    );
    const diff = diffPresets(base, verbose);
    expect(diff.scalarChanges).toEqual([]);
    expect(diff.programChanges).toEqual([]);
  });

  test('a changed setting is reported once, by its effective value', () => {
    const diff = diffPresets(
      base,
      base.replace('fDecay=0.980000', 'fDecay=0.950000'),
    );
    expect(diff.scalarChanges).toEqual([
      { key: 'decay', before: 0.98, after: 0.95 },
    ]);
    expect(diff.similarity).toBeLessThan(1);
  });

  test('inserting an equation line is one program change, not a renumbering', () => {
    const inserted = base.replace(
      'per_frame_1=zoom = 1 + 0.1*bass;\nper_frame_2=rot = 0.01*time;',
      'per_frame_1=wave_r = 0.5 + 0.5*sin(time);\nper_frame_2=zoom = 1 + 0.1*bass;\nper_frame_3=rot = 0.01*time;',
    );
    const diff = diffPresets(base, inserted);
    expect(diff.programChanges).toHaveLength(1);
    expect(diff.programChanges[0]?.block).toBe('per_frame');
    expect(diff.programChanges[0]?.after?.split('\n')).toEqual([
      'wave_r = 0.5 + 0.5*sin(time);',
      'zoom = 1 + 0.1*bass;',
      'rot = 0.01*time;',
    ]);
  });

  test('reformatting whitespace in a program is not an edit', () => {
    const reformatted = base.replace(
      'zoom = 1 + 0.1*bass;',
      'zoom=1+0.1*bass;',
    );
    expect(diffPresets(base, reformatted).programChanges).toEqual([]);
  });

  test('settings of a shape that stays disabled are ignored', () => {
    const withShape = `${base}shapecode_0_enabled=0\nshapecode_0_r=0.2\n`;
    const recoloured = `${base}shapecode_0_enabled=0\nshapecode_0_r=0.9\n`;
    expect(diffPresets(withShape, recoloured).scalarChanges).toEqual([]);
  });

  test('enabling a shape surfaces the flag and its settings', () => {
    const off = `${base}shapecode_0_enabled=0\nshapecode_0_r=0.2\n`;
    const on = `${base}shapecode_0_enabled=1\nshapecode_0_r=0.9\n`;
    const keys = diffPresets(off, on).scalarChanges.map((change) => change.key);
    expect(keys).toContain('shapecode_0_enabled');
    expect(keys).toContain('shapecode_0_r');
  });
});

describe('listRemixPairs', () => {
  const entry = (id: string, title: string, author: string) => ({
    id,
    title,
    author,
  });

  test('pairs the base work with every remix, and skips lone works', () => {
    const pairs = listRemixPairs([
      entry('root', 'Aderrasi - Airhandler', 'Aderrasi'),
      entry('kali', 'Aderrasi - Airhandler (Kali Mix)', 'Aderrasi'),
      entry('square', 'Aderrasi + Geiss - Airhandler (Square Mix)', 'Aderrasi'),
      entry('casino', 'Geiss - Casino', 'Geiss'),
    ]);
    expect(pairs.map((pair) => [pair.parent.id, pair.child.id])).toEqual([
      ['root', 'kali'],
      ['root', 'square'],
    ]);
    const square = pairs.find((pair) => pair.child.id === 'square');
    expect(square?.family).toBe('airhandler');
    expect(square?.child.mixName).toBe('Square Mix');
    expect(square?.child.addedAuthors).toEqual(['Geiss']);
    expect(square?.parent.title).toBe('Aderrasi - Airhandler');
  });
});
