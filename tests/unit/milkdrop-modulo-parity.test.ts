import { describe, expect, test } from 'bun:test';
import { compileProgramToWgsl } from '../../src/js/milkdrop/compiler/wgsl-generator.ts';
import { evaluateMilkdropExpression } from '../../src/js/milkdrop/expression.ts';
import type {
  MilkdropExpressionNode,
  MilkdropProgramBlock,
} from '../../src/js/milkdrop/types.ts';

/**
 * `%` and `mod()` do not mean the same thing in EEL, and the WGSL compute path
 * drifted once already: it emitted a float remainder for `%`, so any preset
 * using fractional operands computed different values on WebGPU than on the CPU
 * (7.5 % 0.7 gave 0.5 on GPU against 0 on CPU).
 *
 * WGSL cannot be executed here, so these transliterate the emitted helpers and
 * check them against the CPU interpreter over a grid of awkward inputs. If
 * either side's semantics change, this fails — which is the point: the two
 * implementations have no other forcing function keeping them in step.
 */

/** Transliteration of `milkdropTruncInt` in wgsl-generator.ts. */
function wgslTruncInt(value: number): number {
  const truncated = Math.trunc(Number.isFinite(value) ? value : 0);
  return Math.min(Math.max(truncated, -2147483520), 2147483520);
}

/** Transliteration of `milkdropIntMod`. */
function wgslIntMod(left: number, right: number): number {
  const l = wgslTruncInt(left);
  const r = wgslTruncInt(right);
  return r === 0 ? 0 : l % r;
}

/** Transliteration of `milkdropFmod`. */
function wgslFmod(left: number, right: number): number {
  if (Math.abs(right) <= 0.000001) return 0;
  const quotient = left / right;
  const truncated = Math.sign(quotient) * Math.floor(Math.abs(quotient));
  return left - right * truncated;
}

function literal(value: number): MilkdropExpressionNode {
  return { type: 'literal', value };
}

function cpuBinary(operator: '%', left: number, right: number): number {
  return evaluateMilkdropExpression(
    { type: 'binary', operator, left: literal(left), right: literal(right) },
    {},
  );
}

function cpuCall(name: string, left: number, right: number): number {
  return evaluateMilkdropExpression(
    { type: 'call', name, args: [literal(left), literal(right)] },
    {},
  );
}

function programWithOneStatement(): MilkdropProgramBlock {
  return {
    statements: [{ target: 'zoom', expression: literal(1) }],
  } as unknown as MilkdropProgramBlock;
}

const OPERANDS = [
  0, 1, -1, 2, 3, -3, 7, -7, 0.5, -0.5, 0.7, 1.5, -1.5, 2.9, -2.9, 7.5, -7.5,
  10, 100.25, -100.25, 1e-7,
];

describe('modulo parity between the CPU interpreter and the WGSL compute path', () => {
  test('the % operator agrees on every operand pair', () => {
    const divergences: string[] = [];
    for (const left of OPERANDS) {
      for (const right of OPERANDS) {
        const expected = cpuBinary('%', left, right);
        const actual = wgslIntMod(left, right);
        if (Math.abs(expected - actual) > 1e-6) {
          divergences.push(
            `${left} % ${right}: cpu=${expected} wgsl=${actual}`,
          );
        }
      }
    }
    expect(divergences).toEqual([]);
  });

  test('mod() agrees on every operand pair', () => {
    const divergences: string[] = [];
    for (const left of OPERANDS) {
      for (const right of OPERANDS) {
        const expected = cpuCall('mod', left, right);
        const actual = wgslFmod(left, right);
        if (Math.abs(expected - actual) > 1e-6) {
          divergences.push(
            `mod(${left}, ${right}): cpu=${expected} wgsl=${actual}`,
          );
        }
      }
    }
    expect(divergences).toEqual([]);
  });

  test('% and mod() genuinely differ, so one cannot stand in for the other', () => {
    // The regression that motivated this file emitted the mod() form for `%`.
    // Pin a case where that substitution is observable.
    expect(wgslIntMod(7.5, 0.7)).toBe(0);
    expect(wgslFmod(7.5, 0.7)).toBeCloseTo(0.5, 6);
    expect(cpuBinary('%', 7.5, 0.7)).toBe(0);
    expect(cpuCall('mod', 7.5, 0.7)).toBeCloseTo(0.5, 6);
  });

  test('the compute program carries both helpers', () => {
    const { wgslCode } = compileProgramToWgsl(programWithOneStatement());

    expect(wgslCode).toContain('fn milkdropTruncInt');
    expect(wgslCode).toContain('fn milkdropIntMod');
    expect(wgslCode).toContain('fn milkdropFmod');
  });

  test('the emitted helpers still match what the transliterations assume', () => {
    // The grids above test hand-copied JS, so they only prove anything while
    // the copies track the WGSL. Pin the shape each one depends on: integer
    // modulo must truncate its operands, float modulo must not.
    const { wgslCode } = compileProgramToWgsl(programWithOneStatement());
    const bodyOf = (name: string) => {
      const match = wgslCode.match(
        new RegExp(`fn ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`, 'u'),
      );
      if (!match) throw new Error(`Could not find fn ${name} in the program`);
      return match[1] as string;
    };

    const intMod = bodyOf('milkdropIntMod');
    // Both operands go through the integer truncation helper...
    expect(intMod.match(/milkdropTruncInt\(/gu)).toHaveLength(2);
    // ...and the remainder is taken on integers, not reconstructed from a
    // float quotient.
    expect(intMod).toMatch(/%/u);
    expect(intMod).not.toMatch(/floor|sign/u);

    const fmod = bodyOf('milkdropFmod');
    // Float remainder keeps full precision: no operand truncation.
    expect(fmod).not.toMatch(/milkdropTruncInt/u);
    // Quotient truncates toward zero, which is what JS % does.
    expect(fmod).toMatch(/sign\(quotient\)\s*\*\s*floor\(abs\(quotient\)\)/u);
  });
});
