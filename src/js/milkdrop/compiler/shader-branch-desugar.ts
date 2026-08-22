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
 * Anything outside the supported grammar — loops, `discard`, indexed
 * assignment targets, statements that are not assignments — returns null, and
 * the caller keeps the existing behaviour: the body stays unparsed, and the
 * preset falls back to raw GLSL on WebGL.
 */

const REJECTED_KEYWORDS =
  /\b(?:for|while|do|switch|case|return|discard|break|continue)\b/u;

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
    return mask === null;
  }
  const [, declaration, target, operator, value] = match;
  if (!target || !operator || !value) {
    return false;
  }
  const base = targetBaseName(target);
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
  if (!/\bif\s*\(/u.test(body)) {
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
  };
  if (!parseStatements(source, { pos: 0 }, null, 0, scope, out)) {
    return null;
  }
  if (out.length === 0) {
    return null;
  }
  return `${out.join(';\n')};`;
}
