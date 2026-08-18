/**
 * CSP interpreter-only mode: environments that forbid 'unsafe-eval' cannot
 * use the `new Function` JIT, so compileMilkdropProgram falls back to an
 * interpreter-backed executor. This suite makes that a TESTED configuration
 * rather than a dead codepath: the fallback must satisfy the full platform
 * profile (eel-conformance-spec) and match the JIT's store contract
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
import { SPEC } from './eel-conformance-spec.test.ts';

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
  test('satisfies every platform-profile conformance case', () => {
    for (const specCase of SPEC) {
      const { env } = runTier(specCase.program, false);
      for (const [key, expected] of Object.entries(specCase.expected)) {
        const actual = env[key] ?? 0;
        expect(
          Math.abs(actual - expected),
          `${specCase.name}: ${key} expected ${expected}, got ${actual}`,
        ).toBeLessThanOrEqual(1e-12 + Math.abs(expected) * 1e-9);
      }
    }
  });

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

  test('agrees with the JIT on 300 seeded random programs', () => {
    const VARS = ['a', 'b', 'c', 'd', 'x', 'y', 'zoom', 'rot'];
    const failures: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = mulberry32(seed);
      const genExpr = (depth: number): string => {
        const roll = rnd();
        if (depth <= 0 || roll < 0.3) {
          return rnd() < 0.5
            ? (rnd() * 20 - 10).toFixed(4)
            : (VARS[Math.floor(rnd() * VARS.length)] as string);
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
      for (const key of new Set([
        ...Object.keys(jit.env),
        ...Object.keys(fallback.env),
      ])) {
        if (!closeEnough(jit.env[key] ?? 0, fallback.env[key] ?? 0)) {
          failures.push(
            `seed ${seed}: ${key} jit=${jit.env[key]} fallback=${fallback.env[key]}\n  ${lines.join('\n  ')}`,
          );
          break;
        }
      }
    }
    expect(failures).toEqual([]);
  }, 30000);
});
