/**
 * CSP interpreter-only mode: environments that forbid 'unsafe-eval' cannot
 * use the `new Function` JIT, so compileMilkdropProgram falls back to an
 * interpreter-backed executor. This suite makes that a TESTED configuration
 * rather than a dead codepath: the fallback must satisfy the full platform
 * profile (spec/eel-conformance/) and match the JIT's store contract
 * (env + state/register/local mirrors, megabuf writes, control flow) on
 * seeded random programs.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import type {
  MilkdropCompiledStatement,
  MilkdropProgramBlock,
} from '../../src/js/milkdrop/common-types.ts';
import { parseMilkdropStatement } from '../../src/js/milkdrop/expression.ts';
import {
  __setJitAvailableForTests,
  compileMilkdropProgram,
} from '../../src/js/milkdrop/expression-jit.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fresh block per compile: compileMilkdropProgram memoises per block
 * object, so each tier needs its own parse. */
function parseProgram(lines: string[]): MilkdropProgramBlock {
  const statements: MilkdropCompiledStatement[] = [];
  for (const [index, line] of lines.entries()) {
    const parsed = parseMilkdropStatement(line, index + 1);
    if (
      !parsed.value ||
      parsed.diagnostics.some((d) => d.severity === 'error')
    ) {
      throw new Error(`failed to parse: ${line}`);
    }
    statements.push(parsed.value);
  }
  return { statements, sourceLines: lines };
}

type RunResult = {
  env: Record<string, number>;
  state: Record<string, number>;
  registers: Record<string, number>;
  megabuf: Float32Array;
};

function runTier(lines: string[], jit: boolean): RunResult {
  __setJitAvailableForTests(jit);
  const env: Record<string, number> = {};
  const state: Record<string, number> = {};
  const registers: Record<string, number> = {};
  const megabuf = new Float32Array(64);
  try {
    compileMilkdropProgram(parseProgram(lines))(
      env,
      state,
      registers,
      null,
      megabuf,
      new Float32Array(64),
      () => 0.5,
    );
  } finally {
    __setJitAvailableForTests(null);
  }
  return { env, state, registers, megabuf };
}

const closeEnough = (a: number, b: number) => {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= 1e-9 + 1e-6 * Math.max(Math.abs(a), Math.abs(b));
};

afterAll(() => {
  __setJitAvailableForTests(null);
});

describe('EEL CSP interpreter-only fallback', () => {
  // The platform profile itself is no longer re-run here. The conformance
  // corpus (spec/eel-conformance/) exercises this exact executor as its
  // `interpreter` tier, with the buffer and environment seeding the corpus
  // needs, so a copy of the loop in this file could only drift from it.
  // What stays below is what the corpus does NOT cover: the store contract
  // (env/state/register/local mirrors) and seeded-random tier agreement.

  test('mirrors q/t registers and state like the JIT store contract', () => {
    const program = [
      'q1 = 5',
      't3 = q1 * 2',
      'zoom = (q2 = 7) + t3', // nested assignment must mirror too
      'megabuf(3) = zoom + 1',
      'x = megabuf(3)',
    ];
    const jit = runTier(program, true);
    const fallback = runTier(program, false);
    expect(fallback.registers.q1).toBe(jit.registers.q1);
    expect(fallback.registers.q2).toBe(jit.registers.q2);
    expect(fallback.registers.t3).toBe(jit.registers.t3);
    expect(fallback.state.zoom).toBe(jit.state.zoom);
    expect(fallback.megabuf[3]).toBe(jit.megabuf[3]);
    expect(fallback.env.x).toBe(jit.env.x);
  });

  test('clamps non-finite nested assignments like the JIT', () => {
    // Regression: the fallback's statement-level clamp only covered the
    // outermost value, so an assignment nested inside an expression stored a
    // raw Infinity into the register/state mirrors, where it persisted
    // across frames and NaN-poisoned everything reading it.
    const program = ['zoom = (q1 = 1e300 * 1e300) * 0 + 1'];
    const jit = runTier(program, true);
    const fallback = runTier(program, false);

    expect(fallback.registers.q1).toBe(0);
    expect(fallback.registers.q1).toBe(jit.registers.q1 as number);
    expect(fallback.state.zoom).toBe(jit.state.zoom as number);
  });

  test('runs unknown-function arguments for their side effects', () => {
    // Regression: the JIT's unknown-name fallback emitted a bare `(0)` and
    // threw the compiled argument expressions away, so an assignment nested
    // in an argument never ran. The interpreter evaluates every argument
    // before dispatch, so the two tiers disagreed on which variables even
    // existed.
    const program = ['a = nosuchfn((rot = (q1 = 1e38)))'];
    const jit = runTier(program, true);
    const fallback = runTier(program, false);

    expect(jit.registers.q1).toBe(1e38);
    expect(jit.state.rot).toBe(1e38);
    expect(jit.env.a).toBe(0);
    expect(jit.registers.q1).toBe(fallback.registers.q1 as number);
    expect(jit.state.rot).toBe(fallback.state.rot as number);
    expect(jit.env.a).toBe(fallback.env.a as number);
  });

  test('implements invsqrt identically on both tiers', () => {
    // invsqrt is a real ns-eel builtin; it was missing from the function
    // table entirely, so it took the unknown-name path on every tier.
    const program = ['a = invsqrt(16)', 'b = invsqrt(0)', 'c = invsqrt(-4)'];
    const jit = runTier(program, true);
    const fallback = runTier(program, false);

    expect(jit.env.a).toBeCloseTo(0.25, 12);
    expect(jit.env.b).toBe(0); // 1/0 -> Infinity -> finite clamp
    expect(jit.env.c).toBe(0);
    expect(fallback.env.a).toBe(jit.env.a as number);
    expect(fallback.env.b).toBe(jit.env.b as number);
    expect(fallback.env.c).toBe(jit.env.c as number);
  });

  test('agrees with the JIT on 300 seeded random programs', () => {
    const VARS = ['a', 'b', 'c', 'd', 'x', 'y', 'zoom', 'rot', 'q1', 't2'];
    const OVERFLOW_LITERALS = ['1e300', '-1e300', '1e-320', '1e38'];
    const failures: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = mulberry32(seed);
      const genExpr = (depth: number): string => {
        const roll = rnd();
        if (depth <= 0 || roll < 0.3) {
          if (rnd() < 0.5) {
            // A tenth of the literals overflow f64 when multiplied, which is
            // what makes the never-let-NaN-escape clamp observable. A pool of
            // only +/-10 values kept the fuzz permanently inside the finite
            // range and hid an unclamped nested-assignment store.
            return rnd() < 0.2
              ? (OVERFLOW_LITERALS[
                  Math.floor(rnd() * OVERFLOW_LITERALS.length)
                ] as string)
              : (rnd() * 20 - 10).toFixed(4);
          }
          return VARS[Math.floor(rnd() * VARS.length)] as string;
        }
        if (roll < 0.5) {
          const fns = ['sin', 'sqrt', 'log', 'int', 'frac', 'abs', 'sqr'];
          return `${fns[Math.floor(rnd() * fns.length)]}(${genExpr(depth - 1)})`;
        }
        if (roll < 0.62) {
          return `if(${genExpr(depth - 1)},${genExpr(depth - 1)},${genExpr(depth - 1)})`;
        }
        if (roll < 0.72) {
          return `(${VARS[Math.floor(rnd() * VARS.length)]} = ${genExpr(depth - 1)})`;
        }
        const ops = ['+', '-', '*', '/', '%', '^', '&&', '||', '<', '=='];
        return `(${genExpr(depth - 1)} ${ops[Math.floor(rnd() * ops.length)]} ${genExpr(depth - 1)})`;
      };
      const lines: string[] = [];
      const count = 2 + Math.floor(rnd() * 4);
      for (let i = 0; i < count; i++) {
        lines.push(`${VARS[Math.floor(rnd() * VARS.length)]} = ${genExpr(3)}`);
      }
      let jit: RunResult;
      let fallback: RunResult;
      try {
        jit = runTier(lines, true);
        fallback = runTier(lines, false);
      } catch (error) {
        failures.push(`seed ${seed} threw: ${(error as Error).message}`);
        continue;
      }
      // Every store, not just env: q registers and the state mirror are what
      // persist across frames, so a value that only goes bad there is exactly
      // the one that poisons a preset for its whole lifetime.
      let mismatched = false;
      for (const store of ['env', 'state', 'registers'] as const) {
        for (const key of new Set([
          ...Object.keys(jit[store]),
          ...Object.keys(fallback[store]),
        ])) {
          const jitValue = jit[store][key] ?? 0;
          const fallbackValue = fallback[store][key] ?? 0;
          if (!Number.isFinite(jitValue) || !Number.isFinite(fallbackValue)) {
            failures.push(
              `seed ${seed}: ${store}.${key} escaped non-finite jit=${jitValue} fallback=${fallbackValue}\n  ${lines.join('\n  ')}`,
            );
            mismatched = true;
            break;
          }
          if (!closeEnough(jitValue, fallbackValue)) {
            failures.push(
              `seed ${seed}: ${store}.${key} jit=${jitValue} fallback=${fallbackValue}\n  ${lines.join('\n  ')}`,
            );
            mismatched = true;
            break;
          }
        }
        if (mismatched) break;
      }
    }
    expect(failures).toEqual([]);
  }, 30000);
});
