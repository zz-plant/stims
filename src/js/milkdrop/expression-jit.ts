import type {
  MilkdropCompiledStatement,
  MilkdropExpressionNode,
  MilkdropProgramBlock,
} from './common-types.ts';
import { aliasMap } from './field-normalization.ts';

/**
 * Per-preset scratch buffer, matching MilkDrop's `megabuf`.
 * Set to 1M to match butterchurn and improve compatibility with presets
 * using large ring buffers and history tables.
 */
export const MILKDROP_MEGABUF_SIZE = 1_048_576;

/**
 * Buffer shared across presets, matching MilkDrop's `gmegabuf`.
 */
export const MILKDROP_GMEGABUF_SIZE = 1_048_576;

/**
 * A compiled program block.
 *
 * Whole blocks are compiled into one function rather than one function per
 * statement: per-pixel and per-point programs run for every mesh vertex and
 * every waveform sample, so per-statement dispatch and the closures it needed
 * for buffer access dominated the VM's frame cost.
 *
 * Stores are resolved at compile time to mirror the VM's routing rules:
 * `q` registers always land in the register bank, every other target lands in
 * the caller's locals when a local scope is active, and otherwise in the
 * register bank (`t` registers) or preset state.
 */
export type MilkdropProgramFn = (
  env: Record<string, number>,
  state: Record<string, number>,
  registers: Record<string, number>,
  locals: Record<string, number> | null,
  megabuf: Float32Array,
  gmegabuf: Float32Array,
  nextRandom: () => number,
) => void;

const NO_OP: MilkdropProgramFn = () => {};

const REGISTER_PATTERN = /^([qt])(\d+)$/u;

type CompileContext = {
  temporaries: string[];
};

function nextTemporary(context: CompileContext) {
  const name = `_i${context.temporaries.length}`;
  context.temporaries.push(name);
  return name;
}

function compileBufferRead(
  node: MilkdropExpressionNode & { type: 'call' },
  context: CompileContext,
  buffer: 'mb' | 'gb',
  size: number,
) {
  const index = nextTemporary(context);
  const argument = node.args[0] ? compileNode(node.args[0], context) : '0';
  return `(${index} = Math.trunc(${argument}), (${index} >= 0 && ${index} < ${size} ? ${buffer}[${index}] : 0))`;
}

function compileNode(
  node: MilkdropExpressionNode,
  context: CompileContext,
): string {
  switch (node.type) {
    case 'literal':
      return String(node.value);
    case 'identifier': {
      const name = node.name.toLowerCase();
      if (name === 'pi') return 'Math.PI';
      if (name === 'e') return 'Math.E';
      const normalized = name.replace(/[^a-z0-9_]+/gu, '_');
      const aliased = aliasMap[normalized] || normalized;
      if (aliased !== node.name) {
        return `(e[${JSON.stringify(node.name)}] ?? e[${JSON.stringify(aliased)}] ?? 0)`;
      }
      return `(e[${JSON.stringify(node.name)}] ?? 0)`;
    }
    case 'unary': {
      const x = compileNode(node.operand, context);
      switch (node.operator) {
        case '+':
          return `(+(${x}))`;
        case '-':
          return `(-(${x}))`;
        case '!':
          return `(Math.abs(${x}) > 0.00001 ? 0 : 1)`;
      }
      return '(0)';
    }
    case 'binary': {
      const l = compileNode(node.left, context);
      const r = compileNode(node.right, context);
      switch (node.operator) {
        case '+':
          return `((${l}) + (${r}))`;
        case '-':
          return `((${l}) - (${r}))`;
        case '*':
          return `((${l}) * (${r}))`;
        case '/':
          return `(((${r}) === 0) ? 0 : (${l}) / (${r}))`;
        case '%':
          return `((function(a,b){var ai=Math.trunc(a)||0,bi=Math.trunc(b)||0;return bi===0?0:ai%bi})(${l},${r}))`;
        case '^':
          return `((function(a,b){var v=a**b;return Number.isFinite(v)?v:0})(${l},${r}))`;
        case '|':
          return `((Math.trunc(${l})||0) | (Math.trunc(${r})||0))`;
        case '&':
          return `((Math.trunc(${l})||0) & (Math.trunc(${r})||0))`;
        case '<':
          return `((${l}) < (${r}) ? 1 : 0)`;
        case '<=':
          return `((${l}) <= (${r}) ? 1 : 0)`;
        case '>':
          return `((${l}) > (${r}) ? 1 : 0)`;
        case '>=':
          return `((${l}) >= (${r}) ? 1 : 0)`;
        case '==':
          return `((${l}) === (${r}) ? 1 : 0)`;
        case '!=':
          return `((${l}) !== (${r}) ? 1 : 0)`;
        case '&&':
          return `((Math.abs(${l}) > 0.00001 && Math.abs(${r}) > 0.00001) ? 1 : 0)`;
        case '||':
          return `((Math.abs(${l}) > 0.00001 || Math.abs(${r}) > 0.00001) ? 1 : 0)`;
      }
      return '(0)';
    }
    case 'call': {
      const name = node.name.toLowerCase();
      if (name === 'megabuf') {
        return compileBufferRead(node, context, 'mb', MILKDROP_MEGABUF_SIZE);
      }
      if (name === 'gmegabuf') {
        return compileBufferRead(node, context, 'gb', MILKDROP_GMEGABUF_SIZE);
      }
      const args = node.args.map((arg) => compileNode(arg, context));
      switch (name) {
        case 'sin':
          return `Math.sin(${args[0] ?? '0'})`;
        case 'cos':
          return `Math.cos(${args[0] ?? '0'})`;
        case 'tan':
          return `Math.tan(${args[0] ?? '0'})`;
        case 'asin':
          return `Math.asin(Math.min(1, Math.max(-1, ${args[0] ?? '0'})))`;
        case 'acos':
          return `Math.acos(Math.min(1, Math.max(-1, ${args[0] ?? '0'})))`;
        case 'atan':
          return `Math.atan(${args[0] ?? '0'})`;
        case 'abs':
          return `Math.abs(${args[0] ?? '0'})`;
        case 'sqrt':
          return `Math.sqrt(Math.max(0, ${args[0] ?? '0'}))`;
        case 'pow':
          return `((function(a,b){var v=a**b;return Number.isFinite(v)?v:0})(${args[0] ?? '0'},${args[1] ?? '0'}))`;
        case 'mod':
        case 'fmod':
          return `((${args[1] ?? '0'}) === 0 ? 0 : (${args[0] ?? '0'}) % (${args[1] ?? '0'}))`;
        case 'min':
          return `Math.min(${args.join(',') || '0'})`;
        case 'max':
          return `Math.max(${args.join(',') || '0'})`;
        case 'mix':
        case 'lerp':
          return `((function(a,b,c){return a+(b-a)*c})(${args[0] ?? '0'},${args[1] ?? '0'},${args[2] ?? '0'}))`;
        case 'floor':
          return `Math.floor(${args[0] ?? '0'})`;
        case 'int':
          return `(Math.trunc(${args[0] ?? '0'})||0)`;
        case 'ceil':
          return `Math.ceil(${args[0] ?? '0'})`;
        case 'sqr':
          return `((function(v){return v*v})(${args[0] ?? '0'}))`;
        case 'clamp':
          return `((function(v,lo,hi){return Math.min(Math.max(v,lo),hi)})(${args[0] ?? '0'},${args[1] ?? '0'},${args[2] ?? '1'}))`;
        case 'step':
          return `((${args[1] ?? '0'}) < (${args[0] ?? '0'}) ? 0 : 1)`;
        case 'smoothstep':
          return `((function(e0,e1,v){if(e0===e1)return v<e0?0:1;var t=Math.min(Math.max((v-e0)/(e1-e0),0),1);return t*t*(3-2*t)})(${args[0] ?? '0'},${args[1] ?? '1'},${args[2] ?? '0'}))`;
        case 'log':
          return `Math.log(Math.max(0, ${args[0] ?? '0'}))`;
        case 'log10':
          return `Math.log10(Math.max(0, ${args[0] ?? '0'}))`;
        case 'exp':
          return `Math.exp(${args[0] ?? '0'})`;
        case 'sigmoid':
          return `(1 / (1 + Math.exp(-(${args[0] ?? '0'}) * (${args[1] ?? '1'}))))`;
        case 'sign':
          return `(Math.sign(${args[0] ?? '0'})||0)`;
        case 'bor':
          return `((Math.abs(${args[0] ?? '0'}) > 0.00001 || Math.abs(${args[1] ?? '0'}) > 0.00001) ? 1 : 0)`;
        case 'band':
          return `((Math.abs(${args[0] ?? '0'}) > 0.00001 && Math.abs(${args[1] ?? '0'}) > 0.00001) ? 1 : 0)`;
        case 'bnot':
          return `(Math.abs(${args[0] ?? '0'}) > 0.00001 ? 0 : 1)`;
        case 'atan2':
          return `Math.atan2(${args[0] ?? '0'}, ${args[1] ?? '0'})`;
        case 'frac':
          return `((${args[0] ?? '0'}) - Math.floor(${args[0] ?? '0'}))`;
        case 'if':
          return `(Math.abs(${args[0] ?? '0'}) > 0.00001 ? (${args[1] ?? '0'}) : (${args[2] ?? '0'}))`;
        case 'above':
          return `((${args[0] ?? '0'}) > (${args[1] ?? '0'}) ? 1 : 0)`;
        case 'below':
          return `((${args[0] ?? '0'}) < (${args[1] ?? '0'}) ? 1 : 0)`;
        case 'equal':
          return `(Math.abs((${args[0] ?? '0'}) - (${args[1] ?? '0'})) <= 0.00001 ? 1 : 0)`;
        case 'rand':
          return `(rnd() * (${args[0] ?? '1'}))`;
        case 'randint':
          return `Math.floor(rnd() * (${args[0] ?? '1'}))`;
        case 'exec2':
        case 'exec3':
          return args.length > 0
            ? `(${args.map((arg) => `(${arg})`).join(', ')})`
            : '(0)';
      }
      return '(0)';
    }
  }
}

function compileStore(
  statement: MilkdropCompiledStatement,
  context: CompileContext,
) {
  const target = statement.target;

  if (target === 'megabuf' || target === 'gmegabuf') {
    const buffer = target === 'megabuf' ? 'mb' : 'gb';
    const size =
      target === 'megabuf' ? MILKDROP_MEGABUF_SIZE : MILKDROP_GMEGABUF_SIZE;
    const index = nextTemporary(context);
    const indexSource = statement.targetExpression
      ? compileNode(statement.targetExpression, context)
      : '0';
    return `${index} = Math.trunc(${indexSource}); if (${index} >= 0 && ${index} < ${size}) { ${buffer}[${index}] = _v; }`;
  }

  const rawKey = JSON.stringify(target);
  const normalized = target.toLowerCase();
  const registerMatch = normalized.match(REGISTER_PATTERN);

  if (registerMatch?.[1] === 'q') {
    return `r[${JSON.stringify(normalized)}] = _v;`;
  }
  if (registerMatch) {
    return `if (l !== null) { l[${rawKey}] = _v; } else { r[${JSON.stringify(normalized)}] = _v; }`;
  }
  return `if (l !== null) { l[${rawKey}] = _v; } else { s[${rawKey}] = _v; }`;
}

const MILKDROP_LOOP_ITERATION_CAP = 2_097_152;

/** True when a block contains any `loop`/`while` control statement. Any nested
 * loop is reachable only through an outer control statement, so a top-level
 * scan is sufficient and the guard counter is only declared when needed. */
function blockUsesControlFlow(block: MilkdropProgramBlock): boolean {
  return block.statements.some((statement) => Boolean(statement.control));
}

function compileStatementSource(
  statement: MilkdropCompiledStatement,
  context: CompileContext,
  body: string[],
) {
  if (statement.control) {
    const { kind, body: innerBody } = statement.control;

    if (kind === 'loop') {
      const count = statement.control.count
        ? compileNode(statement.control.count, context)
        : `${MILKDROP_LOOP_ITERATION_CAP}`;
      const countVar = nextTemporary(context);
      const indexVar = nextTemporary(context);
      body.push(
        `${countVar} = Math.min(${MILKDROP_LOOP_ITERATION_CAP}, Math.max(0, Math.trunc(${count}) || 0));`,
      );
      body.push(
        `for (${indexVar} = 0; ${indexVar} < ${countVar} && _g < ${MILKDROP_LOOP_ITERATION_CAP}; ${indexVar} += 1, _g += 1) {`,
      );
    } else {
      const cond = statement.control.condition
        ? compileNode(statement.control.condition, context)
        : '1';
      body.push(
        `while ((${cond}) !== 0 && _g < ${MILKDROP_LOOP_ITERATION_CAP}) { _g += 1;`,
      );
    }

    for (const inner of innerBody) {
      compileStatementSource(inner, context, body);
    }
    body.push('}');
    return;
  }

  // The value is evaluated before the target index, matching the order the
  // interpreter used. Non-finite results (e.g. pow(-1, 0.5), ^ with a
  // fractional exponent on a negative base) are clamped to 0 here, matching
  // MilkDrop's own behavior of never letting NaN/Infinity escape an
  // expression — state persists across frames, so an unclamped NaN would
  // otherwise poison that variable for the rest of the preset's lifetime.
  body.push(`_v = ${compileNode(statement.expression, context)};`);
  body.push('if (!Number.isFinite(_v)) { _v = 0; }');
  body.push(compileStore(statement, context));
  body.push(`e[${JSON.stringify(statement.target)}] = _v;`);
}

function compileProgramSource(block: MilkdropProgramBlock) {
  const context: CompileContext = { temporaries: [] };
  const body: string[] = [];

  for (const statement of block.statements) {
    if (!statement) {
      continue;
    }
    compileStatementSource(statement, context, body);
  }

  const declarations = ['_v', ...context.temporaries];
  if (blockUsesControlFlow(block)) {
    declarations.push('_g = 0');
  }
  return `"use strict"; var ${declarations.join(', ')}; ${body.join('\n')}`;
}

const compiledPrograms = new WeakMap<MilkdropProgramBlock, MilkdropProgramFn>();

/**
 * Compiles a program block into a single callable, memoised per block.
 */
export function compileMilkdropProgram(
  block: MilkdropProgramBlock,
): MilkdropProgramFn {
  const cached = compiledPrograms.get(block);
  if (cached) {
    return cached;
  }

  const compiled =
    block.statements.length === 0
      ? NO_OP
      : (new Function(
          'e',
          's',
          'r',
          'l',
          'mb',
          'gb',
          'rnd',
          compileProgramSource(block),
        ) as MilkdropProgramFn);

  compiledPrograms.set(block, compiled);
  return compiled;
}
