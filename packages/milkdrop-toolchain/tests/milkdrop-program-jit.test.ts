import { describe, expect, test } from 'bun:test';
import type { MilkdropProgramBlock } from '../src/common-types.ts';
import {
  advanceEelRng,
  type EelRngCell,
} from '../src/compiler/eel-function-table.ts';
import { compileMilkdropPresetSource } from '../src/compiler.ts';
import { evaluateMilkdropExpression } from '../src/expression.ts';
import {
  compileMilkdropProgram,
  MILKDROP_GMEGABUF_SIZE,
  MILKDROP_MEGABUF_SIZE,
} from '../src/expression-jit.ts';

type Scope = Record<string, number>;

type RunResult = {
  env: Scope;
  state: Scope;
  registers: Scope;
  locals: Scope | null;
  megabuf: Float32Array;
  gmegabuf: Float32Array;
};

function makeRandom() {
  let seed = 12345;
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

/**
 * Mirrors the statement-at-a-time semantics the VM used before program blocks
 * were compiled as a unit, so the compiled output can be diffed against it.
 */
const INTERPRETER_LOOP_CAP = 2_097_152;

type InterpreterGuard = { value: number };

function executeStatement(
  statement: MilkdropProgramBlock['statements'][number],
  scopes: RunResult,
  helpers: {
    nextRandom: () => number;
    megabuf: (index: number) => number;
    gmegabuf: (index: number) => number;
  },
  guard: InterpreterGuard,
) {
  if (statement.control) {
    const { kind, body } = statement.control;
    if (kind === 'loop') {
      let count = statement.control.count
        ? evaluateMilkdropExpression(
            statement.control.count,
            scopes.env,
            helpers,
          )
        : INTERPRETER_LOOP_CAP;
      count = Math.min(
        INTERPRETER_LOOP_CAP,
        Math.max(0, Math.trunc(count) || 0),
      );
      for (let i = 0; i < count && guard.value < INTERPRETER_LOOP_CAP; i += 1) {
        guard.value += 1;
        for (const inner of body) {
          executeStatement(inner, scopes, helpers, guard);
        }
      }
    } else {
      while (guard.value < INTERPRETER_LOOP_CAP) {
        const cond = statement.control.condition
          ? evaluateMilkdropExpression(
              statement.control.condition,
              scopes.env,
              helpers,
            )
          : 1;
        if (!cond) {
          break;
        }
        guard.value += 1;
        for (const inner of body) {
          executeStatement(inner, scopes, helpers, guard);
        }
      }
    }
    return;
  }

  const { env, state, registers, locals, megabuf, gmegabuf } = scopes;
  const value = evaluateMilkdropExpression(statement.expression, env, helpers);
  const targetIndex = statement.targetExpression
    ? evaluateMilkdropExpression(statement.targetExpression, env, helpers)
    : undefined;

  if (statement.target === 'megabuf' || statement.target === 'gmegabuf') {
    const buffer = statement.target === 'megabuf' ? megabuf : gmegabuf;
    const size =
      statement.target === 'megabuf'
        ? MILKDROP_MEGABUF_SIZE
        : MILKDROP_GMEGABUF_SIZE;
    const normalized = Math.trunc(targetIndex ?? 0);
    if (normalized >= 0 && normalized < size) {
      buffer[normalized] = value;
    }
  } else {
    const normalizedTarget = statement.target.toLowerCase();
    const registerMatch = normalizedTarget.match(/^([qt])(\d+)$/u);
    if (locals && registerMatch?.[1] !== 'q') {
      locals[statement.target] = value;
    } else if (registerMatch) {
      registers[normalizedTarget] = value;
    } else {
      state[statement.target] = value;
    }
  }

  env[statement.target] = value;
}

function runInterpreted(
  block: MilkdropProgramBlock,
  scopes: RunResult,
  rng?: EelRngCell,
): RunResult {
  const nextRandom = rng ? () => advanceEelRng(rng) : makeRandom();
  const helpers = {
    nextRandom,
    megabuf: (index: number) => {
      const normalized = Math.trunc(index);
      return normalized >= 0 && normalized < MILKDROP_MEGABUF_SIZE
        ? (scopes.megabuf[normalized] ?? 0)
        : 0;
    },
    gmegabuf: (index: number) => {
      const normalized = Math.trunc(index);
      return normalized >= 0 && normalized < MILKDROP_GMEGABUF_SIZE
        ? (scopes.gmegabuf[normalized] ?? 0)
        : 0;
    },
  };

  const guard: InterpreterGuard = { value: 0 };
  for (const statement of block.statements) {
    executeStatement(statement, scopes, helpers, guard);
  }

  return scopes;
}

function makeScopes(withLocals: boolean): RunResult {
  const state: Scope = { zoom: 1, rad: 0.5, warp: 0.25, decay: 0.9 };
  const signals: Scope = {
    time: 3.25,
    frame: 7,
    fps: 60,
    bass: 0.6,
    mid: 0.4,
    treb: 0.3,
    bass_att: 0.55,
    q1: 0,
    q2: 0,
  };
  const env: Scope = Object.assign(
    Object.create(null) as Scope,
    signals,
    state,
  );
  return {
    env,
    state,
    registers: { q1: 0, q2: 0, t1: 0, t2: 0 },
    locals: withLocals ? { x: 0.25, y: 0.75, sample: 0.5, t1: 0, t2: 0 } : null,
    megabuf: new Float32Array(MILKDROP_MEGABUF_SIZE),
    gmegabuf: new Float32Array(MILKDROP_GMEGABUF_SIZE),
  };
}

function runCompiled(block: MilkdropProgramBlock, scopes: RunResult) {
  compileMilkdropProgram(block)(
    scopes.env,
    scopes.state,
    scopes.registers,
    scopes.locals,
    scopes.megabuf,
    scopes.gmegabuf,
    makeRandom(),
  );
  return scopes;
}

/** Inline-RNG tier: the compiled body advances the shared cell itself, no
 * draw callable. Mirrors how the VM runs programs in production. */
function runCompiledInline(
  block: MilkdropProgramBlock,
  scopes: RunResult,
  rng: EelRngCell,
) {
  compileMilkdropProgram(block, { rng: 'inline' })(
    scopes.env,
    scopes.state,
    scopes.registers,
    scopes.locals,
    scopes.megabuf,
    scopes.gmegabuf,
    rng,
  );
  return scopes;
}

function expectSameScopes(compiled: RunResult, interpreted: RunResult) {
  expect(compiled.state).toEqual(interpreted.state);
  expect(compiled.registers).toEqual(interpreted.registers);
  expect(compiled.locals).toEqual(interpreted.locals);
  expect({ ...compiled.env }).toEqual({ ...interpreted.env });
  expect(Array.from(compiled.megabuf.subarray(0, 64))).toEqual(
    Array.from(interpreted.megabuf.subarray(0, 64)),
  );
  expect(Array.from(compiled.gmegabuf.subarray(0, 64))).toEqual(
    Array.from(interpreted.gmegabuf.subarray(0, 64)),
  );
}

function blockFromSource(equations: string[], prefix = 'per_frame') {
  const source = [
    'title=JIT Fixture',
    ...equations.map((line, index) => `${prefix}_${index + 1}=${line}`),
  ].join('\n');
  const preset = compileMilkdropPresetSource(source, { id: 'jit-fixture' });
  return prefix === 'per_pixel'
    ? preset.ir.programs.perPixel
    : preset.ir.programs.perFrame;
}

describe('compiled milkdrop programs', () => {
  test('match the interpreter for arithmetic and register routing', () => {
    const block = blockFromSource([
      'q1 = sin(time) * 2 + bass;',
      'q2 = q1 * 0.5 - mid;',
      't1 = above(q1, 0.2) + below(q2, 0.9);',
      'zoom = zoom + 0.1 * rad;',
      'decay = if(bass > 0.5, 0.95, decay);',
    ]);

    expectSameScopes(
      runCompiled(block, makeScopes(false)),
      runInterpreted(block, makeScopes(false)),
    );
  });

  test('match the interpreter when a local scope is active', () => {
    const block = blockFromSource(
      [
        'x = x + 0.05 * sin(time);',
        'y = y * 0.5;',
        't1 = x + y;',
        'q1 = t1 * 2;',
        'zoom = 1 + rad;',
      ],
      'per_pixel',
    );

    expectSameScopes(
      runCompiled(block, makeScopes(true)),
      runInterpreted(block, makeScopes(true)),
    );
  });

  test('does not mirror local writes twice when env and locals share storage', () => {
    const block = blockFromSource(['x = x + 0.05;', 'y = x * 2;'], 'per_pixel');
    const scopes = makeScopes(true);
    const writes = new Map<string, number>();
    const sharedScope = new Proxy(
      { ...scopes.env, ...scopes.locals },
      {
        set(target, property, value) {
          if (typeof property === 'string') {
            writes.set(property, (writes.get(property) ?? 0) + 1);
          }
          return Reflect.set(target, property, value);
        },
      },
    );
    scopes.env = sharedScope;
    scopes.locals = sharedScope;

    runCompiled(block, scopes);

    expect(sharedScope.x).toBeCloseTo(0.3);
    expect(sharedScope.y).toBeCloseTo(0.6);
    expect(writes.get('x')).toBe(1);
    expect(writes.get('y')).toBe(1);
  });

  test('match the interpreter for megabuf and gmegabuf traffic', () => {
    const block = blockFromSource([
      'megabuf(3) = bass * 4;',
      'megabuf(4) = megabuf(3) + 1;',
      'gmegabuf(7) = megabuf(4) * 2;',
      'q1 = gmegabuf(7) + megabuf(3);',
      'megabuf(-1) = 99;',
      'q2 = megabuf(999999);',
    ]);

    expectSameScopes(
      runCompiled(block, makeScopes(false)),
      runInterpreted(block, makeScopes(false)),
    );
  });

  test('match the interpreter for logical helpers and exec2/exec3', () => {
    const block = blockFromSource([
      'q1 = bnot(0) + bnot(3) * 10;',
      'q2 = band(0.5, 0.25) + bor(0, 0) * 10;',
      'q3 = exec2(q1 + 100, q2 + 2);',
      'q4 = exec3(1, 2, q3 + 3);',
      'megabuf(5) = 41;',
      'q5 = exec2(megabuf(5), megabuf(5) + 1);',
    ]);

    const compiled = runCompiled(block, makeScopes(false));
    expectSameScopes(compiled, runInterpreted(block, makeScopes(false)));
    expect(compiled.registers.q1).toBe(1);
    expect(compiled.registers.q2).toBe(1);
    expect(compiled.registers.q3).toBe(3);
    expect(compiled.registers.q4).toBe(6);
    expect(compiled.registers.q5).toBe(42);
  });

  test('match the interpreter for randomness ordering', () => {
    const block = blockFromSource([
      'q1 = rand(10);',
      'q2 = randint(10);',
      't1 = rand(1) + q1;',
    ]);

    expectSameScopes(
      runCompiled(block, makeScopes(false)),
      runInterpreted(block, makeScopes(false)),
    );
  });

  describe('inlined RNG', () => {
    const RNG_SEED = 12345;

    /** Runs one block on both tiers against separately-seeded cells and
     * asserts the two runs agree on scopes AND on the cell they leave
     * behind — the interleaving contract when programs share one VM. */
    function expectInlineAgreement(lines: string[], withLocals = false) {
      const block = blockFromSource(lines);
      const cellJit: EelRngCell = { s: RNG_SEED };
      const cellInterp: EelRngCell = { s: RNG_SEED };
      const compiled = runCompiledInline(
        block,
        makeScopes(withLocals),
        cellJit,
      );
      const interpreted = runInterpreted(
        block,
        makeScopes(withLocals),
        cellInterp,
      );
      expectSameScopes(compiled, interpreted);
      expect(cellJit.s).toBe(cellInterp.s);
      return { compiled, cellJit };
    }

    test('straight-line draws match the interpreter and advance the cell', () => {
      const { compiled, cellJit } = expectInlineAgreement([
        'q1 = rand(10);',
        'q2 = randint(10);',
        't1 = rand(1) + q1;',
        'zoom = rand(5) + randint(6);',
      ]);
      expect(cellJit.s).not.toBe(RNG_SEED);
      expect(compiled.env.zoom).toBeGreaterThanOrEqual(0);
      expect(compiled.env.zoom).toBeLessThan(11);
    });

    test('draws inside loop() match the interpreter, once per iteration', () => {
      const { compiled } = expectInlineAgreement([
        'i = 0;',
        'loop(6, q1 = rand(1001); t1 = t1 + randint(3); i = i + 1;);',
        'q2 = randint(7);',
      ]);
      expect(compiled.registers.q2).toBeGreaterThanOrEqual(0);
      expect(compiled.registers.q2).toBeLessThan(7);
    });

    test('an untaken if() branch draws nothing on either tier', () => {
      const { compiled } = expectInlineAgreement([
        'q1 = if(0, rand(100), 7);',
        'q2 = rand(9);',
        'q3 = if(1, randint(50), -1);',
        't1 = rand(4);',
      ]);
      expect(compiled.registers.q1).toBe(7);
      expect(compiled.registers.q3).toBeGreaterThanOrEqual(0);
      expect(compiled.registers.q3).toBeLessThan(50);
    });

    test('mixed with q-register writes the sequence still matches', () => {
      const { compiled } = expectInlineAgreement([
        'q1 = 2;',
        'q2 = q1 * randint(20);',
        'q3 = rand(q1 + 3);',
        'q4 = q2 + randint(11);',
        't2 = rand(1);',
      ]);
      expect(compiled.registers.q2).toBeGreaterThanOrEqual(0);
      expect(compiled.registers.q2).toBeLessThan(20);
      expect(compiled.registers.q4).toBeGreaterThanOrEqual(0);
    });

    test('the inlined LCG is bit-identical to the closure tier', () => {
      // Same block, same seed: closure mode with a local-seeded callable
      // must produce the same numbers as inline mode with a cell. This pins
      // the inlined constants against the VM's historical LCG expression.
      const lines = [
        'q1 = rand(1001);',
        'q2 = randint(1001);',
        'q3 = rand(2);',
        't1 = rand(1);',
        'zoom = (q4 = rand(5)) + randint(6);',
      ];
      const block = blockFromSource(lines);

      const closureScopes = makeScopes(false);
      let closureSeed = RNG_SEED;
      compileMilkdropProgram(block)(
        closureScopes.env,
        closureScopes.state,
        closureScopes.registers,
        closureScopes.locals,
        closureScopes.megabuf,
        closureScopes.gmegabuf,
        () => {
          closureSeed = (1664525 * closureSeed + 1013904223) >>> 0;
          return closureSeed / 0x100000000;
        },
      );

      const inlineScopes = makeScopes(false);
      runCompiledInline(block, inlineScopes, { s: RNG_SEED });

      for (const key of ['q1', 'q2', 'q3', 'q4', 't1', 'zoom'] as const) {
        expect(inlineScopes.registers[key]).toBe(closureScopes.registers[key]);
        expect(inlineScopes.env[key]).toBe(closureScopes.env[key]);
      }
    });

    test('a shared cell carries the sequence across separate program runs', () => {
      // Two invocations against ONE cell: the state written back by the
      // first run must be the state the second run loads. Compiler code and
      // interpreted code interleave through the same cell in production.
      const first = blockFromSource(['q1 = rand(1001);', 'q2 = randint(31);']);
      const second = blockFromSource(['t1 = rand(3);', 'q3 = randint(5);']);
      const shared: EelRngCell = { s: RNG_SEED };

      const jitScopes = makeScopes(false);
      runCompiledInline(first, jitScopes, shared);
      const afterFirst = shared.s;
      const compiledSecond = runCompiledInline(second, jitScopes, shared);

      const interpScopes = makeScopes(false);
      const replayCell: EelRngCell = { s: RNG_SEED };
      runInterpreted(first, interpScopes, replayCell);
      expect(replayCell.s).toBe(afterFirst);
      runInterpreted(second, interpScopes, replayCell);
      expect(compiledSecond.registers.q3).toBe(interpScopes.registers.q3);
      expect(replayCell.s).toBe(shared.s);
    });

    test('programs that never draw stay untouched by the cell', () => {
      const block = blockFromSource(['q1 = sin(time) + 1;']);
      const cell: EelRngCell = { s: RNG_SEED };
      const scopes = makeScopes(false);
      runCompiledInline(block, scopes, cell);
      expect(cell.s).toBe(RNG_SEED);
      expect(scopes.registers.q1).toBeCloseTo(Math.sin(3.25) + 1, 12);
    });
  });

  test('reuses the compiled function for a given block', () => {
    const block = blockFromSource(['q1 = 1;']);
    expect(compileMilkdropProgram(block)).toBe(compileMilkdropProgram(block));
  });

  test('loop() runs its body count times and matches the interpreter', () => {
    const block = blockFromSource([
      'i = 0;',
      'loop(8, megabuf(i) = i * 2; i = i + 1;);',
      'q1 = megabuf(7);',
      'q2 = i;',
    ]);

    const compiled = runCompiled(block, makeScopes(false));
    const interpreted = runInterpreted(block, makeScopes(false));

    expectSameScopes(compiled, interpreted);
    expect(compiled.registers.q1).toBe(14);
    expect(compiled.registers.q2).toBe(8);
    expect(Array.from(compiled.megabuf.subarray(0, 8))).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14,
    ]);
  });

  test('while() terminates on a false condition and matches the interpreter', () => {
    const block = blockFromSource([
      'b = 0;',
      'i = 0;',
      'while(1048576 > b, gmegabuf(i) = 1; i = i + 1; b = b + 1;);',
      'q1 = i;',
      'q2 = gmegabuf(5);',
    ]);

    // A full gmegabuf clear is ~1M iterations and would dominate the test
    // budget, so cap the condition via a small constant instead.
    const blockSmall = blockFromSource([
      'b = 0;',
      'i = 0;',
      'while(16 > b, gmegabuf(i) = 1; i = i + 1; b = b + 1;);',
      'q1 = i;',
      'q2 = gmegabuf(5);',
    ]);

    const compiled = runCompiled(blockSmall, makeScopes(false));
    const interpreted = runInterpreted(blockSmall, makeScopes(false));

    expectSameScopes(compiled, interpreted);
    expect(compiled.registers.q1).toBe(16);
    expect(compiled.registers.q2).toBe(1);
    expect(Array.from(compiled.gmegabuf.subarray(0, 16))).toEqual(
      Array.from(interpreted.gmegabuf.subarray(0, 16)),
    );
    // The large version must still terminate (guard cap), not hang.
    expect(() => runCompiled(block, makeScopes(false))).not.toThrow();
  });

  test('an infinite while(1, ...) is broken by the iteration cap', () => {
    const block = blockFromSource(['while(1, q1 = q1 + 1;);']);

    expect(() => runCompiled(block, makeScopes(false))).not.toThrow();
    // The guard stops the loop; q1 stops climbing at the cap rather than
    // running forever.
    const compiled = runCompiled(block, makeScopes(false));
    expect(compiled.registers.q1).toBeLessThanOrEqual(2_097_152);
    expect(compiled.registers.q1).toBeGreaterThan(0);
  });

  test('nested loop inside while matches the interpreter', () => {
    const block = blockFromSource([
      'total = 0;',
      'row = 0;',
      'while(3 > row, col = 0; loop(4, total = total + 1; col = col + 1;); row = row + 1;);',
      'q1 = total;',
      'q2 = row;',
    ]);

    const compiled = runCompiled(block, makeScopes(false));
    const interpreted = runInterpreted(block, makeScopes(false));

    expectSameScopes(compiled, interpreted);
    expect(compiled.registers.q1).toBe(12);
    expect(compiled.registers.q2).toBe(3);
  });
});
