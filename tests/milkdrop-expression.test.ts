import { describe, expect, test } from 'bun:test';
import {
  evaluateMilkdropExpression,
  parseMilkdropExpression,
  parseMilkdropStatement,
} from '../assets/js/milkdrop/expression.ts';

describe('milkdrop expression', () => {
  test('supports AVS-style integer math and bitwise helpers', () => {
    const parsed = parseMilkdropExpression(
      'int(-1.8) + (5.9 % 4.2) + (5.9 | 2.2) + (7.9 & 3.1) + sqr(1.5) + bor(1, 4) + band(7, 6) + bnot(0)',
      1,
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.value).not.toBeNull();
    if (!parsed.value) {
      throw new Error('Expected expression to parse.');
    }
    expect(evaluateMilkdropExpression(parsed.value, {})).toBeCloseTo(22.25, 6);
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
