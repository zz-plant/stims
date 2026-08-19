import type {
  MilkdropCompiledStatement,
  MilkdropExpressionNode,
  MilkdropProgramBlock,
} from './common-types.ts';
import {
  EEL_BINARY_OPERATORS,
  EEL_UNARY_OPERATORS,
  emitEelCallJs,
} from './compiler/eel-function-table.ts';
import { evaluateMilkdropExpression } from './expression.ts';
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
      // Env-first like the interpreter: pi/e are ordinary prepopulated EEL
      // variables and preset assignments to them must stick (see
      // expression.ts identifier resolution for the rationale).
      if (name === 'pi') return '(e["pi"] ?? Math.PI)';
      if (name === 'e') return '(e["e"] ?? Math.E)';
      const normalized = name.replace(/[^a-z0-9_]+/gu, '_');
      const aliased = aliasMap[normalized] || normalized;
      if (aliased !== node.name) {
        return `(e[${JSON.stringify(node.name)}] ?? e[${JSON.stringify(aliased)}] ?? 0)`;
      }
      return `(e[${JSON.stringify(node.name)}] ?? 0)`;
    }
    case 'unary': {
      const x = compileNode(node.operand, context);
      return EEL_UNARY_OPERATORS[node.operator]?.jit?.(x) ?? '(0)';
    }
    case 'binary': {
      if (node.operator !== '=') {
        const l = compileNode(node.left, context);
        const r = compileNode(node.right, context);
        return (
          EEL_BINARY_OPERATORS[node.operator]?.jit?.(l, r, {
            temp: () => nextTemporary(context),
          }) ?? '(0)'
        );
      }
      const r = compileNode(node.right, context);
      {
        // Assignment nested inside an expression: lvalue = rvalue, and the
        // expression's value is the (finite-clamped) rvalue. This used to
        // splice the statement-form store (`if (...) { ... }`, trailing
        // semicolons, writes through the statement-level `_v`) into a comma
        // expression — a SyntaxError for register/local/megabuf targets, a
        // stale-`_v` write for the rest, and it never mirrored the value
        // into `e`, which is where every identifier read resolves. All
        // three fixed by emitting a pure expression store against a fresh
        // temporary, matching the statement path's semantics (including
        // MilkDrop's never-let-NaN-escape clamp).
        const rvalue = r;
        const tempVar = nextTemporary(context);
        const clamped = `${tempVar} = (${rvalue}), ${tempVar} = Number.isFinite(${tempVar}) ? ${tempVar} : 0`;
        if (node.left.type === 'identifier') {
          const store = compileStoreExpression(node.left.name, tempVar);
          return `(${clamped}, ${store}, ${tempVar})`;
        }
        if (
          node.left.type === 'call' &&
          (node.left.name.toLowerCase() === 'megabuf' ||
            node.left.name.toLowerCase() === 'gmegabuf')
        ) {
          const buffer = node.left.name.toLowerCase();
          const size =
            buffer === 'megabuf'
              ? MILKDROP_MEGABUF_SIZE
              : MILKDROP_GMEGABUF_SIZE;
          const index = nextTemporary(context);
          const indexSource = node.left.args[0]
            ? compileNode(node.left.args[0], context)
            : '0';
          const bufferName = buffer === 'megabuf' ? 'mb' : 'gb';
          return `(${clamped}, ${index} = Math.trunc(${indexSource}), (${index} >= 0 && ${index} < ${size} ? ${bufferName}[${index}] = ${tempVar} : 0), ${tempVar})`;
        }
        // Invalid assignment target, just return rvalue
        return `(${rvalue})`;
      }
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
      return (
        emitEelCallJs(name, args, { temp: () => nextTemporary(context) }) ??
        '(0)'
      );
    }
  }
}

/**
 * Expression-position twin of {@link compileStore} + the statement path's
 * `e` mirror: a single comma-safe expression that stores `valueVar` into the
 * engine-facing map (locals/registers/state) and into `e`, where identifier
 * reads resolve. Must stay semantically aligned with compileStore and
 * compileStatementSource.
 */
function compileStoreExpression(target: string, valueVar: string) {
  const rawKey = JSON.stringify(target);
  const normalized = target.toLowerCase();
  const registerMatch = normalized.match(REGISTER_PATTERN);
  const normalizedKey = JSON.stringify(normalized);

  const mirror =
    registerMatch?.[1] === 'q'
      ? `r[${normalizedKey}] = ${valueVar}`
      : registerMatch
        ? `(l !== null ? l[${rawKey}] = ${valueVar} : r[${normalizedKey}] = ${valueVar})`
        : `(l !== null ? l[${rawKey}] = ${valueVar} : s[${rawKey}] = ${valueVar})`;
  return `${mirror}, e[${rawKey}] = ${valueVar}`;
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
 * Whether `new Function` codegen is permitted. A strict Content-Security-
 * Policy without 'unsafe-eval' (extensions, embedded iframes, some
 * enterprise deployments) makes it throw — probed once, and the whole VM
 * then runs on the interpreter-backed fallback below instead of dying.
 */
let jitAvailable: boolean | null = null;

function isJitAvailable(): boolean {
  if (jitAvailable === null) {
    try {
      new Function('');
      jitAvailable = true;
    } catch {
      jitAvailable = false;
    }
  }
  return jitAvailable;
}

/** Test seam: force (or reset with null) the CSP probe result. */
export function __setJitAvailableForTests(value: boolean | null): void {
  jitAvailable = value;
}

/**
 * Interpreter-backed MilkdropProgramFn with the JIT's exact store contract:
 * per-statement finite clamp, q registers mirrored into the register bank,
 * other targets mirrored into locals (when active) or state, megabuf
 * bounds-checked writes, and the same loop/while iteration caps. Nested
 * assignments inside expressions reach the mirrors through the env proxy —
 * the interpreter writes them to the env, and the proxy fans them out the
 * way compileStoreExpression's generated code does.
 *
 * Slower than the JIT by design; it exists so CSP environments degrade to
 * correct-but-slower instead of broken. Parity with the JIT is pinned by
 * tests/unit/eel-csp-fallback.test.ts.
 */
function buildInterpretedProgram(
  block: MilkdropProgramBlock,
): MilkdropProgramFn {
  return (e, s, r, l, mb, gb, rnd) => {
    const mirroredEnv = new Proxy(e, {
      set(target, property, value) {
        if (typeof property === 'string') {
          const normalized = property.toLowerCase();
          const registerMatch = normalized.match(REGISTER_PATTERN);
          if (registerMatch?.[1] === 'q') {
            r[normalized] = value as number;
          } else if (registerMatch) {
            if (l !== null) l[property] = value as number;
            else r[normalized] = value as number;
          } else if (l !== null) {
            l[property] = value as number;
          } else {
            s[property] = value as number;
          }
        }
        target[property as string] = value as number;
        return true;
      },
    });
    const helpers = {
      nextRandom: rnd,
      megabuf: (index: number) =>
        index >= 0 && index < MILKDROP_MEGABUF_SIZE ? (mb[index] as number) : 0,
      gmegabuf: (index: number) =>
        index >= 0 && index < MILKDROP_GMEGABUF_SIZE
          ? (gb[index] as number)
          : 0,
      megabufWrite: (index: number, value: number) => {
        if (index >= 0 && index < MILKDROP_MEGABUF_SIZE) mb[index] = value;
      },
      gmegabufWrite: (index: number, value: number) => {
        if (index >= 0 && index < MILKDROP_GMEGABUF_SIZE) gb[index] = value;
      },
    };
    let guard = 0;
    const run = (statements: readonly MilkdropCompiledStatement[]) => {
      for (const statement of statements) {
        if (!statement) continue;
        if (statement.control) {
          const { kind, body } = statement.control;
          if (kind === 'loop') {
            const rawCount = statement.control.count
              ? evaluateMilkdropExpression(
                  statement.control.count,
                  mirroredEnv,
                  helpers,
                )
              : MILKDROP_LOOP_ITERATION_CAP;
            const count = Math.min(
              MILKDROP_LOOP_ITERATION_CAP,
              Math.max(0, Math.trunc(rawCount) || 0),
            );
            for (
              let index = 0;
              index < count && guard < MILKDROP_LOOP_ITERATION_CAP;
              index += 1, guard += 1
            ) {
              run(body);
            }
          } else {
            while (guard < MILKDROP_LOOP_ITERATION_CAP) {
              const condition = statement.control.condition
                ? evaluateMilkdropExpression(
                    statement.control.condition,
                    mirroredEnv,
                    helpers,
                  )
                : 1;
              if (condition === 0) break;
              guard += 1;
              run(body);
            }
          }
          continue;
        }

        let value = evaluateMilkdropExpression(
          statement.expression,
          mirroredEnv,
          helpers,
        );
        if (!Number.isFinite(value)) value = 0;

        if (statement.target === 'megabuf' || statement.target === 'gmegabuf') {
          const index = Math.trunc(
            statement.targetExpression
              ? evaluateMilkdropExpression(
                  statement.targetExpression,
                  mirroredEnv,
                  helpers,
                )
              : 0,
          );
          const buffer = statement.target === 'megabuf' ? mb : gb;
          const size =
            statement.target === 'megabuf'
              ? MILKDROP_MEGABUF_SIZE
              : MILKDROP_GMEGABUF_SIZE;
          if (index >= 0 && index < size) buffer[index] = value;
          e[statement.target] = value;
          continue;
        }

        mirroredEnv[statement.target] = value;
      }
    };
    run(block.statements);
  };
}

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
      : isJitAvailable()
        ? (new Function(
            'e',
            's',
            'r',
            'l',
            'mb',
            'gb',
            'rnd',
            compileProgramSource(block),
          ) as MilkdropProgramFn)
        : buildInterpretedProgram(block);

  compiledPrograms.set(block, compiled);
  return compiled;
}

/**
 * Pre-warms the per-block JIT cache for every program in a compiled preset,
 * yielding to the event loop between blocks.
 *
 * Without this, all `new Function` parse/compile work lands inside the first
 * rendered frame of a newly applied preset — one long task mid-blend that
 * visibly stalls playback on mobile (hundreds of ms for equation-heavy
 * presets, measured on a Galaxy S22). Compiling block-by-block ahead of the
 * swap splits that into frame-sized slices; the swap then finds every block
 * already cached.
 *
 * `shouldAbort` lets a superseded preset load stop wasting main-thread time.
 */
export async function prewarmMilkdropPrograms(
  ir: {
    programs: {
      init: MilkdropProgramBlock;
      perFrame: MilkdropProgramBlock;
      perPixel: MilkdropProgramBlock;
    };
    customWaves: Array<{
      programs: {
        init: MilkdropProgramBlock;
        perFrame: MilkdropProgramBlock;
        perPoint: MilkdropProgramBlock;
      };
    }>;
    customShapes: Array<{
      programs: {
        init: MilkdropProgramBlock;
        perFrame: MilkdropProgramBlock;
      };
    }>;
  },
  shouldAbort?: () => boolean,
): Promise<void> {
  // Best-effort warm-up: partially-shaped IR (test doubles, presets stripped
  // by a compile fallback) just skips instead of throwing mid-load.
  if (!ir?.programs) {
    return;
  }
  const blocks: MilkdropProgramBlock[] = [
    ir.programs.init,
    ir.programs.perFrame,
    ir.programs.perPixel,
  ];
  for (const wave of ir.customWaves ?? []) {
    blocks.push(wave.programs.init, wave.programs.perFrame);
    blocks.push(wave.programs.perPoint);
  }
  for (const shape of ir.customShapes ?? []) {
    blocks.push(shape.programs.init, shape.programs.perFrame);
  }

  const yieldToEventLoop = () =>
    new Promise<void>((resolve) => setTimeout(resolve, 0));

  for (const block of blocks) {
    if (shouldAbort?.()) {
      return;
    }
    if (block.statements.length === 0) {
      continue;
    }
    compileMilkdropProgram(block);
    await yieldToEventLoop();
  }
}
