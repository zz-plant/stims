import { describe, expect, test } from 'bun:test';

import { mapFrequencyToItems } from '../assets/js/utils/audio-mapper';

describe('mapFrequencyToItems', () => {
  test('maps bins to items with single-sample mode by default', () => {
    const items = ['a', 'b', 'c'];
    const values: number[] = [];

    mapFrequencyToItems(
      new Uint8Array([10, 20, 30, 40, 50, 60]),
      items,
      (_item, _index, value) => {
        values.push(value);
      },
    );

    expect(values).toEqual([10, 30, 50]);
  });

  test('can average each item bin range when requested', () => {
    const items = ['a', 'b', 'c'];
    const values: number[] = [];

    mapFrequencyToItems(
      new Uint8Array([10, 20, 30, 40, 50, 60]),
      items,
      (_item, _index, value) => {
        values.push(value);
      },
      { sampleWindow: 'average' },
    );

    expect(values).toEqual([15, 35, 55]);
  });

  test('uses explicit fallback values including zero', () => {
    const firstValues: number[] = [];
    const secondValues: number[] = [];

    mapFrequencyToItems(new Uint8Array([]), ['a'], (_item, _index, value) => {
      firstValues.push(value);
    });

    mapFrequencyToItems(
      new Uint8Array([]),
      ['a'],
      (_item, _index, value) => {
        secondValues.push(value);
      },
      { fallbackValue: 0 },
    );

    expect(firstValues).toEqual([0]);
    expect(secondValues).toEqual([0]);
  });
});
