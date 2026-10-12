/**
 * Tier-differential fuzz: the EEL interpreter (evaluateMilkdropExpression,
 * used at analysis time) and the runtime JIT (compileMilkdropProgram) must
 * compute identical results for the same program.
 *
 * Seeded and deterministic: every run generates the same programs. When this
 * fails it prints the seed and program — reproduce by pasting the program
 * into either tier. This harness found, on first run: statement-form stores
 * spliced into expressions (SyntaxError — 18 shipped preset blocks could not
 * JIT at all), eager `if()`/`&&`/`||` branch evaluation in the interpreter,
 * `/` and `frac` splicing operand strings twice (side effects ran twice),
 * and log/log10 finite-clamps present in only one tier.
 */
import { describe, expect, test } from 'bun:test';
import type {
  MilkdropCompiledStatement,
  MilkdropProgramBlock,
} from 'milkdrop-toolchain/src/common-types.ts';
import {
  advanceEelRng,
  type EelRngCell,
} from 'milkdrop-toolchain/src/compiler/eel-function-table.ts';
import {
  evaluateMilkdropExpression,
  parseMilkdropStatement,
} from 'milkdrop-toolchain/src/expression.ts';
import { compileMilkdropProgram } from 'milkdrop-toolchain/src/expression-jit.ts';

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

const VARS = ['a', 'b', 'c', 'd', 'x', 'y', 'zoom', 'rot'];
const UNARY_FNS = [
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'sqrt',
  'sqr',
  'abs',
  'exp',
  'log',
  'log10',
  'sign',
  'int',
  'floor',
  'ceil',
  'sigmoid',
  'frac',
];
const BINARY_FNS = ['pow', 'min', 'max', 'atan2', 'above', 'below', 'equal'];
const BIN_OPS = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '&&',
  '||',
  '<',
  '>',
  '<=',
  '>=',
  '==',
  '!=',
];

function genExpr(rnd: () => number, depth: number): string {
  const roll = rnd();
  if (depth <= 0 || roll < 0.25) {
    return rnd() < 0.5
      ? (rnd() * 20 - 10).toFixed(4)
      : VARS[Math.floor(rnd() * VARS.length)];
  }
  if (roll < 0.5) {
    const fn = UNARY_FNS[Math.floor(rnd() * UNARY_FNS.length)];
    return `${fn}(${genExpr(rnd, depth - 1)})`;
  }
  if (roll < 0.62) {
    const fn = BINARY_FNS[Math.floor(rnd() * BINARY_FNS.length)];
    return `${fn}(${genExpr(rnd, depth - 1)},${genExpr(rnd, depth - 1)})`;
  }
  if (roll < 0.72) {
    return `if(${genExpr(rnd, depth - 1)},${genExpr(rnd, depth - 1)},${genExpr(rnd, depth - 1)})`;
  }
  if (roll < 0.78) {
    // Nested assignment: the construct that exposed the statement-form-store
    // SyntaxError and the double-splice side-effect bugs.
    return `(${VARS[Math.floor(rnd() * VARS.length)]} = ${genExpr(rnd, depth - 1)})`;
  }
  const op = BIN_OPS[Math.floor(rnd() * BIN_OPS.length)];
  return `(${genExpr(rnd, depth - 1)} ${op} ${genExpr(rnd, depth - 1)})`;
}

function genProgram(rnd: () => number): string[] {
  const lines: string[] = [];
  const count = 2 + Math.floor(rnd() * 5);
  for (let i = 0; i < count; i++) {
    const target = VARS[Math.floor(rnd() * VARS.length)];
    lines.push(`${target} = ${genExpr(rnd, 3)}`);
  }
  return lines;
}

function parseProgram(lines: string[]): MilkdropProgramBlock | null {
  const statements: MilkdropCompiledStatement[] = [];
  for (const [i, line] of lines.entries()) {
    const parsed = parseMilkdropStatement(line, i + 1);
    if (!parsed.value) return null;
    if (parsed.diagnostics.some((d) => d.severity === 'error')) return null;
    statements.push(parsed.value);
  }
  return { statements, sourceLines: lines };
}

const INTERP_HELPERS = {
  nextRandom: () => 0.5,
  megabuf: () => 0,
  gmegabuf: () => 0,
  megabufWrite: () => {},
  gmegabufWrite: () => {},
};

function runInterpreter(
  block: MilkdropProgramBlock,
  env: Record<string, number>,
  rng?: EelRngCell,
) {
  const helpers = rng
    ? { ...INTERP_HELPERS, nextRandom: () => advanceEelRng(rng) }
    : INTERP_HELPERS;
  for (const st of block.statements) {
    const value = evaluateMilkdropExpression(st.expression, env, helpers);
    if (st.target && st.target !== '__control__') {
      // Statement-level finite clamp, matching the JIT (and MilkDrop).
      env[st.target.toLowerCase()] = Number.isFinite(value) ? value : 0;
    }
  }
}

function runJit(block: MilkdropProgramBlock, env: Record<string, number>) {
  const fn = compileMilkdropProgram(block);
  fn(env, {}, {}, null, new Float32Array(16), new Float32Array(16), () => 0.5);
}

/** Inline-RNG differential: the interpreter draws through a shared cell via
 * advanceEelRng while the JIT advances the same LCG inside the compiled
 * body. Both tiers must produce identical draws AND leave the cell in the
 * same state — that is what lets interpreted and compiled programs
 * interleave on one VM. */
function runInlineDifferential(
  block: MilkdropProgramBlock,
  env: Record<string, number>,
  rng: EelRngCell,
) {
  compileMilkdropProgram(block, { rng: 'inline' })(
    env,
    {},
    {},
    null,
    new Float32Array(16),
    new Float32Array(16),
    rng,
  );
}

/** rand/randint with a plain leaf argument. A random expression inside a
 * random argument draws in opposite orders on the two tiers (the interpreter
 * evaluates a call's arguments before dispatch; the JIT lowers the draw to
 * the left of the argument) — a pre-existing divergence outside this
 * suite's remit, so the fuzzer does not generate it. */
const RANDOM_LEAVES = ['rand(1001)', 'rand()', 'randint(501)', 'randint(2)'];

const closeEnough = (a: number, b: number) => {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  const diff = Math.abs(a - b);
  return diff <= 1e-9 + 1e-6 * Math.max(Math.abs(a), Math.abs(b));
};

describe('EEL tier differential', () => {
  test('interpreter and JIT agree on 500 seeded random programs', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 500; seed++) {
      const rnd = mulberry32(seed);
      const lines = genProgram(rnd);
      const block = parseProgram(lines);
      if (!block) continue;
      const inputRnd = mulberry32(seed * 7919);
      const base: Record<string, number> = {};
      for (const v of VARS) base[v] = inputRnd() * 4 - 2;
      const envA = { ...base };
      const envB = { ...base };
      try {
        runInterpreter(block, envA);
        runJit(block, envB);
      } catch (error) {
        failures.push(
          `seed ${seed} threw: ${(error as Error).message}\n  ${lines.join('\n  ')}`,
        );
        continue;
      }
      for (const key of new Set([...Object.keys(envA), ...Object.keys(envB)])) {
        if (!closeEnough(envA[key] ?? 0, envB[key] ?? 0)) {
          failures.push(
            `seed ${seed}: ${key} interp=${envA[key]} jit=${envB[key]}\n  ${lines.join('\n  ')}`,
          );
          break;
        }
      }
    }
    expect(failures).toEqual([]);
  }, 30000);

  test('interpreter and inline-RNG JIT agree on 500 seeded random programs with rand calls', () => {
    // Same generator, with rand/randint leaves spliced in, plus q-register
    // targets so draws mix with register writes. The interpreter helper
    // advances a seeded cell; the JIT advances its own same-seeded cell
    // inside the compiled body. Everything must match, including the cell
    // left behind — the shared-state contract for interleaved tiers.
    const RANDOM_TARGETS = [...VARS.slice(0, 6), 'q1', 'q3', 't2'];
    const genRandomExpr = (rnd: () => number, depth: number): string => {
      const roll = rnd();
      if (depth <= 0 || roll < 0.3) {
        if (rnd() < 0.45) {
          return RANDOM_LEAVES[
            Math.floor(rnd() * RANDOM_LEAVES.length)
          ] as string;
        }
        return rnd() < 0.5
          ? (rnd() * 20 - 10).toFixed(4)
          : (VARS[Math.floor(rnd() * VARS.length)] as string);
      }
      if (roll < 0.5) {
        const fn = UNARY_FNS[Math.floor(rnd() * UNARY_FNS.length)] as string;
        return `${fn}(${genRandomExpr(rnd, depth - 1)})`;
      }
      if (roll < 0.62) {
        const fn = BINARY_FNS[Math.floor(rnd() * BINARY_FNS.length)] as string;
        return `${fn}(${genRandomExpr(rnd, depth - 1)},${genRandomExpr(rnd, depth - 1)})`;
      }
      if (roll < 0.74) {
        return `if(${genRandomExpr(rnd, depth - 1)},${genRandomExpr(rnd, depth - 1)},${genRandomExpr(rnd, depth - 1)})`;
      }
      if (roll < 0.84) {
        return `(${VARS[Math.floor(rnd() * VARS.length)] as string} = ${genRandomExpr(rnd, depth - 1)})`;
      }
      const op = BIN_OPS[Math.floor(rnd() * BIN_OPS.length)] as string;
      return `(${genRandomExpr(rnd, depth - 1)} ${op} ${genRandomExpr(rnd, depth - 1)})`;
    };

    const failures: string[] = [];
    for (let seed = 1; seed <= 500; seed++) {
      const rnd = mulberry32(seed);
      const lines: string[] = [];
      const count = 2 + Math.floor(rnd() * 5);
      for (let i = 0; i < count; i += 1) {
        const target = RANDOM_TARGETS[
          Math.floor(rnd() * RANDOM_TARGETS.length)
        ] as string;
        lines.push(`${target} = ${genRandomExpr(rnd, 3)}`);
      }
      const block = parseProgram(lines);
      if (!block) continue;
      const inputRnd = mulberry32(seed * 7919);
      const base: Record<string, number> = {};
      for (const v of VARS) base[v] = inputRnd() * 4 - 2;
      const envA = { ...base };
      const envB = { ...base };
      const cellInterp: EelRngCell = { s: seed };
      const cellJit: EelRngCell = { s: seed };
      try {
        runInterpreter(block, envA, cellInterp);
        runInlineDifferential(block, envB, cellJit);
      } catch (error) {
        failures.push(
          `seed ${seed} threw: ${(error as Error).message}\n  ${lines.join('\n  ')}`,
        );
        continue;
      }
      let mismatched = false;
      for (const key of new Set([...Object.keys(envA), ...Object.keys(envB)])) {
        if (!closeEnough(envA[key] ?? 0, envB[key] ?? 0)) {
          failures.push(
            `seed ${seed}: ${key} interp=${envA[key]} jit=${envB[key]}\n  ${lines.join('\n  ')}`,
          );
          mismatched = true;
          break;
        }
      }
      if (!mismatched && cellInterp.s !== cellJit.s) {
        failures.push(
          `seed ${seed}: rng cell interp=${cellInterp.s} jit=${cellJit.s}\n  ${lines.join('\n  ')}`,
        );
      }
    }
    expect(failures).toEqual([]);
  }, 30000);
});
