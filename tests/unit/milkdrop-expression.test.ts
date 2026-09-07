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

  describe('NaN and domain guards', () => {
    function evaluate(source: string) {
      const parsed = parseMilkdropExpression(source, 1);
      expect(parsed.diagnostics).toEqual([]);
      expect(parsed.value).not.toBeNull();
      if (!parsed.value) {
        throw new Error('Expected expression to parse.');
      }
      return evaluateMilkdropExpression(parsed.value, {});
    }

    // These pin the guards from `ec59dcf1` (fix(milkdrop): guard pow and sqrt
    // against NaNs on negative inputs). They shipped untested; if a perf pass
    // strips a guard again, the suite must fail loudly instead of letting NaN
    // poison the per-frame/per-pixel state.
    test('sqrt clamps negative radicands to 0 instead of yielding NaN', () => {
      expect(evaluate('sqrt(-1)')).toBe(0);
      expect(evaluate('sqrt(-16)')).toBe(0);
      expect(evaluate('sqrt(0)')).toBe(0);
      expect(evaluate('sqrt(9)')).toBe(3);
    });

    test('pow maps NaN and Infinity results to 0', () => {
      expect(evaluate('pow(-2, 0.5)')).toBe(0); // negative base, fractional exponent
      expect(evaluate('pow(0, -1)')).toBe(0); // 0^-1 = Infinity
      expect(evaluate('pow(2, 10)')).toBe(1024);
    });

    test('the ^ operator guards NaN results the same way pow does', () => {
      expect(evaluate('(-2)^0.5')).toBe(0);
      expect(evaluate('0^-1')).toBe(0);
      expect(evaluate('2^10')).toBe(1024);
    });

    test('division by zero yields 0, not Infinity', () => {
      expect(evaluate('1/0')).toBe(0);
      expect(evaluate('0/0')).toBe(0);
    });

    test('mod, fmod, and % by zero yield 0', () => {
      expect(evaluate('mod(5, 0)')).toBe(0);
      expect(evaluate('fmod(5, 0)')).toBe(0);
      expect(evaluate('5 % 0')).toBe(0);
    });
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

  describe('compound assignment', () => {
    const runStatement = (source: string, env: Record<string, number>) => {
      const parsed = parseMilkdropStatement(source, 1);
      expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual(
        [],
      );
      if (!parsed.value) {
        throw new Error(`Expected "${source}" to parse.`);
      }
      const value = evaluateMilkdropExpression(parsed.value.expression, env);
      if (parsed.value.target !== '__control') {
        env[parsed.value.target] = value;
      }
      return env;
    };

    test('desugars every compound operator at statement level', () => {
      // ns-eel supports these and the shipped corpus uses them; before, the
      // `=` of `+=` was read as the assignment and `k1 +` as the target, so
      // the statement was rejected as an invalid target.
      expect(runStatement('k1 += 3', { k1: 2 }).k1).toBe(5);
      expect(runStatement('k1 -= 3', { k1: 10 }).k1).toBe(7);
      expect(runStatement('k1 *= 3', { k1: 10 }).k1).toBe(30);
      expect(runStatement('k1 /= 4', { k1: 10 }).k1).toBe(2.5);
      expect(runStatement('k1 %= 3', { k1: 10 }).k1).toBe(1);
    });

    test('keeps the compound operator binding tighter than the value', () => {
      // `x *= 3 + 1` is `x = x * (3 + 1)`, not `x = x * 3 + 1`.
      expect(runStatement('k1 *= 3 + 1', { k1: 2 }).k1).toBe(8);
      expect(runStatement('k1 -= 3 - 1', { k1: 10 }).k1).toBe(8);
    });

    test('desugars nested compound assignment inside an expression', () => {
      // The shape five shipped presets use: `exec2(k1 += v, k1)`. This has no
      // top-level `=`, so failing to parse it dropped the whole statement.
      const env: Record<string, number> = { k1: 2, bass_att: 1 };
      const parsed = parseMilkdropStatement(
        'exec2(k1 += 0.05 * bass_att, k1)',
        1,
      );
      expect(parsed.diagnostics).toEqual([]);
      if (!parsed.value) {
        throw new Error('Expected the exec2 statement to parse.');
      }
      expect(evaluateMilkdropExpression(parsed.value.expression, env)).toBe(
        2.05,
      );
      expect(env.k1).toBe(2.05);
    });

    test('does not mistake a comparison operator for an assignment', () => {
      // `==`, `<=`, `>=` and `!=` all contain an `=`; treating it as the
      // assignment split `x == 1` into the target `x` and the value `= 1`.
      for (const source of ['x == 1', 'x <= 1', 'x >= 1', 'x != 1']) {
        const parsed = parseMilkdropStatement(source, 1);
        expect(
          parsed.diagnostics.filter((d) => d.severity === 'error'),
          source,
        ).toEqual([]);
      }
      expect(runStatement('y = x >= 2', { x: 3 }).y).toBe(1);
    });
  });

  describe('control-flow statements', () => {
    const bodyLength = (source: string) => {
      const parsed = parseMilkdropStatement(source, 1);
      expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual(
        [],
      );
      return parsed.value?.control?.body.length ?? 0;
    };

    test('accepts whitespace and any casing before the opening paren', () => {
      // EEL is whitespace-insensitive and its identifiers are case
      // insensitive. Matching the bare `loop(` prefix dropped `loop (10000,`
      // — head and body together — from shipped presets.
      expect(bodyLength('loop(2, k1 = k1 + 1)')).toBe(1);
      expect(bodyLength('loop (2, k1 = k1 + 1)')).toBe(1);
      expect(bodyLength('LOOP (2, k1 = k1 + 1)')).toBe(1);
      expect(bodyLength('while (below(n, 4), n = n + 1)')).toBe(1);
      expect(bodyLength('While(below(n, 4), n = n + 1)')).toBe(1);
    });

    test('reports an unterminated control statement instead of dropping it', () => {
      const parsed = parseMilkdropStatement('loop (10000,', 1);
      expect(parsed.value).toBeNull();
      expect(parsed.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe('ternary conditional', () => {
    const evaluateStatement = (source: string, env: Record<string, number>) => {
      const parsed = parseMilkdropStatement(source, 1);
      expect(parsed.diagnostics.filter((d) => d.severity === 'error')).toEqual(
        [],
      );
      if (!parsed.value) {
        throw new Error(`Expected "${source}" to parse.`);
      }
      return evaluateMilkdropExpression(parsed.value.expression, env);
    };

    test('picks the branch and binds looser than every other operator', () => {
      expect(evaluateStatement('x = 1 > 0 ? 10 : 20', {})).toBe(10);
      expect(evaluateStatement('x = 0 > 1 ? 10 : 20', {})).toBe(20);
      expect(evaluateStatement('x = 1 + (0 ? 5 : 2) * 3', {})).toBe(7);
      expect(evaluateStatement('y = x > 1 ? x + 1 : x - 1', { x: 2 })).toBe(3);
    });

    test('chains right-associatively', () => {
      expect(evaluateStatement('x = 1 ? 2 : 3 ? 4 : 5', {})).toBe(2);
      expect(evaluateStatement('x = 0 ? 2 : 0 ? 4 : 5', {})).toBe(5);
    });

    test('evaluates only the taken branch', () => {
      // It desugars to the intrinsic `if()`, which is lazy — preset code
      // relies on that for side effects.
      const taken: Record<string, number> = { a: 0, b: 0 };
      evaluateStatement('x = 1 ? (a = 7) : (b = 9)', taken);
      expect(taken).toEqual({ a: 7, b: 0 });

      const notTaken: Record<string, number> = { a: 0, b: 0 };
      evaluateStatement('x = 0 ? (a = 7) : (b = 9)', notTaken);
      expect(notTaken).toEqual({ a: 0, b: 9 });
    });

    test('allows an unparenthesised assignment in either branch', () => {
      const env: Record<string, number> = { a: 0 };
      evaluateStatement('1 > 0 ? a = 5 : a = 9', env);
      expect(env.a).toBe(5);
    });

    test('reports a missing colon', () => {
      const parsed = parseMilkdropStatement('x = 1 ? 2', 1);
      expect(parsed.diagnostics.map((d) => d.code)).toContain(
        'expr_expected_conditional_colon',
      );
    });
  });

  test('reports a malformed expression statement rather than swallowing it', () => {
    // A statement with no top-level `=` used to return no diagnostics at all
    // when it failed to parse, so a preset could quietly lose an equation —
    // which is how the `loop (` and `+=` gaps survived a corpus that
    // otherwise compiled with zero errors. `)` is the exact orphan a
    // mis-split multi-line loop body left behind.
    const parsed = parseMilkdropStatement(')', 1);
    expect(parsed.value).toBeNull();
    expect(parsed.diagnostics.map((d) => d.code)).toContain(
      'expr_expected_primary',
    );
  });
});
