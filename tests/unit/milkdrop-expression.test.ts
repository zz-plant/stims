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

  test('implements NS-EEL logical bor/band/bnot and operators with the close factor', () => {
    const cases: Array<[string, number]> = [
      ['bnot(0)', 1],
      ['bnot(0.000001)', 1],
      ['bnot(1)', 0],
      ['bnot(-2)', 0],
      ['!0', 1],
      ['!0.000001', 1],
      ['!1', 0],
      ['band(0.5, 0.5)', 1],
      ['band(1, 0)', 0],
      ['0.5 && 0.5', 1],
      ['1 && 0.000001', 0],
      ['bor(0, 0.25)', 1],
      ['bor(0, 0)', 0],
      ['0 || 0.25', 1],
      ['0.000001 || 0', 0],
      ['if(0.000001, 10, 20)', 20],
      ['if(0.5, 10, 20)', 10],
      ['equal(1.000001, 1.0)', 1],
      ['equal(1.1, 1.0)', 0],
      ['log(0)', 0],
      ['log(-5)', 0],
      ['log10(0)', 0],
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

  describe('numeric literals', () => {
    function evaluate(source: string) {
      const parsed = parseMilkdropExpression(source, 1);
      expect(parsed.diagnostics).toEqual([]);
      if (!parsed.value) {
        throw new Error(`Expected "${source}" to parse.`);
      }
      return evaluateMilkdropExpression(parsed.value, {});
    }

    // Exponent and hex forms are part of the EEL literal grammar that
    // `scripts/butterchurn-eel-transpiler.ts` accepts, so a preset that tool
    // can emit — or any preset imported from the wild — must parse here too.
    // Both were previously rejected outright as trailing tokens.
    test.each([
      ['1e3', 1000],
      ['1E3', 1000],
      ['1e-08', 1e-8],
      ['1E+3', 1000],
      ['1.5e-3', 0.0015],
      ['2.5E+2', 250],
      ['0x10', 16],
      ['0X1F', 31],
      ['0xff', 255],
    ])('parses %s', (source, expected) => {
      expect(evaluate(source)).toBeCloseTo(expected, 12);
    });

    test('reads exponent literals inside larger expressions', () => {
      expect(evaluate('1.5e-3*2')).toBeCloseTo(0.003, 12);
      expect(evaluate('max(1e-2, 1e-3)')).toBeCloseTo(0.01, 12);
    });

    test('keeps the plain decimal forms it already accepted', () => {
      expect(evaluate('.5+.25')).toBeCloseTo(0.75, 12);
      expect(evaluate('5.+1')).toBeCloseTo(6, 12);
      expect(evaluate('1_000')).toBeCloseTo(1000, 12);
    });

    test('still reports a malformed literal instead of silently truncating', () => {
      // `Number.parseFloat("1.2.3")` is 1.2, so without the grammar check this
      // would evaluate to a plausible wrong number with no diagnostic.
      const parsed = parseMilkdropExpression('1.2.3', 1);
      expect(parsed.diagnostics[0]?.code).toBe('expr_invalid_number');
    });

    test('leaves a trailing `e` as Euler rather than swallowing it', () => {
      // `e` is an intrinsic constant, so consuming an exponent suffix has to
      // require a digit after the optional sign — otherwise `e-1` and `2*e`
      // would tokenize as broken numbers.
      expect(evaluate('e-1')).toBeCloseTo(Math.E - 1, 12);
      expect(evaluate('2*e')).toBeCloseTo(2 * Math.E, 12);
    });
  });
});
