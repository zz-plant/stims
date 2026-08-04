import { describe, expect, test } from 'bun:test';
import {
  evaluateMilkdropExpression,
  parseMilkdropExpression,
  parseMilkdropStatement,
} from '../../src/js/milkdrop/expression.ts';

describe('milkdrop expression', () => {
  test('supports AVS-style integer math and logical helpers', () => {
    // `|` and `&` operators are bitwise integer ops, while the bor/band/bnot
    // functions are NS-EEL logical ops returning 0/1.
    const parsed = parseMilkdropExpression(
      'int(-1.8) + (5.9 % 4.2) + (5.9 | 2.2) + (7.9 & 3.1) + sqr(1.5) + bor(1, 4) + band(7, 6) + bnot(0)',
      1,
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.value).not.toBeNull();
    if (!parsed.value) {
      throw new Error('Expected expression to parse.');
    }
    expect(evaluateMilkdropExpression(parsed.value, {})).toBeCloseTo(15.25, 6);
  });

  test('implements NS-EEL logical bor/band/bnot with the close factor', () => {
    const cases: Array<[string, number]> = [
      ['bnot(0)', 1],
      ['bnot(0.000001)', 1],
      ['bnot(1)', 0],
      ['bnot(-2)', 0],
      ['band(0.5, 0.5)', 1],
      ['band(1, 0)', 0],
      ['bor(0, 0.25)', 1],
      ['bor(0, 0)', 0],
    ];
    for (const [source, expected] of cases) {
      const parsed = parseMilkdropExpression(source, 1);
      expect(parsed.value).not.toBeNull();
      if (!parsed.value) {
        throw new Error('Expected expression to parse.');
      }
      expect(evaluateMilkdropExpression(parsed.value, {})).toBe(expected);
    }
  });

  test('evaluates every exec2/exec3 argument and returns the last one', () => {
    const parsed = parseMilkdropExpression(
      'exec2(megabuf(0), 3) + exec3(1, 2, 7)',
      1,
    );

    expect(parsed.value).not.toBeNull();
    if (!parsed.value) {
      throw new Error('Expected expression to parse.');
    }
    const megabufReads: number[] = [];
    const result = evaluateMilkdropExpression(
      parsed.value,
      {},
      {
        megabuf: (index) => {
          megabufReads.push(index);
          return 0;
        },
      },
    );
    expect(result).toBe(10);
    expect(megabufReads).toEqual([0]);
  });

  test('resolves legacy aliases against canonical environment keys', () => {
    const parsed = parseMilkdropExpression('echo_orient + fGammaAdj', 1);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.value).not.toBeNull();
    if (!parsed.value) {
      throw new Error('Expected expression to parse.');
    }

    expect(
      evaluateMilkdropExpression(parsed.value, {
        video_echo_orientation: 3,
        gammaadj: 1.25,
      }),
    ).toBeCloseTo(4.25, 6);
  });

  test('parses megabuf reads and writes as indexed VM statements', () => {
    const write = parseMilkdropStatement('megabuf(q1) = bass', 1);
    const read = parseMilkdropExpression('megabuf(q1)', 1);

    expect(write.diagnostics).toEqual([]);
    expect(write.value?.target).toBe('megabuf');
    expect(write.value?.targetExpression?.type).toBe('identifier');
    expect(read.diagnostics).toEqual([]);
    expect(read.value?.type).toBe('call');
  });
});
