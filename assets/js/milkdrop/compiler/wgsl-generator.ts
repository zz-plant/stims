import type {
  MilkdropCompiledStatement,
  MilkdropExpressionNode,
  MilkdropProgramBlock,
} from '../types';

const WGSL_IDENTIFIER_MAP = new Map<string, string>([
  ['pi', '3.141592653589793'],
  ['e', '2.718281828459045'],
]);

function isRegisterIdentifier(name: string) {
  return /^[qt]\d+$/u.test(name.toLowerCase());
}

function toWgslIdentifier(name: string) {
  const key = name.toLowerCase();
  return WGSL_IDENTIFIER_MAP.get(key) ?? name.toLowerCase();
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
      return `state.${toWgslIdentifier(expression.name)}`;
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
          return `select(0.0f, f32(i32(${left}) % i32(${right})), abs(${right}) > 0.000001f)`;
        case '^':
          return `pow(${left}, ${right})`;
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
          return `pow(${args[0] ?? '0.0f'}, ${args[1] ?? '1.0f'})`;
        case 'mod':
        case 'fmod':
          return `select(0.0f, (${args[0] ?? '0.0f'}) % (${args[1] ?? '1.0f'}), abs(${args[1] ?? '1.0f'}) > 0.000001f)`;
        case 'min':
          return args.length > 0 ? `min(${args.join(', ')})` : '0.0f';
        case 'max':
          return args.length > 0 ? `max(${args.join(', ')})` : '0.0f';
        case 'mix':
        case 'lerp':
          return `mix(${args[0] ?? '0.0f'}, ${args[1] ?? '0.0f'}, ${args[2] ?? '0.0f'})`;
        case 'floor':
          return `floor(${args[0] ?? '0.0f'})`;
        case 'int':
          return `floor(${args[0] ?? '0.0f'})`;
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
          return `f32(i32(${args[0] ?? '0.0f'}) | i32(${args[1] ?? '0.0f'}))`;
        case 'band':
          return `f32(i32(${args[0] ?? '0.0f'}) & i32(${args[1] ?? '0.0f'}))`;
        case 'bnot':
          return `f32(~i32(${args[0] ?? '0.0f'}))`;
        case 'atan2':
          return `atan2(${args[0] ?? '0.0f'}, ${args[1] ?? '0.0f'})`;
        case 'frac': {
          const value = args[0] ?? '0.0f';
          return `(${value} - floor(${value}))`;
        }
        case 'if':
          return `select(${args[2] ?? '0.0f'}, ${args[1] ?? '0.0f'}, abs(${args[0] ?? '0.0f'}) > 0.000001f)`;
        case 'above':
          return `select(0.0f, 1.0f, (${args[0] ?? '0.0f'}) > (${args[1] ?? '0.0f'}))`;
        case 'below':
          return `select(0.0f, 1.0f, (${args[0] ?? '0.0f'}) < (${args[1] ?? '0.0f'}))`;
        case 'equal':
          return `select(0.0f, 1.0f, (${args[0] ?? '0.0f'}) == (${args[1] ?? '0.0f'}))`;
        case 'rand':
          return 'rand()';
        default:
          return '0.0f';
      }
    }
  }
}

const WGSL_SIGNAL_STRUCT = /* wgsl */ `
struct VmSignals {
  time: f32,
  frame: f32,
  fps: f32,
  bass: f32,
  mid: f32,
  mids: f32,
  treb: f32,
  treble: f32,
  bass_att: f32,
  mid_att: f32,
  mids_att: f32,
  treb_att: f32,
  treble_att: f32,
  bassAtt: f32,
  midAtt: f32,
  midsAtt: f32,
  trebleAtt: f32,
  beat: f32,
  beat_pulse: f32,
  beatPulse: f32,
  rms: f32,
  vol: f32,
  music: f32,
  weighted_energy: f32,
  progress: f32,
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
  fieldKeys: string[];
  registerKeys: string[];
};

function collectStatementFields(statements: MilkdropCompiledStatement[]): {
  fieldKeys: string[];
  registerKeys: string[];
  usesRandom: boolean;
} {
  const fieldKeys = new Set<string>();
  const registerKeys = new Set<string>();
  let usesRandom = false;

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
        expression.args.forEach(collectFromExpression);
        return;
      case 'literal':
        return;
    }
  };

  for (const statement of statements) {
    collectFromExpression(statement.expression);
    const target = statement.target.toLowerCase();
    if (isRegisterIdentifier(target)) {
      registerKeys.add(target);
    } else {
      fieldKeys.add(target);
    }
  }

  return {
    fieldKeys: [...fieldKeys].sort(),
    registerKeys: [...registerKeys].sort(),
    usesRandom,
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
  return `  ${fieldKey}: f32,`;
}

function buildWgslProgram(
  statements: MilkdropCompiledStatement[],
  options: {
    fieldKeys: string[];
    registerKeys: string[];
    usesRandom: boolean;
  } = { fieldKeys: [], registerKeys: [], usesRandom: false },
): string {
  const { fieldKeys, registerKeys, usesRandom } = options;
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
    if (isRegisterIdentifier(target)) {
      return `  reg_${target} = ${expression};`;
    }
    return `  state.${target} = ${expression};`;
  });

  const registerDeclarations = registerKeys
    .map((key) => `  var<private> reg_${key}: f32 = 0.0;`)
    .join('\n');

  const body = [
    `@group(0) @binding(0) var<storage, read_write> state: VmState;`,
    `@group(0) @binding(1) var<storage, read> signals: VmSignals;`,
    randomFn,
    `@compute @workgroup_size(1)`,
    `fn main() {`,
    ...registerDeclarations,
    ...statementLines,
    `}`,
  ].join('\n');

  return `${stateStruct}\n\n${signalStruct}\n${body}`;
}

export function compileProgramToWgsl(
  block: MilkdropProgramBlock,
): WgslProgramCompilation {
  const { fieldKeys, registerKeys, usesRandom } = collectStatementFields(
    block.statements,
  );

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

  return {
    wgslCode,
    entryPoint: 'main',
    signature: JSON.stringify({
      fieldKeys: allFieldKeysForStruct,
      registerKeys,
      usesRandom,
      statements: block.statements.map((s) => ({
        target: s.target.toLowerCase(),
        source: s.source,
      })),
    }),
    usesRandom,
    fieldKeys: fieldKeys,
    registerKeys,
  };
}

export function buildWgslExpressionString(expression: MilkdropExpressionNode) {
  return buildWgslExpression(expression);
}
