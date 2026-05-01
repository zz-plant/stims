import { describe, expect, test } from 'bun:test';
import {
  buildWgslExpressionString,
  compileProgramToWgsl,
} from '../assets/js/milkdrop/compiler/wgsl-generator.ts';
import type {
  MilkdropCompiledStatement,
  MilkdropExpressionNode,
  MilkdropProgramBlock,
} from '../assets/js/milkdrop/types.ts';

function literal(value: number): MilkdropExpressionNode {
  return { type: 'literal', value };
}
function ident(name: string): MilkdropExpressionNode {
  return { type: 'identifier', name };
}
function unary(
  operator: '+' | '-' | '!',
  operand: MilkdropExpressionNode,
): MilkdropExpressionNode {
  return { type: 'unary', operator, operand };
}
function binary(
  operator:
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '^'
    | '<'
    | '<='
    | '>'
    | '>='
    | '=='
    | '!='
    | '&&'
    | '||'
    | '|'
    | '&',
  left: MilkdropExpressionNode,
  right: MilkdropExpressionNode,
): MilkdropExpressionNode {
  return { type: 'binary', operator, left, right };
}
function call(
  name: string,
  args: MilkdropExpressionNode[],
): MilkdropExpressionNode {
  return { type: 'call', name, args };
}
function statement(
  target: string,
  expression: MilkdropExpressionNode,
): MilkdropCompiledStatement {
  return { target, expression, source: '', line: 0 };
}
function block(statements: MilkdropCompiledStatement[]): MilkdropProgramBlock {
  return { statements, sourceLines: [] };
}

// ─── Expression Tests ──────────────────────────────────────────────

describe('wgsl expression generation', () => {
  test('literal values', () => {
    expect(buildWgslExpressionString(literal(42))).toBe('42');
    expect(buildWgslExpressionString(literal(0.5))).toBe('0.5');
    expect(buildWgslExpressionString(literal(-3))).toBe('-3');
    expect(buildWgslExpressionString(literal(Infinity))).toBe('0.0');
    expect(buildWgslExpressionString(literal(NaN))).toBe('0.0');
  });

  test('identifier resolution', () => {
    expect(buildWgslExpressionString(ident('bass'))).toBe('state.bass');
    expect(buildWgslExpressionString(ident('time'))).toBe('state.time');
    expect(buildWgslExpressionString(ident('BASS'))).toBe('state.bass');
    expect(buildWgslExpressionString(ident('pi'))).toBe('3.141592653589793');
    expect(buildWgslExpressionString(ident('e'))).toBe('2.718281828459045');
    expect(buildWgslExpressionString(ident('rand'))).toBe('rand()');
  });

  test('unary operators', () => {
    expect(buildWgslExpressionString(unary('+', literal(5)))).toBe('5');
    expect(buildWgslExpressionString(unary('-', literal(5)))).toBe('(-5)');
    expect(buildWgslExpressionString(unary('!', ident('enabled')))).toBe(
      'select(1.0f, 0.0f, abs(state.enabled) > 0.000001f)',
    );
  });

  test('binary arithmetic', () => {
    expect(buildWgslExpressionString(binary('+', literal(1), literal(2)))).toBe(
      '(1 + 2)',
    );
    expect(buildWgslExpressionString(binary('-', literal(5), literal(3)))).toBe(
      '(5 - 3)',
    );
    expect(
      buildWgslExpressionString(binary('*', ident('bass'), literal(2))),
    ).toBe('(state.bass * 2)');
    expect(
      buildWgslExpressionString(binary('/', ident('vol'), literal(0))),
    ).toBe('select(0.0f, (state.vol) / (0), abs(0) > 0.000001f)');
    expect(buildWgslExpressionString(binary('^', literal(2), literal(3)))).toBe(
      'pow(2, 3)',
    );
    expect(buildWgslExpressionString(binary('%', literal(7), literal(3)))).toBe(
      'select(0.0f, f32(i32(7) % i32(3)), abs(3) > 0.000001f)',
    );
  });

  test('binary bitwise', () => {
    expect(buildWgslExpressionString(binary('|', literal(1), literal(2)))).toBe(
      'f32(i32(1) | i32(2))',
    );
    expect(buildWgslExpressionString(binary('&', literal(3), literal(1)))).toBe(
      'f32(i32(3) & i32(1))',
    );
  });

  test('binary comparisons', () => {
    expect(
      buildWgslExpressionString(binary('<', ident('bass'), literal(0.5))),
    ).toBe('select(0.0f, 1.0f, state.bass < 0.5)');
    expect(
      buildWgslExpressionString(binary('>=', ident('vol'), literal(0))),
    ).toBe('select(0.0f, 1.0f, state.vol >= 0)');
    expect(
      buildWgslExpressionString(binary('==', ident('enabled'), literal(1))),
    ).toBe('select(0.0f, 1.0f, state.enabled == 1)');
    expect(
      buildWgslExpressionString(binary('!=', ident('mode'), literal(0))),
    ).toBe('select(0.0f, 1.0f, state.mode != 0)');
  });

  test('binary logical', () => {
    expect(
      buildWgslExpressionString(binary('&&', ident('beat'), ident('enabled'))),
    ).toBe(
      'select(0.0f, 1.0f, abs(state.beat) > 0.000001f && abs(state.enabled) > 0.000001f)',
    );
    expect(
      buildWgslExpressionString(binary('||', ident('bass'), ident('treb'))),
    ).toBe(
      'select(0.0f, 1.0f, abs(state.bass) > 0.000001f || abs(state.treb) > 0.000001f)',
    );
  });

  test('function calls - trig', () => {
    expect(buildWgslExpressionString(call('sin', [literal(0)]))).toBe('sin(0)');
    expect(buildWgslExpressionString(call('cos', [literal(Math.PI)]))).toBe(
      `cos(${Math.PI})`,
    );
    expect(buildWgslExpressionString(call('tan', [literal(0)]))).toBe('tan(0)');
    expect(buildWgslExpressionString(call('asin', [literal(0.5)]))).toBe(
      'asin(clamp(0.5, -1.0f, 1.0f))',
    );
    expect(buildWgslExpressionString(call('acos', [literal(0)]))).toBe(
      'acos(clamp(0, -1.0f, 1.0f))',
    );
    expect(buildWgslExpressionString(call('atan', [literal(1)]))).toBe(
      'atan(1)',
    );
  });

  test('function calls - math', () => {
    expect(buildWgslExpressionString(call('abs', [literal(-3)]))).toBe(
      'abs(-3)',
    );
    expect(buildWgslExpressionString(call('sqrt', [literal(4)]))).toBe(
      'sqrt(max(0.0f, 4))',
    );
    expect(
      buildWgslExpressionString(call('pow', [literal(2), literal(3)])),
    ).toBe('pow(2, 3)');
    expect(
      buildWgslExpressionString(call('mod', [literal(7), literal(3)])),
    ).toBe('select(0.0f, (7) % (3), abs(3) > 0.000001f)');
    expect(buildWgslExpressionString(call('floor', [literal(3.7)]))).toBe(
      'floor(3.7)',
    );
    expect(buildWgslExpressionString(call('ceil', [literal(2.1)]))).toBe(
      'ceil(2.1)',
    );
    expect(buildWgslExpressionString(call('sqr', [literal(5)]))).toBe(
      '(5 * 5)',
    );
    expect(buildWgslExpressionString(call('sign', [literal(-5)]))).toBe(
      'sign(-5)',
    );
    expect(buildWgslExpressionString(call('log', [literal(10)]))).toBe(
      'log(max(0.000001f, 10))',
    );
    expect(buildWgslExpressionString(call('exp', [literal(1)]))).toBe('exp(1)');
  });

  test('function calls - min/max/mix/clamp', () => {
    expect(
      buildWgslExpressionString(call('min', [literal(1), literal(2)])),
    ).toBe('min(1, 2)');
    expect(
      buildWgslExpressionString(call('max', [literal(1), literal(2)])),
    ).toBe('max(1, 2)');
    expect(
      buildWgslExpressionString(
        call('mix', [literal(0), literal(1), literal(0.5)]),
      ),
    ).toBe('mix(0, 1, 0.5)');
    expect(
      buildWgslExpressionString(
        call('lerp', [literal(0), literal(1), literal(0.5)]),
      ),
    ).toBe('mix(0, 1, 0.5)');
    expect(
      buildWgslExpressionString(
        call('clamp', [literal(0.5), literal(0), literal(1)]),
      ),
    ).toBe('clamp(0.5, 0, 1)');
  });

  test('function calls - step/smoothstep', () => {
    expect(
      buildWgslExpressionString(call('step', [literal(0.5), literal(0.7)])),
    ).toBe('select(0.0f, 1.0f, 0.7 >= 0.5)');
    expect(
      buildWgslExpressionString(
        call('smoothstep', [literal(0), literal(1), literal(0.5)]),
      ),
    ).toBe('smoothstep(0, 1, 0.5)');
  });

  test('function calls - sigmoid/frac', () => {
    expect(buildWgslExpressionString(call('sigmoid', [literal(0)]))).toBe(
      '(1.0f / (1.0f + exp(-(0) * (1.0f))))',
    );
    expect(
      buildWgslExpressionString(call('sigmoid', [literal(0), literal(2)])),
    ).toBe('(1.0f / (1.0f + exp(-(0) * (2))))');
    expect(buildWgslExpressionString(call('frac', [literal(3.7)]))).toBe(
      '(3.7 - floor(3.7))',
    );
  });

  test('function calls - bitwise', () => {
    expect(
      buildWgslExpressionString(call('bor', [literal(1), literal(2)])),
    ).toBe('f32(i32(1) | i32(2))');
    expect(
      buildWgslExpressionString(call('band', [literal(3), literal(1)])),
    ).toBe('f32(i32(3) & i32(1))');
    expect(buildWgslExpressionString(call('bnot', [literal(0)]))).toBe(
      'f32(~i32(0))',
    );
  });

  test('function calls - conditional/rand', () => {
    expect(
      buildWgslExpressionString(
        call('if', [literal(1), literal(10), literal(20)]),
      ),
    ).toBe('select(20, 10, abs(1) > 0.000001f)');
    expect(
      buildWgslExpressionString(call('above', [literal(5), literal(3)])),
    ).toBe('select(0.0f, 1.0f, (5) > (3))');
    expect(
      buildWgslExpressionString(call('below', [literal(5), literal(3)])),
    ).toBe('select(0.0f, 1.0f, (5) < (3))');
    expect(
      buildWgslExpressionString(call('equal', [literal(5), literal(5)])),
    ).toBe('select(0.0f, 1.0f, (5) == (5))');
    expect(buildWgslExpressionString(call('rand', []))).toBe('rand()');
    expect(buildWgslExpressionString(call('nonexistent', [literal(1)]))).toBe(
      '0.0f',
    );
  });

  test('case insensitivity', () => {
    expect(buildWgslExpressionString(ident('BASS'))).toBe('state.bass');
    expect(buildWgslExpressionString(ident('PI'))).toBe('3.141592653589793');
    expect(buildWgslExpressionString(ident('E'))).toBe('2.718281828459045');
  });

  test('nested expression', () => {
    const expr = binary(
      '*',
      binary('+', ident('bass'), ident('mid')),
      call('sin', [ident('time')]),
    );
    expect(buildWgslExpressionString(expr)).toBe(
      '((state.bass + state.mid) * sin(state.time))',
    );
  });
});

// ─── Program Compilation Tests ─────────────────────────────────────

describe('wgsl program compilation', () => {
  test('simple single-statement', () => {
    const result = compileProgramToWgsl(
      block([statement('myvar', binary('+', ident('bass'), literal(1)))]),
    );
    expect(result.entryPoint).toBe('main');
    expect(result.usesRandom).toBe(false);
    expect(result.fieldKeys).toContain('bass');
    expect(result.fieldKeys).toContain('myvar');
    expect(result.wgslCode).toContain('state.myvar = (state.bass + 1)');
    expect(result.wgslCode).toContain('struct VmState');
    expect(result.wgslCode).toContain('struct VmSignals');
    expect(result.wgslCode).toContain('fn main()');
    expect(result.wgslCode).not.toContain('fn rand()');
  });

  test('rand() usage', () => {
    const result = compileProgramToWgsl(
      block([statement('myvar', ident('rand'))]),
    );
    expect(result.usesRandom).toBe(true);
    expect(result.wgslCode).toContain('fn rand()');
    expect(result.wgslCode).toContain('rand_state: u32');
  });

  test('register identifiers (q/t)', () => {
    const result = compileProgramToWgsl(
      block([
        statement('q1', binary('+', ident('bass'), literal(1))),
        statement('t5', binary('*', ident('mid'), literal(2))),
        { target: 'result', expression: ident('q1'), source: '', line: 0 },
      ]),
    );
    expect(result.registerKeys).toContain('q1');
    expect(result.registerKeys).toContain('t5');
    expect(result.wgslCode).toContain('reg_q1 = (state.bass + 1)');
    expect(result.wgslCode).toContain('reg_t5 = (state.mid * 2)');
    expect(result.wgslCode).toContain('reg_q1:');
    expect(result.wgslCode).toContain('reg_t5:');
  });

  test('default state fields always included', () => {
    const result = compileProgramToWgsl(block([statement('x', literal(1))]));
    expect(result.wgslCode).toContain('bass: f32,');
    expect(result.wgslCode).toContain('mid: f32,');
    expect(result.wgslCode).toContain('treb: f32,');
    expect(result.wgslCode).toContain('time: f32,');
    expect(result.wgslCode).toContain('frame: f32,');
    expect(result.wgslCode).toContain('fps: f32,');
    expect(result.wgslCode).toContain('bg_r: f32,');
    expect(result.wgslCode).toContain('bg_g: f32,');
    expect(result.wgslCode).toContain('bg_b: f32,');
    expect(result.wgslCode).toContain('decay: f32,');
  });

  test('state struct includes user + default fields', () => {
    const result = compileProgramToWgsl(
      block([statement('zebra', literal(1))]),
    );
    const start = result.wgslCode.indexOf('struct VmState {');
    const end = result.wgslCode.indexOf('}', start);
    const structBody = result.wgslCode.slice(start, end);
    expect(structBody).toContain('zebra: f32,');
    expect(structBody).toContain('bass: f32,');
    expect(structBody).toContain('meshx: f32,');
    expect(structBody).toContain('meshy: f32,');
    expect(structBody).toContain('pi: f32,');
    expect(structBody).toContain('e: f32,');
  });

  test('signal struct included', () => {
    const result = compileProgramToWgsl(block([statement('x', literal(1))]));
    expect(result.wgslCode).toContain('struct VmSignals');
    expect(result.wgslCode).toContain('beat: f32,');
    expect(result.wgslCode).toContain('weighted_energy: f32,');
  });

  test('caching - same program same signature', () => {
    const b = block([
      statement('a', binary('+', ident('bass'), literal(0.5))),
      statement('b', binary('*', ident('mid'), literal(2))),
    ]);
    const r1 = compileProgramToWgsl(b);
    const r2 = compileProgramToWgsl(b);
    expect(r1.signature).toBe(r2.signature);
    expect(r1.wgslCode).toBe(r2.wgslCode);
  });

  test('different programs different signatures', () => {
    const b1 = block([
      statement('a', binary('+', ident('bass'), literal(0.5))),
      statement('b', binary('*', ident('mid'), literal(2))),
    ]);
    const b2 = block([statement('x', binary('-', ident('treb'), literal(1)))]);
    expect(compileProgramToWgsl(b1).signature).not.toBe(
      compileProgramToWgsl(b2).signature,
    );
  });

  test('field key ordering preserved', () => {
    const result = compileProgramToWgsl(
      block([
        statement('zulu', literal(1)),
        statement('alpha', literal(2)),
        statement('mike', literal(3)),
      ]),
    );
    expect(result.fieldKeys).toContain('zulu');
    expect(result.fieldKeys).toContain('alpha');
    expect(result.fieldKeys).toContain('mike');
    expect(result.wgslCode).toContain('alpha: f32,');
    expect(result.wgslCode).toContain('mike: f32,');
    expect(result.wgslCode).toContain('zulu: f32,');
  });

  test('only default fields, no rand', () => {
    const result = compileProgramToWgsl(
      block([statement('bg_r', binary('+', ident('bass'), literal(0.02)))]),
    );
    expect(result.usesRandom).toBe(false);
    expect(result.wgslCode).toContain('state.bg_r = (state.bass + 0.02)');
    expect(result.wgslCode).not.toContain('fn rand()');
    expect(result.wgslCode).not.toContain('rand_state');
  });
});

// ─── Edge Cases ────────────────────────────────────────────────────

describe('wgsl edge cases', () => {
  test('zero statements valid', () => {
    const result = compileProgramToWgsl(block([]));
    expect(result.wgslCode).toContain('struct VmState');
    expect(result.wgslCode).toContain('struct VmSignals');
    expect(result.wgslCode).toContain('fn main()');
    expect(result.fieldKeys).toEqual([]);
    expect(result.registerKeys).toEqual([]);
  });

  test('division by near-zero guarded', () => {
    const result = buildWgslExpressionString(
      binary('/', ident('vol'), literal(0.0000001)),
    );
    expect(result).toContain('select');
    expect(result).toContain('abs');
  });

  test('nested rand()', () => {
    const expr = binary(
      '*',
      call('rand', []),
      binary('+', ident('bass'), literal(1)),
    );
    const result = buildWgslExpressionString(expr);
    expect(result).toContain('rand()');
    expect(result).toContain('state.bass');
  });

  test('standalone rand triggers usesRandom', () => {
    const result = compileProgramToWgsl(
      block([statement('seed', ident('rand'))]),
    );
    expect(result.usesRandom).toBe(true);
    expect(result.wgslCode).toContain('rand_state: u32');
  });
});
