import type {
  MilkdropCompiledStatement,
  MilkdropExpressionNode,
  MilkdropProgramBlock,
} from '../types';
import {
  MILKDROP_WGSL_SIGNAL_ALIAS_MAP,
  MILKDROP_WGSL_SIGNAL_FIELDS,
} from '../wgsl-signal-layout.ts';

const WGSL_IDENTIFIER_MAP = new Map<string, string>([
  ['pi', '3.141592653589793'],
  ['e', '2.718281828459045'],
]);

/** Keywords and reserved words from the WGSL spec. MilkDrop's grammar happily
 * accepts many of these as variable names (`mod` is the common one — it shows
 * up in stock presets), but emitting them as struct members or field accesses
 * is a hard parse error that invalidates the whole shader module. */
const WGSL_RESERVED_WORDS = new Set([
  // keywords
  'alias',
  'break',
  'case',
  'const',
  'const_assert',
  'continue',
  'continuing',
  'default',
  'diagnostic',
  'discard',
  'else',
  'enable',
  'false',
  'fn',
  'for',
  'if',
  'let',
  'loop',
  'override',
  'requires',
  'return',
  'struct',
  'switch',
  'true',
  'var',
  'while',
  // reserved words
  'NULL',
  'Self',
  'abstract',
  'active',
  'alignas',
  'alignof',
  'as',
  'asm',
  'asm_fragment',
  'async',
  'attribute',
  'auto',
  'await',
  'become',
  'binding_array',
  'cast',
  'catch',
  'class',
  'co_await',
  'co_return',
  'co_yield',
  'coherent',
  'column_major',
  'common',
  'compile',
  'compile_fragment',
  'concept',
  'const_cast',
  'consteval',
  'constexpr',
  'constinit',
  'crate',
  'debugger',
  'decltype',
  'delete',
  'demote',
  'demote_to_helper',
  'do',
  'dynamic_cast',
  'enum',
  'explicit',
  'export',
  'extends',
  'extern',
  'external',
  'fallthrough',
  'filter',
  'final',
  'finally',
  'friend',
  'from',
  'fxgroup',
  'get',
  'goto',
  'groupshared',
  'highp',
  'impl',
  'implements',
  'import',
  'inline',
  'instanceof',
  'interface',
  'layout',
  'lowp',
  'macro',
  'macro_rules',
  'match',
  'mediump',
  'meta',
  'mod',
  'module',
  'move',
  'mut',
  'mutable',
  'namespace',
  'new',
  'nil',
  'noexcept',
  'noinline',
  'nointerpolation',
  'non_coherent',
  'noncoherent',
  'noperspective',
  'null',
  'nullptr',
  'of',
  'operator',
  'package',
  'packoffset',
  'partition',
  'pass',
  'patch',
  'pixelfragment',
  'precise',
  'precision',
  'premerge',
  'priv',
  'protected',
  'pub',
  'public',
  'readonly',
  'ref',
  'regardless',
  'register',
  'reinterpret_cast',
  'require',
  'resource',
  'restrict',
  'self',
  'set',
  'shared',
  'sizeof',
  'smooth',
  'snorm',
  'static',
  'static_assert',
  'static_cast',
  'std',
  'subroutine',
  'super',
  'target',
  'template',
  'this',
  'thread_local',
  'throw',
  'trait',
  'try',
  'type',
  'typedef',
  'typeid',
  'typename',
  'typeof',
  'union',
  'unless',
  'unorm',
  'unsafe',
  'unsized',
  'use',
  'using',
  'varying',
  'virtual',
  'volatile',
  'wgsl',
  'where',
  'with',
  'writeonly',
  'yield',
]);

/** Prefix applied to preset variables whose names collide with WGSL. */
const WGSL_ESCAPE_PREFIX = 'mv_';

/** Renames a preset variable so it is safe to emit as a WGSL identifier.
 *
 * Only the emitted *text* changes: the GPU buffer layout is derived from the
 * original (unescaped) field keys in buffer-manager.ts, and both it and the
 * struct sort those same original names, so offsets are unaffected.
 *
 * Escaping already-prefixed names keeps the mapping injective — a preset
 * variable literally called `mv_mod` becomes `mv_mv_mod` and so cannot collide
 * with the escaped form of `mod`. */
function escapeWgslFieldName(name: string): string {
  if (WGSL_RESERVED_WORDS.has(name) || name.startsWith(WGSL_ESCAPE_PREFIX)) {
    return `${WGSL_ESCAPE_PREFIX}${name}`;
  }
  return name;
}

function isRegisterIdentifier(name: string) {
  return /^[qt]\d+$/u.test(name.toLowerCase());
}

function toWgslIdentifier(name: string) {
  const key = name.toLowerCase();
  return (
    MILKDROP_WGSL_SIGNAL_ALIAS_MAP.get(key) ??
    WGSL_IDENTIFIER_MAP.get(key) ??
    name.toLowerCase()
  );
}

function buildWgslExpression(expression: MilkdropExpressionNode): string {
  switch (expression.type) {
    case 'literal':
      return Number.isFinite(expression.value)
        ? expression.value.toString()
        : '0.0';

    case 'identifier': {
      const name = expression.name.toLowerCase();
      const mapped = WGSL_IDENTIFIER_MAP.get(name);
      if (mapped !== undefined) {
        return mapped;
      }
      if (name === 'rand') {
        return 'rand()';
      }
      if (isRegisterIdentifier(name)) {
        return `state.${escapeWgslFieldName(name)}`;
      }
      const signalField = MILKDROP_WGSL_SIGNAL_ALIAS_MAP.get(name);
      if (signalField !== undefined) {
        return `signals.${signalField}`;
      }
      return `state.${escapeWgslFieldName(toWgslIdentifier(expression.name))}`;
    }

    case 'unary': {
      const operand = buildWgslExpression(expression.operand);
      switch (expression.operator) {
        case '+':
          return operand;
        case '-':
          return `(-${operand})`;
        case '!':
          return `select(1.0f, 0.0f, abs(${operand}) > 0.000001f)`;
      }
      return '0.0f';
    }

    case 'binary': {
      const left = buildWgslExpression(expression.left);
      const right = buildWgslExpression(expression.right);
      switch (expression.operator) {
        case '+':
          return `(${left} + ${right})`;
        case '-':
          return `(${left} - ${right})`;
        case '*':
          return `(${left} * ${right})`;
        case '/':
          return `select(0.0f, (${left}) / (${right}), abs(${right}) > 0.000001f)`;
        case '%':
          return `milkdropIntMod(${left}, ${right})`;
        case '^':
          return `pow(max(0.0f, ${left}), ${right})`;
        case '|':
          return `f32(i32(${left}) | i32(${right}))`;
        case '&':
          return `f32(i32(${left}) & i32(${right}))`;
        case '<':
          return `select(0.0f, 1.0f, ${left} < ${right})`;
        case '<=':
          return `select(0.0f, 1.0f, ${left} <= ${right})`;
        case '>':
          return `select(0.0f, 1.0f, ${left} > ${right})`;
        case '>=':
          return `select(0.0f, 1.0f, ${left} >= ${right})`;
        case '==':
          return `select(0.0f, 1.0f, ${left} == ${right})`;
        case '!=':
          return `select(0.0f, 1.0f, ${left} != ${right})`;
        case '&&':
          return `select(0.0f, 1.0f, abs(${left}) > 0.000001f && abs(${right}) > 0.000001f)`;
        case '||':
          return `select(0.0f, 1.0f, abs(${left}) > 0.000001f || abs(${right}) > 0.000001f)`;
      }
      return '0.0f';
    }

    case 'call': {
      const args = expression.args.map(buildWgslExpression);
      const name = expression.name.toLowerCase();

      switch (name) {
        case 'sin':
          return `sin(${args[0] ?? '0.0f'})`;
        case 'cos':
          return `cos(${args[0] ?? '0.0f'})`;
        case 'tan':
          return `tan(${args[0] ?? '0.0f'})`;
        case 'asin':
          return `asin(clamp(${args[0] ?? '0.0f'}, -1.0f, 1.0f))`;
        case 'acos':
          return `acos(clamp(${args[0] ?? '0.0f'}, -1.0f, 1.0f))`;
        case 'atan':
          return `atan(${args[0] ?? '0.0f'})`;
        case 'abs':
          return `abs(${args[0] ?? '0.0f'})`;
        case 'sqrt':
          return `sqrt(max(0.0f, ${args[0] ?? '0.0f'}))`;
        case 'pow':
          return `pow(max(0.0f, ${args[0] ?? '0.0f'}), ${args[1] ?? '1.0f'})`;
        case 'mod':
        case 'fmod': {
          const a = args[0] ?? '0.0f';
          const b = args[1] ?? '1.0f';
          return `milkdropFmod(${a}, ${b})`;
        }
        case 'min':
          return args.length >= 2
            ? `min(${args[0]}, ${args[1]})`
            : (args[0] ?? '0.0f');
        case 'max':
          return args.length >= 2
            ? `max(${args[0]}, ${args[1]})`
            : (args[0] ?? '0.0f');
        case 'mix':
        case 'lerp':
          return `mix(${args[0] ?? '0.0f'}, ${args[1] ?? '0.0f'}, ${args[2] ?? '0.0f'})`;
        case 'floor':
          return `floor(${args[0] ?? '0.0f'})`;
        case 'int':
          return `sign(${args[0] ?? '0.0f'}) * floor(abs(${args[0] ?? '0.0f'}))`;
        case 'ceil':
          return `ceil(${args[0] ?? '0.0f'})`;
        case 'sqr': {
          const value = args[0] ?? '0.0f';
          return `(${value} * ${value})`;
        }
        case 'clamp':
          return `clamp(${args[0] ?? '0.0f'}, ${args[1] ?? '0.0f'}, ${args[2] ?? '1.0f'})`;
        case 'step':
          return `select(0.0f, 1.0f, ${args[1] ?? '0.0f'} >= ${args[0] ?? '0.0f'})`;
        case 'smoothstep': {
          const edge0 = args[0] ?? '0.0f';
          const edge1 = args[1] ?? '1.0f';
          const value = args[2] ?? '0.0f';
          return `smoothstep(${edge0}, ${edge1}, ${value})`;
        }
        case 'log':
          return `log(max(0.000001f, ${args[0] ?? '1.0f'}))`;
        case 'log10':
          return `(log(max(0.000001f, ${args[0] ?? '1.0f'})) * 0.4342944819f)`;
        case 'exp':
          return `exp(${args[0] ?? '0.0f'})`;
        case 'sigmoid': {
          const value = args[0] ?? '0.0f';
          const slope = args[1] ?? '1.0f';
          return `(1.0f / (1.0f + exp(-(${value}) * (${slope}))))`;
        }
        case 'sign':
          return `sign(${args[0] ?? '0.0f'})`;
        case 'bor':
          return `select(0.0f, 1.0f, abs(${args[0] ?? '0.0f'}) > 0.00001f || abs(${args[1] ?? '0.0f'}) > 0.00001f)`;
        case 'band':
          return `select(0.0f, 1.0f, abs(${args[0] ?? '0.0f'}) > 0.00001f && abs(${args[1] ?? '0.0f'}) > 0.00001f)`;
        case 'bnot':
          return `select(1.0f, 0.0f, abs(${args[0] ?? '0.0f'}) > 0.00001f)`;
        case 'atan2':
          return `atan2(${args[0] ?? '0.0f'}, ${args[1] ?? '0.0f'})`;
        case 'saturate':
          return `saturate(${args[0] ?? '0.0f'})`;
        case 'ddx':
          return `dpdx(${args[0] ?? '0.0f'})`;
        case 'ddy':
          return `dpdy(${args[0] ?? '0.0f'})`;
        case 'mul':
          return `(${args[0] ?? '0.0f'} * ${args[1] ?? '0.0f'})`;
        case 'frac': {
          const value = args[0] ?? '0.0f';
          return `(${value} - floor(${value}))`;
        }
        case 'if':
          return `select(f32(${args[2] ?? '0.0f'}), f32(${args[1] ?? '0.0f'}), abs(${args[0] ?? '0.0f'}) > 0.000001f)`;
        case 'above':
          return `select(0.0f, 1.0f, (${args[0] ?? '0.0f'}) > (${args[1] ?? '0.0f'}))`;
        case 'below':
          return `select(0.0f, 1.0f, (${args[0] ?? '0.0f'}) < (${args[1] ?? '0.0f'}))`;
        case 'equal':
          return `select(0.0f, 1.0f, (${args[0] ?? '0.0f'}) == (${args[1] ?? '0.0f'}))`;
        case 'megabuf':
        case 'gmegabuf':
          // Megabuffer programs are classified for CPU fallback. Returning a
          // scalar placeholder keeps diagnostic WGSL valid and prevents an
          // undeclared storage array from reaching pipeline creation.
          return '0.0f';
        case 'rand':
          return 'rand()';
        case 'randint':
          return `floor(rand() * max(0.0f, ${args[0] ?? '1.0f'}))`;
        case 'exec2':
        case 'exec3':
          return args[args.length - 1] ?? '0.0f';
        default:
          return '0.0f';
      }
    }
  }
}

const WGSL_SIGNAL_STRUCT = /* wgsl */ `
struct VmSignals {
${MILKDROP_WGSL_SIGNAL_FIELDS.map((field) => `  ${field}: f32,`).join('\n')}
}
`;

/**
 * EEL has two different modulo semantics and they are easy to conflate, so both
 * are spelled out here rather than inlined at each call site.
 *
 * The `%` *operator* truncates both operands to integers before dividing —
 * see toMilkdropInt in expression.ts and Math.trunc in expression-jit.ts. The
 * `mod()`/`fmod()` *functions* do not; they are float remainders that truncate
 * the quotient only. Emitting the float form for `%` diverged from the CPU for
 * any fractional operand (7.5 % 0.7 gave 0.5 on GPU against 0 on CPU).
 */
const WGSL_MOD_FNS = /* wgsl */ `
fn milkdropTruncInt(value: f32) -> i32 {
  // Non-finite collapses to 0, matching toMilkdropInt. Clamp before the i32
  // cast: out-of-range float-to-int conversion is undefined in WGSL.
  let finite = value == value && abs(value) < 3.402823e38f;
  let truncated = trunc(select(0.0f, value, finite));
  return i32(clamp(truncated, -2147483520.0f, 2147483520.0f));
}

fn milkdropIntMod(left: f32, right: f32) -> f32 {
  let l = milkdropTruncInt(left);
  let r = milkdropTruncInt(right);
  // select() evaluates both arms, so keep the divisor non-zero even when the
  // result is discarded — integer remainder by zero is undefined in WGSL.
  let safeRight = select(r, 1, r == 0);
  return select(f32(l % safeRight), 0.0f, r == 0);
}

fn milkdropFmod(left: f32, right: f32) -> f32 {
  // Float remainder with the quotient truncated toward zero, matching JS %.
  let quotient = left / right;
  let truncated = sign(quotient) * floor(abs(quotient));
  return select(left - right * truncated, 0.0f, abs(right) <= 0.000001f);
}
`;

const WGSL_RANDOM_FN = /* wgsl */ `
fn rand() -> f32 {
  var s = state.rand_state;
  if (s == 0u) {
    s = 2531011u;
  }
  s = s * 214013u + 2531011u;
  state.rand_state = s;
  return f32((s >> 16u) & 0x7FFFu) / 32767.0f;
}
`;

export type WgslProgramCompilation = {
  wgslCode: string;
  entryPoint: string;
  signature: string;
  usesRandom: boolean;
  usesMegabuf: boolean;
  usesGmegabuf: boolean;
  gpuExecutable: boolean;
  unsupportedFeatures: Array<'megabuf' | 'gmegabuf'>;
  fieldKeys: string[];
  registerKeys: string[];
};

function collectStatementFields(statements: MilkdropCompiledStatement[]): {
  fieldKeys: string[];
  registerKeys: string[];
  usesRandom: boolean;
  usesMegabuf: boolean;
  usesGmegabuf: boolean;
} {
  const fieldKeys = new Set<string>();
  const registerKeys = new Set<string>();
  let usesRandom = false;
  let usesMegabuf = false;
  let usesGmegabuf = false;

  const collectFromExpression = (expression: MilkdropExpressionNode) => {
    switch (expression.type) {
      case 'identifier': {
        const name = expression.name.toLowerCase();
        if (name === 'rand') {
          usesRandom = true;
          return;
        }
        if (WGSL_IDENTIFIER_MAP.has(name)) {
          return;
        }
        if (isRegisterIdentifier(name)) {
          registerKeys.add(name);
          fieldKeys.add(name);
        } else {
          fieldKeys.add(name);
        }
        return;
      }
      case 'unary':
        collectFromExpression(expression.operand);
        return;
      case 'binary':
        collectFromExpression(expression.left);
        collectFromExpression(expression.right);
        return;
      case 'call':
        if (
          expression.name.toLowerCase() === 'rand' ||
          expression.name.toLowerCase() === 'randint'
        ) {
          usesRandom = true;
        } else if (expression.name.toLowerCase() === 'megabuf') {
          usesMegabuf = true;
        } else if (expression.name.toLowerCase() === 'gmegabuf') {
          usesGmegabuf = true;
        }
        expression.args.forEach(collectFromExpression);
        return;
      case 'literal':
        return;
    }
  };

  const collectFromStatements = (stmts: MilkdropCompiledStatement[]) => {
    for (const statement of stmts) {
      collectFromExpression(statement.expression);
      const target = statement.target.toLowerCase();
      if (target.startsWith('megabuf')) {
        usesMegabuf = true;
      } else if (target.startsWith('gmegabuf')) {
        usesGmegabuf = true;
      } else if (isRegisterIdentifier(target)) {
        registerKeys.add(target);
        fieldKeys.add(target);
      } else {
        fieldKeys.add(target);
      }
      if (statement.control) {
        collectFromStatements(statement.control.body);
        if (statement.control.condition) {
          collectFromExpression(statement.control.condition);
        }
        if (statement.control.count) {
          collectFromExpression(statement.control.count);
        }
      }
    }
  };

  collectFromStatements(statements);

  return {
    fieldKeys: [...fieldKeys].sort(),
    registerKeys: [...registerKeys].sort(),
    usesRandom,
    usesMegabuf,
    usesGmegabuf,
  };
}

const DEFAULT_MILKDROP_STATE_FIELDS = new Set([
  'monitor_size_left',
  'monitor_size_right',
  'monitor_size_top',
  'monitor_size_bottom',
  'meshx',
  'meshy',
  'pixelsx',
  'pixelsy',
  'texsize',
  'render_target_texsize',
  'fps',
  'time',
  'frame',
  'bass',
  'mid',
  'mids',
  'treb',
  'treble',
  'bass_att',
  'mid_att',
  'mids_att',
  'treb_att',
  'treble_att',
  'bassAtt',
  'midAtt',
  'midsAtt',
  'trebleAtt',
  'beat',
  'beat_pulse',
  'beatPulse',
  'rms',
  'vol',
  'music',
  'weighted_energy',
  'progress',
  'bg_r',
  'bg_g',
  'bg_b',
  'decay',
  'gamma_adj',
  'video_echo_zoom',
  'video_echo_alpha',
  'video_echo_orientation',
  'texture_wrap',
  'darken_center',
  'blend_duration',
]);

function buildWgslStateField(fieldKey: string): string {
  if (fieldKey === 'rand_state') {
    return `  rand_state: u32,`;
  }
  return `  ${escapeWgslFieldName(fieldKey)}: f32,`;
}

function buildWgslProgram(
  statements: MilkdropCompiledStatement[],
  options: {
    fieldKeys: string[];
    registerKeys: string[];
    usesRandom: boolean;
  } = { fieldKeys: [], registerKeys: [], usesRandom: false },
): string {
  const { fieldKeys, usesRandom } = options;
  const seenFields = new Set<string>([...fieldKeys, 'pi', 'e']);

  if (usesRandom) {
    seenFields.add('rand_state');
  }
  for (const key of DEFAULT_MILKDROP_STATE_FIELDS) {
    seenFields.add(key);
  }

  const sortedFields = [...seenFields].sort();
  const stateStruct = [
    'struct VmState {',
    ...sortedFields.map(buildWgslStateField),
    '}',
  ].join('\n');

  const signalStruct = WGSL_SIGNAL_STRUCT;

  const randomFn = usesRandom ? WGSL_RANDOM_FN : '';

  const statementLines = statements.map((statement) => {
    const target = statement.target.toLowerCase();
    const expression = buildWgslExpression(statement.expression);
    // Registers and ordinary fields are both plain members of VmState, so they
    // are written the same way; the branch that used to distinguish them
    // returned identical strings.
    return `  state.${escapeWgslFieldName(target)} = ${expression};`;
  });

  const body = [
    `@group(0) @binding(0) var<storage, read_write> state: VmState;`,
    `@group(0) @binding(1) var<storage, read> signals: VmSignals;`,
    WGSL_MOD_FNS,
    randomFn,
    `@compute @workgroup_size(1)`,
    `fn main() {`,
    ...statementLines,
    `}`,
  ].join('\n');

  return `${stateStruct}\n\n${signalStruct}\n${body}`;
}

export function compileProgramToWgsl(
  block: MilkdropProgramBlock,
): WgslProgramCompilation {
  const { fieldKeys, registerKeys, usesRandom, usesMegabuf, usesGmegabuf } =
    collectStatementFields(block.statements);

  const sortedFields = [
    ...new Set([...fieldKeys, ...DEFAULT_MILKDROP_STATE_FIELDS]),
  ].sort();

  const allFields = usesRandom
    ? [...new Set([...sortedFields, 'rand_state'])].sort()
    : sortedFields;

  const allFieldKeysForStruct = allFields;
  const wgslCode = buildWgslProgram(block.statements, {
    fieldKeys: allFieldKeysForStruct,
    registerKeys,
    usesRandom,
  });

  // buildWgslProgram's VmState struct always includes 'pi' and 'e' in
  // addition to the requested fields, so the returned fieldKeys (which
  // sizes the GPU state buffer in vm-gpu.ts) must include them too. A
  // buffer sized from the narrower `fieldKeys` set can under-allocate
  // relative to the actual struct — down to a zero-byte buffer for
  // programs with no state fields — which WebGPU rejects when the
  // bind group is created.
  const structFieldKeys = [
    ...new Set([...allFieldKeysForStruct, 'pi', 'e']),
  ].sort();
  const unsupportedFeatures: Array<'megabuf' | 'gmegabuf'> = [];
  if (usesMegabuf) unsupportedFeatures.push('megabuf');
  if (usesGmegabuf) unsupportedFeatures.push('gmegabuf');

  return {
    wgslCode,
    entryPoint: 'main',
    signature: JSON.stringify({
      fieldKeys: allFieldKeysForStruct,
      registerKeys,
      usesRandom,
      usesMegabuf,
      usesGmegabuf,
      statements: block.statements.map((s) => ({
        target: s.target.toLowerCase(),
        source: s.source,
      })),
    }),
    usesRandom,
    usesMegabuf,
    usesGmegabuf,
    gpuExecutable: unsupportedFeatures.length === 0,
    unsupportedFeatures,
    fieldKeys: structFieldKeys,
    registerKeys,
  };
}

export function buildWgslExpressionString(expression: MilkdropExpressionNode) {
  return buildWgslExpression(expression);
}
