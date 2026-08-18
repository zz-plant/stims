/**
 * EEL platform-profile conformance spec.
 *
 * This is the repo's single written statement of how MilkDrop expression
 * edge cases behave — the "platform profile" in the recompiler sense: the
 * reference runtime's quirks (zero-guards, finite clamps, truncation
 * direction, close-factor equality, laziness, overwritable builtins) are
 * part of the platform, and every execution tier must implement THESE
 * values, not what a fresh implementation would naturally do.
 *
 * Unlike the tier-differential fuzz suites (which assert tiers AGREE), each
 * case here pins an absolute expected value, hand-derived from MilkDrop
 * 2.x/ns-eel behavior, and runs it against both CPU tiers (interpreter and
 * JIT). The GPU tiers are held to the same table indirectly: the WGSL
 * scalar helpers (compiler/wgsl-eel-helpers.ts, shared by both WGSL
 * emitters) are mirrored in JS by tests/unit/gpu-field-tier-differential.ts
 * and fuzz-compared against the JIT.
 *
 * When a case here needs to change, that is a platform-semantics decision:
 * check the corpus for presets depending on the old value before editing.
 */
import { describe, expect, test } from 'bun:test';
import type {
  MilkdropCompiledStatement,
  MilkdropProgramBlock,
} from '../../src/js/milkdrop/common-types.ts';
import {
  evaluateMilkdropExpression,
  parseMilkdropStatement,
} from '../../src/js/milkdrop/expression.ts';
import { compileMilkdropProgram } from '../../src/js/milkdrop/expression-jit.ts';

const INTERP_HELPERS = {
  nextRandom: () => 0.5,
  megabuf: () => 0,
  gmegabuf: () => 0,
  megabufWrite: () => {},
  gmegabufWrite: () => {},
};

function parseProgram(lines: string[]): MilkdropProgramBlock {
  const statements: MilkdropCompiledStatement[] = [];
  for (const [index, line] of lines.entries()) {
    const parsed = parseMilkdropStatement(line, index + 1);
    if (
      !parsed.value ||
      parsed.diagnostics.some((d) => d.severity === 'error')
    ) {
      throw new Error(`spec program failed to parse: ${line}`);
    }
    statements.push(parsed.value);
  }
  return { statements, sourceLines: lines };
}

function runInterpreter(lines: string[], env: Record<string, number>) {
  for (const st of parseProgram(lines).statements) {
    const value = evaluateMilkdropExpression(
      st.expression,
      env,
      INTERP_HELPERS,
    );
    if (st.target && st.target !== '__control__') {
      env[st.target.toLowerCase()] = Number.isFinite(value) ? value : 0;
    }
  }
  return env;
}

function runJit(lines: string[], env: Record<string, number>) {
  compileMilkdropProgram(parseProgram(lines))(
    env,
    {},
    {},
    null,
    new Float32Array(16),
    new Float32Array(16),
    () => 0.5,
  );
  return env;
}

type SpecCase = {
  name: string;
  program: string[];
  env?: Record<string, number>;
  /** Expected env values after the program runs, per the platform profile. */
  expected: Record<string, number>;
};

const CLOSE = 1e-12;

const SPEC: SpecCase[] = [
  // ── Division and modulo ───────────────────────────────────────────────
  {
    name: 'division by zero yields 0',
    program: ['x = 1 / 0'],
    expected: { x: 0 },
  },
  {
    name: 'division by tiny nonzero divides (no tolerance guard)',
    program: ['x = 1 / 0.0000001'],
    expected: { x: 10000000 },
  },
  {
    name: '% truncates both operands to integers first',
    program: ['x = 7.5 % 0.7'],
    expected: { x: 0 }, // trunc -> 7 % 0 -> 0
  },
  { name: '% by zero yields 0', program: ['x = 5 % 0'], expected: { x: 0 } },
  {
    name: '% is trunc-mod (sign follows dividend)',
    program: ['x = (-7) % 3', 'y = 7 % (-3)'],
    expected: { x: -1, y: 1 },
  },
  // ── pow / ^ ───────────────────────────────────────────────────────────
  {
    name: '^ computes real powers',
    program: ['x = 2 ^ 10'],
    expected: { x: 1024 },
  },
  {
    name: '^ overflow clamps to 0 (finite clamp, not Infinity)',
    program: ['x = 10 ^ 5000'],
    expected: { x: 0 },
  },
  {
    name: 'negative base with integral exponent is real',
    // All tiers: milkdropPow is sign-decomposed on the GPU to match JS **
    // (verified by lab:gpu-differential).
    program: ['x = (-2) ^ 2'],
    expected: { x: 4 },
  },
  {
    name: 'negative base with fractional exponent is 0 (NaN clamp)',
    program: ['x = (-2) ^ 0.5'],
    expected: { x: 0 },
  },
  // ── log family ────────────────────────────────────────────────────────
  {
    name: 'log(0) is 0, not -Infinity',
    program: ['x = log(0)'],
    expected: { x: 0 },
  },
  {
    name: 'log of negative is 0',
    program: ['x = log(-5)'],
    expected: { x: 0 },
  },
  {
    name: 'log10 of powers of ten',
    program: ['x = log10(1000)'],
    expected: { x: 3 },
  },
  // ── Domain clamps ─────────────────────────────────────────────────────
  {
    name: 'sqrt of negative is 0',
    program: ['x = sqrt(-4)'],
    expected: { x: 0 },
  },
  {
    name: 'asin/acos clamp their argument to [-1, 1]',
    program: ['x = asin(2)', 'y = acos(-3)'],
    expected: { x: Math.PI / 2, y: Math.PI },
  },
  // ── Truncation and bit ops ────────────────────────────────────────────
  {
    name: 'int() truncates toward zero (not floor)',
    program: ['x = int(-3.7)', 'y = int(3.7)'],
    expected: { x: -3, y: 3 },
  },
  {
    name: 'bit ops truncate operands toward zero',
    program: ['x = 6.9 | 3.2', 'y = (-6.9) | 0', 'z = 6.9 & 3.2'],
    expected: { x: 7, y: -6, z: 2 },
  },
  // ── Equality: == is exact, equal() is close-factor ────────────────────
  {
    name: '== is exact float equality',
    program: ['x = (0.1 + 0.2) == 0.3'],
    expected: { x: 0 },
  },
  {
    name: 'equal() uses the close factor (1e-5)',
    program: ['x = equal(0.1 + 0.2, 0.3)', 'y = equal(1, 1.1)'],
    expected: { x: 1, y: 0 },
  },
  // ── Truthiness threshold (|v| > 1e-5) ─────────────────────────────────
  {
    name: 'values at or below the close factor are falsy',
    program: ['x = !0.000001', 'y = !0.0001', 'z = bnot(0.000001)'],
    expected: { x: 1, y: 0, z: 1 },
  },
  {
    name: 'if() condition uses the truthiness threshold',
    program: ['x = if(0.000001, 10, 20)', 'y = if(0.0001, 10, 20)'],
    expected: { x: 20, y: 10 },
  },
  // ── Laziness: skipped branches must not run their side effects ────────
  {
    name: 'if() evaluates only the taken branch',
    program: ['a = 0', 'b = 0', 'x = if(1, a = 5, b = 7)'],
    expected: { a: 5, b: 0, x: 5 },
  },
  {
    name: '&& short-circuits the right side',
    program: ['a = 0', 'x = 0 && (a = 5)'],
    expected: { a: 0, x: 0 },
  },
  {
    name: '|| short-circuits the right side',
    program: ['a = 0', 'x = 1 || (a = 5)'],
    expected: { a: 0, x: 1 },
  },
  // ── Variables and builtins ────────────────────────────────────────────
  {
    name: 'uninitialized variables read as 0',
    program: ['x = never_written * 3 + 1'],
    expected: { x: 1 },
  },
  {
    name: 'assignment is an expression returning the assigned value',
    program: ['y = (x = 3) + 1'],
    expected: { x: 3, y: 4 },
  },
  {
    name: 'pi and e read as the constants by default',
    program: ['x = pi', 'y = e'],
    expected: { x: Math.PI, y: Math.E },
  },
  {
    name: 'pi and e are ordinary variables: assignments stick',
    // ns-eel registers pi/e as plain prepopulated vars; ~74 corpus presets
    // overwrite one of them. The GPU tiers model the same thing
    // (gpu-field-planner isOverwritableConstant, wgsl-generator
    // overwrittenConstants).
    program: ['pi = 4', 'x = pi * 2', 'e = 10', 'y = e + 1'],
    expected: { x: 8, y: 11 },
  },
  // ── NaN/Inf containment ───────────────────────────────────────────────
  {
    name: 'non-finite store clamps to 0 at the statement boundary',
    program: ['x = 1 / 0 + 5', 'y = sqrt(4)'],
    expected: { x: 5, y: 2 }, // 1/0 is already 0 -> 0 + 5
  },
  {
    name: 'sigmoid midpoint',
    program: ['x = sigmoid(0, 1)'],
    expected: { x: 0.5 },
  },
];

describe('EEL platform-profile conformance', () => {
  for (const specCase of SPEC) {
    for (const [tierName, run] of [
      ['interpreter', runInterpreter],
      ['jit', runJit],
    ] as const) {
      test(`${specCase.name} [${tierName}]`, () => {
        const env = run(specCase.program, { ...(specCase.env ?? {}) });
        for (const [key, expected] of Object.entries(specCase.expected)) {
          const actual = env[key] ?? 0;
          expect(
            Math.abs(actual - expected),
            `${key}: expected ${expected}, got ${actual}`,
          ).toBeLessThanOrEqual(CLOSE + Math.abs(expected) * 1e-9);
        }
      });
    }
  }
});
