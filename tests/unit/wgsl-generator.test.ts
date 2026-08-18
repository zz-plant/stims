import { describe, expect, test } from 'bun:test';
import {
  buildWgslExpressionString,
  compileProgramToWgsl,
} from '../../src/js/milkdrop/compiler/wgsl-generator.ts';
import type {
  MilkdropCompiledStatement,
  MilkdropExpressionNode,
  MilkdropProgramBlock,
} from '../../src/js/milkdrop/types.ts';
import { MILKDROP_WGSL_SIGNAL_FIELDS } from '../../src/js/milkdrop/wgsl-signal-layout.ts';

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
    expect(buildWgslExpressionString(ident('bass'))).toBe('signals.bass');
    expect(buildWgslExpressionString(ident('time'))).toBe('signals.time');
    expect(buildWgslExpressionString(ident('BASS'))).toBe('signals.bass');
    expect(buildWgslExpressionString(ident('aspect'))).toBe('signals.aspect');
    expect(buildWgslExpressionString(ident('weightedEnergy'))).toBe(
      'signals.weighted_energy',
    );
    expect(buildWgslExpressionString(ident('enabled'))).toBe('state.enabled');
    expect(buildWgslExpressionString(ident('pi'))).toBe('3.141592653589793');
    expect(buildWgslExpressionString(ident('e'))).toBe('2.718281828459045');
    expect(buildWgslExpressionString(ident('rand'))).toBe('rand()');
  });

  test('unary operators', () => {
    expect(buildWgslExpressionString(unary('+', literal(5)))).toBe('5');
    expect(buildWgslExpressionString(unary('-', literal(5)))).toBe('(-5)');
    expect(buildWgslExpressionString(unary('!', ident('enabled')))).toBe(
      'select(1.0f, 0.0f, abs(state.enabled) > 0.00001f)',
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
    ).toBe('(signals.bass * 2)');
    expect(
      buildWgslExpressionString(binary('/', ident('vol'), literal(0))),
    ).toBe('milkdropDiv(signals.vol, 0)');
    expect(buildWgslExpressionString(binary('^', literal(2), literal(3)))).toBe(
      'milkdropPow(2, 3)',
    );
    // `%` is integer modulo in EEL: both operands truncate before dividing.
    expect(buildWgslExpressionString(binary('%', literal(7), literal(3)))).toBe(
      'milkdropIntMod(7, 3)',
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
    ).toBe('select(0.0f, 1.0f, signals.bass < 0.5)');
    expect(
      buildWgslExpressionString(binary('>=', ident('vol'), literal(0))),
    ).toBe('select(0.0f, 1.0f, signals.vol >= 0)');
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
      'select(0.0f, 1.0f, abs(signals.beat) > 0.00001f && abs(state.enabled) > 0.00001f)',
    );
    expect(
      buildWgslExpressionString(binary('||', ident('bass'), ident('treb'))),
    ).toBe(
      'select(0.0f, 1.0f, abs(signals.bass) > 0.00001f || abs(signals.treb) > 0.00001f)',
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
      'milkdropSqrt(4)',
    );
    expect(
      buildWgslExpressionString(call('pow', [literal(2), literal(3)])),
    ).toBe('milkdropPow(2, 3)');
    // mod()/fmod() are float remainders, unlike the `%` operator above.
    expect(
      buildWgslExpressionString(call('mod', [literal(7), literal(3)])),
    ).toBe('milkdropFmod(7, 3)');
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
    // log(0) is 0 (max(0)+finite clamp), matching the CPU tiers.
    expect(buildWgslExpressionString(call('log', [literal(10)]))).toBe(
      'milkdropLog(10)',
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

  test('function calls - logical bor/band/bnot', () => {
    expect(
      buildWgslExpressionString(call('bor', [literal(1), literal(2)])),
    ).toBe('select(0.0f, 1.0f, abs(1) > 0.00001f || abs(2) > 0.00001f)');
    expect(
      buildWgslExpressionString(call('band', [literal(3), literal(1)])),
    ).toBe('select(0.0f, 1.0f, abs(3) > 0.00001f && abs(1) > 0.00001f)');
    expect(buildWgslExpressionString(call('bnot', [literal(0)]))).toBe(
      'select(1.0f, 0.0f, abs(0) > 0.00001f)',
    );
  });

  test('function calls - exec2/exec3 return their final argument', () => {
    expect(
      buildWgslExpressionString(call('exec2', [literal(1), literal(2)])),
    ).toBe('2');
    expect(
      buildWgslExpressionString(
        call('exec3', [literal(1), literal(2), literal(3)]),
      ),
    ).toBe('3');
  });

  test('function calls - conditional/rand', () => {
    expect(
      buildWgslExpressionString(
        call('if', [literal(1), literal(10), literal(20)]),
      ),
    ).toBe('select(f32(20), f32(10), abs(1) > 0.00001f)');
    expect(
      buildWgslExpressionString(call('above', [literal(5), literal(3)])),
    ).toBe('select(0.0f, 1.0f, (5) > (3))');
    expect(
      buildWgslExpressionString(call('below', [literal(5), literal(3)])),
    ).toBe('select(0.0f, 1.0f, (5) < (3))');
    expect(
      buildWgslExpressionString(call('equal', [literal(5), literal(5)])),
      // equal() is close-factor equality, like the interpreter; only the ==
      // operator compares exactly.
    ).toBe('milkdropEqual(5, 5)');
    expect(buildWgslExpressionString(call('rand', []))).toBe('rand()');
    expect(buildWgslExpressionString(call('nonexistent', [literal(1)]))).toBe(
      '0.0f',
    );
  });

  test('keeps integer-looking if branches in the MilkDrop f32 domain', () => {
    const expression = call('if', [
      call('above', [
        binary('+', ident('treb'), ident('treb_att')),
        literal(2.8),
      ]),
      literal(1),
      literal(0),
    ]);

    expect(buildWgslExpressionString(expression)).toBe(
      'select(f32(0), f32(1), abs(select(0.0f, 1.0f, ((signals.treb + signals.treb_att)) > (2.8))) > 0.00001f)',
    );
  });

  test('case insensitivity', () => {
    expect(buildWgslExpressionString(ident('BASS'))).toBe('signals.bass');
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
      '((signals.bass + signals.mid) * sin(signals.time))',
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
    expect(result.wgslCode).toContain(
      'state.myvar = milkdropFinite((signals.bass + 1))',
    );
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

  test('rand() call usage includes the random helper and state', () => {
    const result = compileProgramToWgsl(
      block([statement('myvar', call('rand', []))]),
    );
    expect(result.usesRandom).toBe(true);
    expect(result.wgslCode).toContain('fn rand()');
    expect(result.wgslCode).toContain('rand_state: u32');
  });

  test('randint() call usage includes the random helper and clamps negative bounds', () => {
    const result = compileProgramToWgsl(
      block([statement('myvar', call('randint', [literal(-4)]))]),
    );
    expect(result.usesRandom).toBe(true);
    expect(result.wgslCode).toContain('fn rand()');
    expect(result.wgslCode).toContain('floor(rand() * max(0.0f, -4))');
  });

  test('register identifiers (q/t) persist in storage across dispatches', () => {
    const result = compileProgramToWgsl(
      block([
        statement('q1', binary('+', ident('bass'), literal(1))),
        statement('t5', binary('*', ident('mid'), literal(2))),
        { target: 'result', expression: ident('q1'), source: '', line: 0 },
      ]),
    );
    expect(result.registerKeys).toContain('q1');
    expect(result.registerKeys).toContain('t5');
    expect(result.fieldKeys).toContain('q1');
    expect(result.fieldKeys).toContain('t5');
    expect(result.wgslCode).toContain(
      'state.q1 = milkdropFinite((signals.bass + 1))',
    );
    expect(result.wgslCode).toContain(
      'state.t5 = milkdropFinite((signals.mid * 2))',
    );
    expect(result.wgslCode).toContain(
      'state.result = milkdropFinite(state.q1)',
    );
    expect(result.wgslCode).not.toContain('var reg_q1');
    expect(result.wgslCode).not.toContain('var reg_t5');
  });

  test('megabuf programs are classified for CPU fallback instead of invalid WGSL', () => {
    const result = compileProgramToWgsl(
      block([statement('q1', call('megabuf', [literal(4)]))]),
    );
    expect(result.gpuExecutable).toBe(false);
    expect(result.unsupportedFeatures).toContain('megabuf');
    expect(result.wgslCode).not.toContain('megabuf[');
  });

  test('gmegabuf programs are classified for CPU fallback instead of invalid WGSL', () => {
    const result = compileProgramToWgsl(
      block([statement('q1', call('gmegabuf', [literal(4)]))]),
    );
    expect(result.gpuExecutable).toBe(false);
    expect(result.unsupportedFeatures).toContain('gmegabuf');
    expect(result.wgslCode).not.toContain('gmegabuf[');
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
    expect(result.wgslCode).toContain('aspect: f32,');
    expect(result.wgslCode).toContain('beat: f32,');
    expect(result.wgslCode).toContain('weighted_energy: f32,');
  });

  test('signal struct follows the shared upload layout', () => {
    const result = compileProgramToWgsl(block([]));
    const start = result.wgslCode.indexOf('struct VmSignals {');
    const end = result.wgslCode.indexOf('}', start);
    const fields = result.wgslCode
      .slice(start, end)
      .match(/\n {2}([A-Za-z_]+): f32,/gu)
      ?.map((field) => field.trim().replace(/: f32,$/u, ''));
    expect(fields).toEqual([...MILKDROP_WGSL_SIGNAL_FIELDS]);
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
    expect(result.wgslCode).toContain(
      'state.bg_r = milkdropFinite((signals.bass + 0.02))',
    );
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
    // fieldKeys sizes the GPU state buffer, so it must match every field
    // the VmState struct declares (defaults + 'pi'/'e'), even when the
    // program itself references none of them — an empty list here would
    // allocate a zero-byte buffer that WebGPU rejects at bind-group time.
    expect(result.fieldKeys.length).toBeGreaterThan(0);
    for (const field of result.fieldKeys) {
      expect(result.wgslCode).toContain(`${field}: f32,`);
    }
    expect(result.registerKeys).toEqual([]);
  });

  test('division routes through milkdropDiv (exact-zero guard)', () => {
    // The guard is exact zero, not a tolerance: dividing by a tiny nonzero
    // value must produce the same large finite result the CPU tiers compute
    // (the old abs(right) > 1e-6 guard silently zeroed it).
    const result = buildWgslExpressionString(
      binary('/', ident('vol'), literal(0.0000001)),
    );
    expect(result).toBe('milkdropDiv(signals.vol, 1e-7)');
  });

  test('integer helpers use a representable f32 finite-value threshold', () => {
    const result = compileProgramToWgsl(
      block([statement('x', binary('%', literal(7), literal(3)))]),
    );

    expect(result.wgslCode).not.toContain('3.4028235e38');
    expect(result.wgslCode).toContain('abs(value) < 3.402823e38f');
  });

  test('nested rand()', () => {
    const expr = binary(
      '*',
      call('rand', []),
      binary('+', ident('bass'), literal(1)),
    );
    const result = buildWgslExpressionString(expr);
    expect(result).toContain('rand()');
    expect(result).toContain('signals.bass');
  });

  test('standalone rand triggers usesRandom', () => {
    const result = compileProgramToWgsl(
      block([statement('seed', ident('rand'))]),
    );
    expect(result.usesRandom).toBe(true);
    expect(result.wgslCode).toContain('rand_state: u32');
  });
});

// ─── WGSL Reserved Word Escaping ───────────────────────────────────
// `mod` is a legal MilkDrop variable and appears in stock presets, but it is a
// reserved word in WGSL. Emitting it raw made the whole module fail to parse,
// which invalidated the compute pipeline and killed the WebGPU path entirely.
describe('WGSL reserved word escaping', () => {
  test('escapes `mod` in both the struct and its accesses', () => {
    const result = compileProgramToWgsl(
      block([
        statement('mod', binary('*', ident('bass'), literal(2))),
        statement('zoom', binary('+', literal(1), ident('mod'))),
      ]),
    );

    // Nothing may declare or reference a bare `mod`.
    expect(result.wgslCode).not.toMatch(/^\s*mod\s*:/mu);
    expect(result.wgslCode).not.toMatch(/\bstate\.mod\b/u);

    // It is present, under the escaped name, on both sides.
    expect(result.wgslCode).toContain('mv_mod: f32,');
    expect(result.wgslCode).toContain('state.mv_mod =');
    expect(result.wgslCode).toContain('state.mv_mod)');
  });

  test('escaping does not change the buffer layout keys', () => {
    const result = compileProgramToWgsl(block([statement('mod', literal(1))]));
    // fieldKeys drive the GPU buffer offsets and the host-side writes, which
    // are keyed by the preset's own variable names — they must stay unescaped.
    expect(result.fieldKeys).toContain('mod');
    expect(result.fieldKeys).not.toContain('mv_mod');
  });

  test('leaves non-reserved names untouched', () => {
    const result = compileProgramToWgsl(
      block([statement('myvar', ident('zoom'))]),
    );
    expect(result.wgslCode).toContain('state.myvar =');
    expect(result.wgslCode).toContain('state.zoom');
    expect(result.wgslCode).not.toContain('mv_myvar');
    expect(result.wgslCode).not.toContain('mv_zoom');
  });

  test('escaping stays injective for names shaped like the escape', () => {
    // A preset variable literally named `mv_mod` must not collide with the
    // escaped form of `mod`.
    const result = compileProgramToWgsl(
      block([statement('mod', literal(1)), statement('mv_mod', literal(2))]),
    );
    expect(result.wgslCode).toContain('mv_mod: f32,');
    expect(result.wgslCode).toContain('mv_mv_mod: f32,');
    const declarations = result.wgslCode.match(/^\s*mv_\w+: f32,$/gmu) ?? [];
    expect(new Set(declarations).size).toBe(declarations.length);
  });

  test('no emitted struct field is a bare WGSL reserved word', () => {
    // Guards the default state fields plus anything a preset can introduce.
    const reserved = new Set([
      'mod',
      'const',
      'var',
      'let',
      'fn',
      'loop',
      'if',
      'else',
      'return',
      'struct',
      'switch',
      'case',
      'default',
      'break',
      'continue',
      'discard',
      'true',
      'false',
      'while',
      'for',
      'type',
      'filter',
      'sizeof',
      'do',
    ]);
    const result = compileProgramToWgsl(block([statement('mod', literal(1))]));
    const fields = [
      ...result.wgslCode.matchAll(/^\s*(\w+):\s*(?:f32|u32),$/gmu),
    ].map((m) => m[1]);
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(reserved.has(field)).toBe(false);
    }
  });
});
