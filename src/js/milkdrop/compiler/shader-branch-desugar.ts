/**
 * Flattens `if`/`else` blocks in a native `shader_body` into masked
 * assignments, so shader text that branches can still be executed statement by
 * statement.
 *
 * The direct-execution statement model has no control flow: every line is one
 * assignment, evaluated in order. Presets that branch (Conway-style cellular
 * automata, thresholded colour picks) therefore had no WebGPU path at all —
 * WebGL runs their raw GLSL, while WebGPU dropped to uniform-only "controls",
 * which approximates a neighbour-tap CA as a smear. Measured over the bundled
 * corpus, 127 of the 169 shader presets that WebGPU could not execute directly
 * were blocked by nothing but `if`/`else`.
 *
 * Each branch statement becomes `target = if(mask, value, target)`, where the
 * mask is the branch condition normalized to 0/1 and multiplied through nested
 * branches. `if(...)` is a value select on both backends, so a NaN produced on
 * the untaken side is discarded rather than mixed in.
 *
 * `for` loops whose trip count is known at compile time are unrolled first:
 * the body is emitted once per iteration with the induction variable replaced
 * by its literal value, so the branch flattening above then applies to each
 * copy. A bound that is a local assigned a plain literal earlier in the body
 * counts as known — `depth = 3; for (i = 0; i < depth; i++)` is a common
 * shape. Unrolling took the bundled corpus from 1161 to 1182 of the 1201
 * shader presets running directly on WebGPU.
 *
 * Anything outside the supported grammar — `while`, `discard`, indexed
 * assignment targets, statements that are not assignments, loops whose trip
 * count depends on runtime state, or an unroll that would exceed the statement
 * budget — returns null, and the caller keeps the existing behaviour: the body
 * stays unparsed, and the preset falls back to raw GLSL on WebGL.
 */

const REJECTED_KEYWORDS =
  /\b(?:while|do|switch|case|return|discard|break|continue)\b/u;

/**
 * Unrolling budgets. A trip count of 64 covers every bounded shader loop in
 * the bundled corpus (the largest is 16) with room to spare, while the 2048
 * statement ceiling keeps a pathological body from turning into a shader that
 * takes seconds to compile — the widest real unroll emits 224 statements.
 * Both are refusals, never truncations: a body that exceeds either falls back
 * to raw GLSL rather than rendering a partial loop.
 */
const MAX_LOOP_TRIP_COUNT = 64;
const MAX_LOOP_NESTING = 2;
const MAX_UNROLLED_STATEMENTS = 2048;

const ASSIGNMENT_PATTERN =
  /^(?:(?:const|highp|mediump|lowp)\s+)*(?:(float|int|bool|vec2|vec3|vec4|mat2|mat3|mat4|float2|float3|float4)\s+)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*(=|\+=|-=|\*=|\/=)\s*([\s\S]+)$/u;

/** Guards against pathological nesting producing unreadable mask products. */
const MAX_BRANCH_DEPTH = 4;

type Cursor = { pos: number };

/**
 * Tracks what each variable has been declared as and whether it already holds
 * a value, so a masked assignment never reads a variable that was declared but
 * never assigned — the statement model has no notion of an uninitialized
 * local, and reading one drops the whole statement.
 */
type DesugarScope = {
  declaredTypes: Map<string, string>;
  assigned: Set<string>;
  /**
   * Locals whose current value is a plain numeric literal, so a loop bound
   * naming one can still be resolved at compile time. Any other assignment to
   * the name drops it back to unknown.
   */
  constValues: Map<string, number>;
  /** How many unrolled loops the current statement sits inside. */
  loopDepth: number;
};

const ZERO_BY_TYPE: Record<string, string> = {
  float: '0.0',
  int: '0.0',
  bool: '0.0',
  vec2: 'vec2(0.0, 0.0)',
  float2: 'vec2(0.0, 0.0)',
  vec3: 'vec3(0.0, 0.0, 0.0)',
  float3: 'vec3(0.0, 0.0, 0.0)',
  vec4: 'vec4(0.0, 0.0, 0.0, 0.0)',
  float4: 'vec4(0.0, 0.0, 0.0, 0.0)',
};

const BARE_DECLARATION_PATTERN =
  /^(float|int|bool|vec[234]|mat[234]|float[234])\s+([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)$/u;

function recordDeclaration(statement: string, scope: DesugarScope): boolean {
  const match = statement.match(BARE_DECLARATION_PATTERN);
  if (!match) {
    return false;
  }
  const [, type, names] = match;
  for (const name of (names ?? '').split(',')) {
    scope.declaredTypes.set(name.trim(), type ?? 'float');
  }
  return true;
}

const NUMERIC_LITERAL_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/u;

function parseNumericLiteral(text: string): number | null {
  const trimmed = text
    .trim()
    .replace(/^\((.*)\)$/su, '$1')
    .trim();
  if (!NUMERIC_LITERAL_PATTERN.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Keeps `constValues` in step with the emitted statements. Only an
 * unconditional whole-variable assignment of a literal is knowable; everything
 * else — a masked write, a compound operator, a swizzled target, a computed
 * value — makes the name unknown from here on.
 */
function recordConstValue(
  base: string,
  target: string,
  operator: string,
  value: string,
  mask: string | null,
  scope: DesugarScope,
): void {
  const literal =
    mask === null && operator === '=' && target === base
      ? parseNumericLiteral(value)
      : null;
  if (literal === null) {
    scope.constValues.delete(base);
    return;
  }
  scope.constValues.set(base, literal);
}

/** The variable a target writes to, ignoring any swizzle or member suffix. */
function targetBaseName(target: string): string {
  return target.split('.')[0] ?? target;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/\/\/[^\n]*/gu, ' ');
}

function skipWhitespace(source: string, cursor: Cursor): void {
  while (cursor.pos < source.length && /\s/u.test(source[cursor.pos] ?? '')) {
    cursor.pos += 1;
  }
}

/**
 * Reads a balanced `(...)`/`{...}` region and returns its inner text, leaving
 * the cursor just past the closing delimiter.
 */
function readBalanced(
  source: string,
  cursor: Cursor,
  open: '(' | '{',
  close: ')' | '}',
): string | null {
  if (source[cursor.pos] !== open) {
    return null;
  }
  let depth = 0;
  const start = cursor.pos;
  while (cursor.pos < source.length) {
    const char = source[cursor.pos];
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        const inner = source.slice(start + 1, cursor.pos);
        cursor.pos += 1;
        return inner;
      }
    }
    cursor.pos += 1;
  }
  return null;
}

/** A condition normalized to exactly 0 or 1, so negation stays meaningful. */
function conditionMask(condition: string): string {
  return `step(0.0001, abs(${condition.trim()}))`;
}

function combineMasks(outer: string | null, inner: string): string {
  return outer ? `((${outer}) * (${inner}))` : inner;
}

function negateMask(mask: string): string {
  return `(1.0 - (${mask}))`;
}

function emitStatement(
  statement: string,
  mask: string | null,
  scope: DesugarScope,
  out: string[],
): boolean {
  const trimmed = statement.trim();
  if (!trimmed) {
    return true;
  }
  const match = trimmed.match(ASSIGNMENT_PATTERN);
  if (!match) {
    // A declaration with no initializer carries no logic of its own, but its
    // type decides how the variable is initialized if a branch writes to it
    // before anything else does.
    if (recordDeclaration(trimmed, scope)) {
      out.push(trimmed);
      return true;
    }
    // A statement this module cannot rewrite is still a statement. Passing it
    // through unchanged is the only honest option at the top level: the
    // downstream parser is wider than ASSIGNMENT_PATTERN — it accepts indexed
    // targets like `tmpvar_1[uint(0)].x = q20`, which this one does not — so
    // it can either execute the line or record it as unparsed and send the
    // preset to the raw-GLSL fallback.
    //
    // Dropping it instead was a silent corruption: a body that lost its matrix
    // writes still looked fully parsed, so the preset was classified as
    // directly executable while a mat3 was declared and never assigned. A
    // corpus sweep found 49 presets losing 469 statements this way, every one
    // of them a matrix element write, several rendering black.
    //
    // Under a mask there is no honest pass-through — the statement would run
    // unconditionally — so a branch or loop body refuses instead, and the
    // whole shader falls back.
    if (mask === null && scope.loopDepth === 0) {
      out.push(trimmed);
      return true;
    }
    return false;
  }
  const [, declaration, target, operator, value] = match;
  if (!target || !operator || !value) {
    return false;
  }
  const base = targetBaseName(target);
  recordConstValue(base, target, operator, value, mask, scope);
  if (declaration) {
    // A variable declared inside a branch cannot be read outside it, so
    // computing it unconditionally is safe and keeps later masked assignments
    // to it well-formed.
    scope.declaredTypes.set(base, declaration);
    scope.assigned.add(base);
    out.push(trimmed);
    return true;
  }
  if (!mask) {
    scope.assigned.add(base);
    out.push(trimmed);
    return true;
  }
  if (!scope.assigned.has(base)) {
    // Masked assignment reads the variable's previous value for the untaken
    // case, so it must have one. `bool b; if (c) { b = ...; } else { b = ...; }`
    // is the common shape.
    const zero = ZERO_BY_TYPE[scope.declaredTypes.get(base) ?? 'float'];
    if (!zero) {
      return false;
    }
    out.push(`${base} = ${zero}`);
    scope.assigned.add(base);
  }
  const nextValue =
    operator === '='
      ? `(${value.trim()})`
      : `(${target}) ${operator[0]} (${value.trim()})`;
  out.push(`${target} = if(${mask}, ${nextValue}, ${target})`);
  return true;
}

function parseBranchBody(
  source: string,
  cursor: Cursor,
  mask: string | null,
  depth: number,
  scope: DesugarScope,
  out: string[],
): boolean {
  skipWhitespace(source, cursor);
  if (source[cursor.pos] === '{') {
    const inner = readBalanced(source, cursor, '{', '}');
    if (inner === null) {
      return false;
    }
    const innerCursor: Cursor = { pos: 0 };
    if (!parseStatements(inner, innerCursor, mask, depth, scope, out)) {
      return false;
    }
    skipWhitespace(source, cursor);
    if (source[cursor.pos] === ';') {
      cursor.pos += 1;
    }
    return true;
  }
  // Braceless single-statement branch.
  return parseSingleStatement(source, cursor, mask, depth, scope, out);
}

function parseSingleStatement(
  source: string,
  cursor: Cursor,
  mask: string | null,
  depth: number,
  scope: DesugarScope,
  out: string[],
): boolean {
  skipWhitespace(source, cursor);
  if (
    source.startsWith('if', cursor.pos) &&
    /\W|^/u.test(source[cursor.pos + 2] ?? ' ')
  ) {
    return parseIf(source, cursor, mask, depth, scope, out);
  }
  if (
    source.startsWith('for', cursor.pos) &&
    /\W|^/u.test(source[cursor.pos + 3] ?? ' ')
  ) {
    return parseFor(source, cursor, mask, depth, scope, out);
  }
  const start = cursor.pos;
  while (cursor.pos < source.length) {
    const char = source[cursor.pos];
    if (char === ';') {
      const statement = source.slice(start, cursor.pos);
      cursor.pos += 1;
      return emitStatement(statement, mask, scope, out);
    }
    if (char === '{' || char === '}') {
      return false;
    }
    if (char === '(') {
      if (readBalanced(source, cursor, '(', ')') === null) {
        return false;
      }
      continue;
    }
    cursor.pos += 1;
  }
  // Trailing statement with no terminating semicolon.
  return emitStatement(source.slice(start), mask, scope, out);
}

type LoopPlan = { variable: string; values: number[]; isInt: boolean };

const LOOP_INIT_PATTERN =
  /^(?:(?:const|highp|mediump|lowp)\s+)*(?:(int|float)\s+)?([A-Za-z_]\w*)\s*=\s*(.+)$/u;

/** `n`, `float(n)` and `int(n)` all name the induction variable. */
const LOOP_OPERAND_PATTERN =
  /^(?:(?:float|int)\s*\(\s*)?([A-Za-z_]\w*)\s*\)?$/u;

const LOOP_COMPARISONS = ['<=', '>=', '<', '>'] as const;

type Comparison = (typeof LOOP_COMPARISONS)[number];

const FLIPPED: Record<Comparison, Comparison> = {
  '<': '>',
  '>': '<',
  '<=': '>=',
  '>=': '<=',
};

function resolveBound(text: string, scope: DesugarScope): number | null {
  const literal = parseNumericLiteral(text);
  if (literal !== null) {
    return literal;
  }
  const named = text.trim().match(LOOP_OPERAND_PATTERN)?.[1];
  if (!named) {
    return null;
  }
  return scope.constValues.get(named) ?? null;
}

/**
 * Reads a `for (init; cond; update)` header and returns the exact list of
 * values the induction variable takes, or null when any of the three parts
 * falls outside the bounded grammar.
 */
function planLoop(header: string, scope: DesugarScope): LoopPlan | null {
  const parts = header.split(';');
  if (parts.length !== 3) {
    return null;
  }
  const [initText, condText, updateText] = parts as [string, string, string];

  const init = initText.trim().match(LOOP_INIT_PATTERN);
  if (!init) {
    return null;
  }
  const declaredType = init[1];
  const variable = init[2] ?? '';
  const start = resolveBound(init[3] ?? '', scope);
  if (!variable || start === null) {
    return null;
  }

  const comparison = LOOP_COMPARISONS.find((candidate) =>
    condText.includes(candidate),
  );
  if (!comparison) {
    return null;
  }
  const [leftText, rightText, ...extra] = condText.split(comparison);
  if (extra.length > 0 || leftText === undefined || rightText === undefined) {
    return null;
  }
  let operator: Comparison = comparison;
  let boundText = rightText;
  if (leftText.trim().match(LOOP_OPERAND_PATTERN)?.[1] !== variable) {
    // `10 > n` reads the same as `n < 10`.
    if (rightText.trim().match(LOOP_OPERAND_PATTERN)?.[1] !== variable) {
      return null;
    }
    operator = FLIPPED[comparison];
    boundText = leftText;
  }
  const bound = resolveBound(boundText, scope);
  if (bound === null) {
    return null;
  }

  const step = parseLoopStep(updateText, variable);
  if (step === null || step === 0) {
    return null;
  }

  const values: number[] = [];
  for (let value = start; continues(value, operator, bound); value += step) {
    values.push(value);
    if (values.length > MAX_LOOP_TRIP_COUNT) {
      return null;
    }
  }
  const isInt = declaredType !== 'float' && Number.isInteger(step);
  return { variable, values, isInt };
}

function continues(
  value: number,
  operator: Comparison,
  bound: number,
): boolean {
  switch (operator) {
    case '<':
      return value < bound;
    case '<=':
      return value <= bound;
    case '>':
      return value > bound;
    default:
      return value >= bound;
  }
}

function parseLoopStep(updateText: string, variable: string): number | null {
  const update = updateText.trim();
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (new RegExp(`^(?:\\+\\+${escaped}|${escaped}\\+\\+)$`, 'u').test(update)) {
    return 1;
  }
  if (new RegExp(`^(?:--${escaped}|${escaped}--)$`, 'u').test(update)) {
    return -1;
  }
  const compound = update.match(
    new RegExp(`^${escaped}\\s*([+-])=\\s*(.+)$`, 'u'),
  );
  if (compound) {
    const amount = parseNumericLiteral(compound[2] ?? '');
    return amount === null ? null : compound[1] === '-' ? -amount : amount;
  }
  const assigned = update.match(
    new RegExp(`^${escaped}\\s*=\\s*${escaped}\\s*([+-])\\s*(.+)$`, 'u'),
  );
  if (assigned) {
    const amount = parseNumericLiteral(assigned[2] ?? '');
    return amount === null ? null : assigned[1] === '-' ? -amount : amount;
  }
  return null;
}

function formatLoopValue(value: number, isInt: boolean): string {
  if (isInt) {
    return String(value);
  }
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

/**
 * Replaces whole-identifier uses of the induction variable with its value for
 * this iteration. The lookbehind keeps `foo.n` and `n_2` from matching `n`.
 */
function substituteInductionVariable(
  body: string,
  variable: string,
  value: string,
): string {
  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return body.replace(
    new RegExp(`(?<![\\w.$])${escaped}(?![\\w$])`, 'gu'),
    value,
  );
}

/** Reads the loop body text, brace-wrapped or a single statement. */
function readLoopBody(source: string, cursor: Cursor): string | null {
  skipWhitespace(source, cursor);
  if (source[cursor.pos] === '{') {
    const inner = readBalanced(source, cursor, '{', '}');
    if (inner === null) {
      return null;
    }
    skipWhitespace(source, cursor);
    if (source[cursor.pos] === ';') {
      cursor.pos += 1;
    }
    return inner;
  }
  const start = cursor.pos;
  while (cursor.pos < source.length) {
    const char = source[cursor.pos];
    if (char === ';') {
      const statement = source.slice(start, cursor.pos);
      cursor.pos += 1;
      return statement;
    }
    if (char === '{' || char === '}') {
      return null;
    }
    if (char === '(') {
      if (readBalanced(source, cursor, '(', ')') === null) {
        return null;
      }
      continue;
    }
    cursor.pos += 1;
  }
  return null;
}

function parseFor(
  source: string,
  cursor: Cursor,
  mask: string | null,
  depth: number,
  scope: DesugarScope,
  out: string[],
): boolean {
  if (scope.loopDepth >= MAX_LOOP_NESTING) {
    return false;
  }
  cursor.pos += 3;
  skipWhitespace(source, cursor);
  const header = readBalanced(source, cursor, '(', ')');
  if (header === null) {
    return false;
  }
  const body = readLoopBody(source, cursor);
  if (body === null) {
    return false;
  }
  const plan = planLoop(header, scope);
  if (!plan) {
    return false;
  }
  const escaped = plan.variable.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (
    new RegExp(
      `(?<![\\w.$])${escaped}\\s*(?:[+\\-*/]?=[^=]|\\+\\+|--)`,
      'u',
    ).test(body)
  ) {
    // The body moves the induction variable itself, so the header's trip count
    // is not the real one.
    return false;
  }

  scope.loopDepth += 1;
  try {
    for (const value of plan.values) {
      const iteration = substituteInductionVariable(
        body,
        plan.variable,
        formatLoopValue(value, plan.isInt),
      );
      if (!parseStatements(iteration, { pos: 0 }, mask, depth, scope, out)) {
        return false;
      }
      if (out.length > MAX_UNROLLED_STATEMENTS) {
        return false;
      }
    }
  } finally {
    scope.loopDepth -= 1;
  }
  return true;
}

function parseIf(
  source: string,
  cursor: Cursor,
  mask: string | null,
  depth: number,
  scope: DesugarScope,
  out: string[],
): boolean {
  if (depth >= MAX_BRANCH_DEPTH) {
    return false;
  }
  cursor.pos += 2;
  skipWhitespace(source, cursor);
  const condition = readBalanced(source, cursor, '(', ')');
  if (condition === null || !condition.trim()) {
    return false;
  }
  const branchMask = conditionMask(condition);
  if (
    !parseBranchBody(
      source,
      cursor,
      combineMasks(mask, branchMask),
      depth + 1,
      scope,
      out,
    )
  ) {
    return false;
  }
  const afterThen = cursor.pos;
  skipWhitespace(source, cursor);
  if (!source.startsWith('else', cursor.pos)) {
    cursor.pos = afterThen;
    return true;
  }
  cursor.pos += 4;
  return parseBranchBody(
    source,
    cursor,
    combineMasks(mask, negateMask(branchMask)),
    depth + 1,
    scope,
    out,
  );
}

function parseStatements(
  source: string,
  cursor: Cursor,
  mask: string | null,
  depth: number,
  scope: DesugarScope,
  out: string[],
): boolean {
  while (cursor.pos < source.length) {
    skipWhitespace(source, cursor);
    if (cursor.pos >= source.length) {
      return true;
    }
    const char = source[cursor.pos];
    if (char === ';') {
      cursor.pos += 1;
      continue;
    }
    if (char === '}') {
      return false;
    }
    if (char === '{') {
      // A bare block introduces no control flow; flatten it in place.
      const inner = readBalanced(source, cursor, '{', '}');
      if (inner === null) {
        return false;
      }
      if (!parseStatements(inner, { pos: 0 }, mask, depth, scope, out)) {
        return false;
      }
      continue;
    }
    if (!parseSingleStatement(source, cursor, mask, depth, scope, out)) {
      return false;
    }
  }
  return true;
}

/**
 * Rewrites `if`/`else` blocks in a shader body as masked assignments. Returns
 * null when the body has no branches to flatten, or uses a construct outside
 * the supported grammar.
 */
export function desugarShaderBranches(body: string): string | null {
  if (!/\b(?:if|for)\s*\(/u.test(body)) {
    return null;
  }
  const source = stripComments(body);
  if (REJECTED_KEYWORDS.test(source)) {
    return null;
  }
  const out: string[] = [];
  const scope: DesugarScope = {
    declaredTypes: new Map<string, string>(),
    assigned: new Set<string>(),
    constValues: new Map<string, number>(),
    loopDepth: 0,
  };
  if (!parseStatements(source, { pos: 0 }, null, 0, scope, out)) {
    return null;
  }
  if (out.length === 0) {
    return null;
  }
  return `${out.join(';\n')};`;
}
