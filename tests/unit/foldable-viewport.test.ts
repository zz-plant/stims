import { describe, expect, test } from 'bun:test';
import {
  foldLayoutOf,
  readFoldableViewport,
  rotatingWidensWindow,
} from '../../src/js/utils/foldable-viewport';

describe('foldable viewport progressive enhancement', () => {
  test('returns unknown posture and one segment when APIs are missing', () => {
    expect(readFoldableViewport({ innerWidth: 382, innerHeight: 580 })).toEqual(
      {
        posture: 'unknown',
        width: 382,
        height: 580,
        segments: [{ x: 0, y: 0, width: 382, height: 580 }],
      },
    );
  });

  test('preserves a standards-style segmented viewport', () => {
    const state = readFoldableViewport({
      innerWidth: 900,
      innerHeight: 700,
      navigator: { devicePosture: { type: 'folded' } },
      viewport: {
        segments: [
          { x: 0, y: 0, width: 440, height: 700 },
          { x: 460, y: 0, width: 440, height: 700 },
        ],
      },
    });
    expect(state.posture).toBe('folded');
    expect(state.segments).toHaveLength(2);
    expect(state.segments[1]?.x).toBe(460);
  });

  test('rejects invalid segment geometry and posture values', () => {
    const state = readFoldableViewport({
      innerWidth: 500,
      innerHeight: 600,
      navigator: { devicePosture: { type: 'tent' } },
      viewport: { segments: [{ x: 0, y: 0, width: Number.NaN, height: 600 }] },
    });
    expect(state.posture).toBe('unknown');
    expect(state.segments).toEqual([{ x: 0, y: 0, width: 500, height: 600 }]);
  });
});

describe('foldLayoutOf', () => {
  const left = { x: 0, y: 0, width: 465, height: 585 };
  const right = { x: 485, y: 0, width: 466, height: 585 };
  const upper = { x: 0, y: 0, width: 669, height: 423 };
  const lower = { x: 0, y: 443, width: 669, height: 424 };

  test('names side-by-side segments a book and stacked ones a laptop', () => {
    expect(foldLayoutOf([left, right])).toBe('book');
    expect(foldLayoutOf([upper, lower])).toBe('laptop');
  });

  test('calls one segment flat, and anything it has no layout for', () => {
    expect(foldLayoutOf([upper])).toBe('flat');
    expect(foldLayoutOf([])).toBe('flat');
    expect(foldLayoutOf([left, right, lower])).toBe('flat');
  });
});

describe('rotatingWidensWindow', () => {
  test('is true for a window filling the screen', () => {
    expect(
      rotatingWidensWindow({
        innerWidth: 669,
        innerHeight: 867,
        screen: { width: 669, height: 951 },
      }),
    ).toBe(true);
  });

  test('is true when the browser reports no screen', () => {
    expect(rotatingWidensWindow({ innerWidth: 390, innerHeight: 844 })).toBe(
      true,
    );
  });

  test('is false for one of two windows sharing the screen', () => {
    expect(
      rotatingWidensWindow({
        innerWidth: 385,
        innerHeight: 571,
        screen: { width: 951, height: 669 },
      }),
    ).toBe(false);
  });

  test('is false on a half-folded device, which is posed on purpose', () => {
    expect(
      rotatingWidensWindow({
        innerWidth: 669,
        innerHeight: 867,
        screen: { width: 669, height: 951 },
        viewport: {
          segments: [
            { x: 0, y: 0, width: 669, height: 423 },
            { x: 0, y: 443, width: 669, height: 424 },
          ],
        },
      }),
    ).toBe(false);
  });
});
