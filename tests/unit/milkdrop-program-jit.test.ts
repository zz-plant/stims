import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MilkdropProgramBlock } from '../../src/js/milkdrop/common-types.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { evaluateMilkdropExpression } from '../../src/js/milkdrop/expression.ts';
import {
  compileMilkdropProgram,
  MILKDROP_GMEGABUF_SIZE,
  MILKDROP_MEGABUF_SIZE,
} from '../../src/js/milkdrop/expression-jit.ts';

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
): RunResult {
  const nextRandom = makeRandom();
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

  test('match the interpreter across bundled preset programs', () => {
    const presetDir = join(
      import.meta.dir,
      '../../public/milkdrop-presets/butterchurn',
    );
    const fixtures = [
      'martin-butterflies.milk',
      'flexi-what-is-the-matrix.milk',
      'martin-stormy-sea-2009.milk',
    ];

    let checkedBlocks = 0;
    for (const fixture of fixtures) {
      const preset = compileMilkdropPresetSource(
        readFileSync(join(presetDir, fixture), 'latin1'),
        { id: fixture },
      );
      const blocks: [MilkdropProgramBlock, boolean][] = [
        [preset.ir.programs.init, false],
        [preset.ir.programs.perFrame, false],
        [preset.ir.programs.perPixel, true],
        ...preset.ir.customWaves.flatMap(
          (wave) =>
            [
              [wave.programs.perFrame, true],
              [wave.programs.perPoint, true],
            ] as [MilkdropProgramBlock, boolean][],
        ),
        ...preset.ir.customShapes.map(
          (shape) =>
            [shape.programs.perFrame, true] as [MilkdropProgramBlock, boolean],
        ),
      ];

      for (const [block, withLocals] of blocks) {
        if (block.statements.length === 0) {
          continue;
        }
        checkedBlocks += 1;
        expectSameScopes(
          runCompiled(block, makeScopes(withLocals)),
          runInterpreted(block, makeScopes(withLocals)),
        );
      }
    }

    expect(checkedBlocks).toBeGreaterThan(3);
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

  test('compiles and runs a butterchurn preset that uses while()', () => {
    const preset = compileMilkdropPresetSource(
      readFileSync(
        join(
          import.meta.dir,
          '../../public/milkdrop-presets/butterchurn/flexi-impulse-drive.milk',
        ),
        'latin1',
      ),
      { id: 'flexi-impulse-drive' },
    );

    expect(preset.diagnostics.filter((d) => d.severity === 'error')).toEqual(
      [],
    );

    const init = preset.ir.programs.init;
    const hasLoop = init.statements.some((statement) => statement.control);
    expect(hasLoop).toBe(true);

    // Running the init block (which includes a ~1M-entry gmegabuf clear) must
    // terminate and not throw. Use a fresh gmegabuf so the run is real work.
    const scopes = makeScopes(false);
    expect(() => runCompiled(init, scopes)).not.toThrow();
  });
});
