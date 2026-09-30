/**
 * The hall of fame is a hand-picked list: curating tags exactly those
 * presets, takes the tag off every other one, and refuses a list naming a
 * preset the catalog no longer has.
 */
import { describe, expect, test } from 'bun:test';
import {
  curateHallOfFame,
  HALL_OF_FAME,
} from '../../scripts/curate-catalog-collections.ts';

const TAG = 'collection:hall-of-fame';
const entry = (id: string, tags: string[] = []) => ({
  id,
  title: id,
  file: `/milkdrop-presets/${id}.milk`,
  tags,
});

describe('curateHallOfFame', () => {
  test('tags every listed preset and nothing else', () => {
    const presets = [
      ...HALL_OF_FAME.map((id) => entry(id)),
      // tagged by the old author rule; not a classic
      entry('rovastar-studiomusic-morecherish', [
        TAG,
        'collection:butterchurn',
      ]),
    ];
    expect(curateHallOfFame(presets)).toBe(HALL_OF_FAME.length);
    const tagged = presets.filter((p) => p.tags.includes(TAG)).map((p) => p.id);
    expect(tagged).toEqual([...HALL_OF_FAME]);
    expect(presets.at(-1)?.tags).toEqual(['collection:butterchurn']);
  });

  test('a listed preset missing from the catalog fails the run', () => {
    const presets = HALL_OF_FAME.slice(1).map((id) => entry(id));
    expect(() => curateHallOfFame(presets)).toThrow(HALL_OF_FAME[0]);
  });
});
