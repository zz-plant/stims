import { describe, expect, test } from 'bun:test';
import {
  evaluateMilkdropExpression,
  parseMilkdropExpression,
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
});
