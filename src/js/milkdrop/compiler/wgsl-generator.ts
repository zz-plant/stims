/**
 * Lowers compiled EEL2 program blocks to WGSL compute shaders.
 *
 * The counterpart to `expression-jit.ts`: where the JIT emits JavaScript for
 * the CPU tier, this emits WGSL for the GPU tier that `vm-gpu.ts` dispatches,
 * including the `megabuf`/`gmegabuf` scratch bindings presets expect.
 *
 * The hard part is not translation but agreement. WGSL is stricter than
 * JavaScript about types, and its floating-point behavior differs in exactly
 * the places EEL2 is loosest — integer coercion, division by zero, and
 * evaluation order. Every construct emitted here must reproduce what the
 * interpreter in `expression.ts` produces, or the two tiers silently disagree.
 * `bun run lab:replay --tier gpu` is how that gets checked.
 */
import {
  MILKDROP_GMEGABUF_SIZE,
  MILKDROP_MEGABUF_SIZE,
} from '../expression-jit.ts';
import type {
  MilkdropCompiledStatement,
  MilkdropExpressionNode,
  MilkdropProgramBlock,
} from '../types';
import {
  MILKDROP_WGSL_SIGNAL_ALIAS_MAP,
  MILKDROP_WGSL_SIGNAL_FIELDS,
} from '../wgsl-signal-layout.ts';
import {
  EEL_BINARY_OPERATORS,
  EEL_UNARY_OPERATORS,
  emitEelCallWgslVm,
} from './eel-function-table.ts';
import { MILKDROP_EEL_WGSL_SCALAR_HELPERS_SOURCE } from './wgsl-eel-helpers.ts';

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

const NO_OVERWRITTEN_CONSTANTS: ReadonlySet<string> = new Set();

function buildWgslExpression(
  expression: MilkdropExpressionNode,
  overwrittenConstants: ReadonlySet<string> = NO_OVERWRITTEN_CONSTANTS,
): string {
  switch (expression.type) {
    case 'literal':
      return Number.isFinite(expression.value)
        ? expression.value.toString()
        : '0.0';

    case 'identifier': {
      const name = expression.name.toLowerCase();
      const mapped = WGSL_IDENTIFIER_MAP.get(name);
      if (mapped !== undefined) {
        // pi/e are ordinary prepopulated EEL variables; a program that
        // assigns one reads it back from state (the CPU tiers and the field
        // planner's isOverwritableConstant model the same thing). The inline
        // constant is only for programs that never write it.
        if (overwrittenConstants.has(name)) {
          return `state.${escapeWgslFieldName(name)}`;
        }
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
        // Signal-named identifiers (vol, bass, ...) are read-write on every
        // CPU tier: the per-statement env mirror (`e[target] = _v`) makes a
        // program's own assignment to e.g. `vol` visible to every read that
        // follows it in program order, shadowing the raw audio signal for
        // the rest of the frame. `vol = (bass+mid+treb)/1.5; vol_ = ...vol`
        // is a stock MilkDrop idiom (martin-the-bridge-of-khazad-dum) that
        // depends on this — without it the GPU tier silently reads stale
        // audio instead of the computed value.
        if (overwrittenConstants.has(name)) {
          return `state.${escapeWgslFieldName(name)}`;
        }
        return `signals.${signalField}`;
      }
      return `state.${escapeWgslFieldName(toWgslIdentifier(expression.name))}`;
    }

    case 'unary': {
      const operand = buildWgslExpression(
        expression.operand,
        overwrittenConstants,
      );
      return (
        EEL_UNARY_OPERATORS[expression.operator]?.wgslVm?.(operand) ?? '0.0f'
      );
    }

    case 'binary': {
      const left = buildWgslExpression(expression.left, overwrittenConstants);
      const right = buildWgslExpression(expression.right, overwrittenConstants);
      return (
        EEL_BINARY_OPERATORS[expression.operator]?.wgslVm?.(left, right) ??
        '0.0f'
      );
    }

    case 'call': {
      const args = expression.args.map((argument) =>
        buildWgslExpression(argument, overwrittenConstants),
      );
      const name = expression.name.toLowerCase();

      return emitEelCallWgslVm(name, args) ?? '0.0f';
    }
  }
}

const WGSL_SIGNAL_STRUCT = /* wgsl */ `
struct VmSignals {
${MILKDROP_WGSL_SIGNAL_FIELDS.map((field) => `  ${field}: f32,`).join('\n')}
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
  /** True when the program assigns into the buffer (statement target form).
   * Read-only programs skip the post-dispatch guest-memory readback. */
  writesMegabuf: boolean;
  writesGmegabuf: boolean;
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
  writesMegabuf: boolean;
  writesGmegabuf: boolean;
} {
  const fieldKeys = new Set<string>();
  const registerKeys = new Set<string>();
  let usesRandom = false;
  let usesMegabuf = false;
  let usesGmegabuf = false;
  let writesMegabuf = false;
  let writesGmegabuf = false;

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
      // Buffer-store targets carry the index in targetExpression — the
      // identifiers it reads must reach the state struct too.
      if (statement.targetExpression) {
        collectFromExpression(statement.targetExpression);
      }
      const target = statement.target.toLowerCase();
      // Exact names only: the statement parser normalizes buffer stores to
      // target 'megabuf'/'gmegabuf' + targetExpression; a preset variable
      // that merely starts with the prefix is an ordinary state field.
      if (target === 'gmegabuf') {
        usesGmegabuf = true;
        writesGmegabuf = true;
      } else if (target === 'megabuf') {
        usesMegabuf = true;
        writesMegabuf = true;
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
    writesMegabuf,
    writesGmegabuf,
  };
}

/** Guest-memory access helpers (docs/architecture/eel-guest-memory.md).
 * Emitted here rather than in wgsl-eel-helpers.ts because they reference the
 * module-scope storage arrays, which only this emitter declares. The index
 * guard mirrors the CPU JIT exactly: a NaN/Inf index must MISS the bounds
 * check (Math.trunc(NaN) is NaN and fails `>= 0`), whereas milkdropTruncInt
 * alone would collapse NaN onto slot 0. */
function buildGuestBufferWgsl(
  fnSuffix: 'Megabuf' | 'Gmegabuf',
  varName: string,
  sizeFloats: number,
): string {
  return /* wgsl */ `
fn milkdrop${fnSuffix}Read(index: f32) -> f32 {
  let finiteIndex = index == index && abs(index) < 3.402823e38;
  let i = milkdropTruncInt(index);
  if (finiteIndex && i >= 0 && i < ${sizeFloats}) {
    return ${varName}[u32(i)];
  }
  return 0.0f;
}
fn milkdrop${fnSuffix}Write(index: f32, value: f32) {
  let finiteIndex = index == index && abs(index) < 3.402823e38;
  let i = milkdropTruncInt(index);
  if (finiteIndex && i >= 0 && i < ${sizeFloats}) {
    ${varName}[u32(i)] = milkdropFinite(value);
  }
}
`;
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
    usesMegabuf?: boolean;
    usesGmegabuf?: boolean;
    enableF16?: boolean;
    enableSubgroups?: boolean;
  } = { fieldKeys: [], registerKeys: [], usesRandom: false },
): string {
  const { fieldKeys, usesRandom, usesMegabuf, usesGmegabuf } = options;
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

  // Grows in program order, not precomputed over the whole block: a read of
  // `vol` before its first assignment this frame must still see the raw
  // signal (matching the CPU env, which has no own `vol` property until the
  // assignment statement runs); only reads AFTER an assignment switch to
  // state. Self-referencing statements (`vol_ = vol_ * k + ...`) must not
  // see their own target added yet while compiling their own RHS, so the
  // target is added only after that statement's expression is built.
  const overwrittenConstants = new Set<string>();

  const statementLines = statements.map((statement) => {
    const target = statement.target.toLowerCase();
    const expression = buildWgslExpression(
      statement.expression,
      overwrittenConstants,
    );
    if (
      WGSL_IDENTIFIER_MAP.has(target) ||
      MILKDROP_WGSL_SIGNAL_ALIAS_MAP.has(target)
    ) {
      overwrittenConstants.add(target);
    }
    // Guest-memory stores route through the buffer helpers (which own the
    // index guard and the value finite-clamp).
    if (target === 'gmegabuf' || target === 'megabuf') {
      const index = statement.targetExpression
        ? buildWgslExpression(statement.targetExpression, overwrittenConstants)
        : '0.0f';
      const fnSuffix = target === 'gmegabuf' ? 'Gmegabuf' : 'Megabuf';
      return `  milkdrop${fnSuffix}Write(${index}, ${expression});`;
    }
    // Registers and ordinary fields are both plain members of VmState, so they
    // are written the same way; the branch that used to distinguish them
    // returned identical strings.
    // milkdropFinite mirrors the per-statement store clamp both CPU tiers
    // apply (the JIT's `_v = ...; Number.isFinite(_v) ? _v : 0`): a NaN/Inf
    // intermediate must not persist into VM state.
    return `  state.${escapeWgslFieldName(target)} = milkdropFinite(${expression});`;
  });

  const body = [
    `@group(0) @binding(0) var<storage, read_write> state: VmState;`,
    `@group(0) @binding(1) var<storage, read> signals: VmSignals;`,
    ...(usesMegabuf
      ? [
          `@group(0) @binding(2) var<storage, read_write> megabuf: array<f32, ${MILKDROP_MEGABUF_SIZE}>;`,
        ]
      : []),
    ...(usesGmegabuf
      ? [
          `@group(0) @binding(3) var<storage, read_write> gmegabuf: array<f32, ${MILKDROP_GMEGABUF_SIZE}>;`,
        ]
      : []),
    MILKDROP_EEL_WGSL_SCALAR_HELPERS_SOURCE,
    ...(usesMegabuf
      ? [buildGuestBufferWgsl('Megabuf', 'megabuf', MILKDROP_MEGABUF_SIZE)]
      : []),
    ...(usesGmegabuf
      ? [buildGuestBufferWgsl('Gmegabuf', 'gmegabuf', MILKDROP_GMEGABUF_SIZE)]
      : []),
    randomFn,
    `@compute @workgroup_size(1)`,
    `fn main() {`,
    ...statementLines,
    `}`,
  ].join('\n');

  const extensions: string[] = [];
  if (options.enableF16) extensions.push('enable f16;');
  if (options.enableSubgroups) extensions.push('enable subgroups;');
  const extensionHeader =
    extensions.length > 0 ? `${extensions.join('\n')}\n\n` : '';

  return `${extensionHeader}${stateStruct}\n\n${signalStruct}\n${body}`;
}

export function compileProgramToWgsl(
  block: MilkdropProgramBlock,
  options?: { enableF16?: boolean; enableSubgroups?: boolean },
): WgslProgramCompilation {
  const {
    fieldKeys,
    registerKeys,
    usesRandom,
    usesMegabuf,
    usesGmegabuf,
    writesMegabuf,
    writesGmegabuf,
  } = collectStatementFields(block.statements);

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
    usesMegabuf,
    usesGmegabuf,
    enableF16: options?.enableF16,
    enableSubgroups: options?.enableSubgroups,
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
  // Guest-memory programs execute on the GPU via storage-buffer bindings
  // (docs/architecture/eel-guest-memory.md); nothing is classified for CPU
  // fallback anymore. The field stays so harnesses keep a stable shape.
  const unsupportedFeatures: Array<'megabuf' | 'gmegabuf'> = [];

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
    writesMegabuf,
    writesGmegabuf,
    gpuExecutable: true,
    unsupportedFeatures,
    fieldKeys: structFieldKeys,
    registerKeys,
  };
}

export function buildWgslExpressionString(
  expression: MilkdropExpressionNode,
  overwrittenConstants: ReadonlySet<string> = NO_OVERWRITTEN_CONSTANTS,
) {
  return buildWgslExpression(expression, overwrittenConstants);
}
