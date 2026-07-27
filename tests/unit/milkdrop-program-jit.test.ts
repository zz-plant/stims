import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import type { MilkdropProgramBlock } from '../../src/js/milkdrop/common-types.ts';
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
function runInterpreted(
  block: MilkdropProgramBlock,
  scopes: RunResult,
): RunResult {
  const { env, state, registers, locals, megabuf, gmegabuf } = scopes;
  const nextRandom = makeRandom();
  const helpers = {
    nextRandom,
    megabuf: (index: number) => {
      const normalized = Math.trunc(index);
      return normalized >= 0 && normalized < MILKDROP_MEGABUF_SIZE
        ? (megabuf[normalized] ?? 0)
        : 0;
    },
    gmegabuf: (index: number) => {
      const normalized = Math.trunc(index);
      return normalized >= 0 && normalized < MILKDROP_GMEGABUF_SIZE
        ? (gmegabuf[normalized] ?? 0)
        : 0;
    },
  };

  for (const statement of block.statements) {
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
  const env: Scope = Object.assign(Object.create(null) as Scope, signals, state);
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
});
