/**
 * Parses and interprets EEL2, the expression language MilkDrop presets are
 * written in.
 *
 * Owns the whole front end for preset equations: statement splitting, the
 * expression parser, and a tree-walking evaluator. `expression-jit.ts` compiles
 * the same AST to JavaScript for speed, but this interpreter remains the
 * reference — it is what the JIT is checked against, and what runs when
 * `new Function` is unavailable under a strict Content-Security-Policy.
 *
 * EEL2 has no specification. Its semantics are whatever Winamp's implementation
 * did, including the parts that look like bugs: integer coercion rules,
 * division by zero yielding zero rather than infinity, and the `close`
 * comparison tolerance in `eel-function-table.ts`. Match observed behavior over
 * intuition, and add a case to the compiler tests when you discover a new one.
 */
import {
  MILKDROP_INTRINSIC_FUNCTION_NAMES,
  MILKDROP_INTRINSIC_IDENTIFIER_NAMES,
} from './builtin-docs';
import {
  EEL_BINARY_OPERATORS,
  EEL_UNARY_OPERATORS,
  type EelEvalHelpers,
  evaluateEelCall,
  finiteOrZero,
  MILKDROP_EEL_CLOSE_FACTOR,
  toMilkdropInt,
} from './compiler/eel-function-table.ts';
import { resolveMilkdropIdentifier } from './field-normalization';
import type {
  MilkdropCompiledStatement,
  MilkdropControlFlowStatement,
  MilkdropDiagnostic,
  MilkdropExpressionNode,
} from './types';

export function findNearestMatch(
  input: string,
  candidates: string[],
): string | null {
  const lower = input.toLowerCase();
  let best: string | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const cLower = c.toLowerCase();
    if (cLower === lower) return c;
    let matches = 0;
    for (let i = 0; i < lower.length; i++) {
      if (cLower.includes(lower[i])) matches++;
    }
    const dist = Math.abs(c.length - lower.length) + (lower.length - matches);
    if (dist < bestDist && dist < lower.length) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

type Token =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'comma'; value: ',' }
  | { type: 'eof' };

type ParseResult<T> = {
  value: T | null;
  diagnostics: MilkdropDiagnostic[];
};

/**
 * EEL compound assignment. ns-eel supports these and the corpus uses them
 * (`exec2(k1 += 0.05 * bass_att, k1)`), so they must tokenize as one operator
 * rather than as `+` followed by `=`.
 */
const COMPOUND_ASSIGNMENT_OPERATORS = ['+=', '-=', '*=', '/=', '%='] as const;

const operatorTokens = [
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  ...COMPOUND_ASSIGNMENT_OPERATORS,
];

// The names live in `builtin-docs.ts` (the single source of truth shared with
// the editor's highlighter, autocomplete, and hover docs); these sets remain
// the authoritative interface for what the compiler accepts. Every name must
// have an entry in `compiler/eel-function-table.ts`.
export const MILKDROP_INTRINSIC_IDENTIFIERS = new Set(
  MILKDROP_INTRINSIC_IDENTIFIER_NAMES,
);

export const MILKDROP_INTRINSIC_FUNCTIONS = new Set(
  MILKDROP_INTRINSIC_FUNCTION_NAMES,
);

// The close factor and int conversion now live in the shared operator table;
// re-exported here because this module has always been their public home.
export { MILKDROP_EEL_CLOSE_FACTOR };

function createDiagnostic(
  line: number,
  code: string,
  message: string,
): MilkdropDiagnostic {
  return { severity: 'error', category: 'eel-compile', line, code, message };
}

function isIdentifierStart(char: string) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string) {
  return /[A-Za-z0-9_]/.test(char);
}

/**
 * The numeric literals EEL accepts: hex (`0x1f`), and decimals with an
 * optional exponent (`1e-8`, `2.5E+3`). Mirrors `NUMBER_PATTERN` in
 * `scripts/butterchurn-eel-transpiler.ts`, which is the grammar the bundled
 * corpus was generated against — the two must stay in agreement, or presets
 * that tool emits will not parse here. The trailing-dot form (`5.`) is an
 * extra this parser has always accepted; digit separators (`1_000`) are
 * stripped before the test.
 */
const NUMBER_LITERAL_PATTERN =
  /^(?:0[xX][0-9a-fA-F]+|(?:[0-9]*\.)?[0-9]+(?:[eE][+-]?[0-9]+)?|[0-9]+\.)$/u;

/**
 * Length of an exponent suffix (`e-8`, `E+12`) at `position`, or 0 when what
 * follows is not one. Requiring a digit after the optional sign is what keeps
 * `2e-x` tokenizing as `2`, `e`, `-`, `x` — where `e` is Euler's constant —
 * rather than being swallowed into a malformed number.
 */
function exponentSuffixLength(source: string, position: number) {
  if (!/[eE]/.test(source[position] ?? '')) {
    return 0;
  }
  const signLength = /[+-]/.test(source[position + 1] ?? '') ? 1 : 0;
  return /[0-9]/.test(source[position + 1 + signLength] ?? '')
    ? 1 + signLength
    : 0;
}

function tokenize(source: string, line: number): ParseResult<Token[]> {
  const diagnostics: MilkdropDiagnostic[] = [];
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const current = source[index];
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }

    const twoChar = source.slice(index, index + 2);
    if (operatorTokens.includes(twoChar)) {
      tokens.push({ type: 'operator', value: twoChar });
      index += 2;
      continue;
    }

    if ('+-*/%^<>!|&=?:'.includes(current)) {
      tokens.push({ type: 'operator', value: current });
      index += 1;
      continue;
    }

    if (current === '(' || current === ')') {
      tokens.push({ type: 'paren', value: current });
      index += 1;
      continue;
    }

    if (current === ',') {
      tokens.push({ type: 'comma', value: current });
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(current)) {
      const isHex = /^0[xX][0-9a-fA-F]/.test(source.slice(index));
      let end = index + 1;
      while (end < source.length) {
        if (
          isHex
            ? /[0-9a-fA-FxX]/.test(source[end])
            : /[0-9._]/.test(source[end])
        ) {
          end += 1;
          continue;
        }
        // Consume `e-8`-style suffixes as part of the literal rather than
        // letting them tokenize as the constant `e` followed by a subtraction.
        const exponentLength = isHex ? 0 : exponentSuffixLength(source, end);
        if (exponentLength === 0) {
          break;
        }
        end += exponentLength;
      }
      const rawValue = source.slice(index, end).split('_').join('');
      const parsedValue = isHex
        ? Number.parseInt(rawValue, 16)
        : Number.parseFloat(rawValue);
      // Number.parseFloat parses a leading numeric prefix rather than the
      // whole string, so a typo like "1.2.3" would silently become 1.2
      // with the invalid ".3" tail dropped and no diagnostic at all.
      // Requiring the captured span to match the literal grammar turns
      // that into a reported error instead of a silent wrong value.
      const isWellFormedLiteral = NUMBER_LITERAL_PATTERN.test(rawValue);
      if (!Number.isFinite(parsedValue) || !isWellFormedLiteral) {
        diagnostics.push(
          createDiagnostic(
            line,
            'expr_invalid_number',
            `Invalid number "${rawValue}".`,
          ),
        );
      } else {
        tokens.push({ type: 'number', value: parsedValue });
      }
      index = end;
      continue;
    }

    if (isIdentifierStart(current)) {
      let end = index + 1;
      while (end < source.length && isIdentifierPart(source[end])) {
        end += 1;
      }
      tokens.push({ type: 'identifier', value: source.slice(index, end) });
      index = end;
      continue;
    }

    diagnostics.push(
      createDiagnostic(
        line,
        'expr_unexpected_character',
        `Unexpected character "${current}" in expression.`,
      ),
    );
    index += 1;
  }

  tokens.push({ type: 'eof' });
  return { value: diagnostics.length ? null : tokens, diagnostics };
}

const MAX_EXPRESSION_RECURSION_DEPTH = 100;

class ExpressionParser {
  private readonly tokens: Token[];
  private readonly line: number;
  private readonly diagnostics: MilkdropDiagnostic[] = [];
  private index = 0;
  private depth = 0;

  constructor(tokens: Token[], line: number) {
    this.tokens = tokens;
    this.line = line;
  }

  parse(): ParseResult<MilkdropExpressionNode> {
    const value = this.parseAssignment();
    if (this.peek().type !== 'eof') {
      this.diagnostics.push(
        createDiagnostic(
          this.line,
          'expr_trailing_tokens',
          'Trailing tokens found after the end of the expression.',
        ),
      );
    }

    return {
      value: this.diagnostics.length ? null : value,
      diagnostics: this.diagnostics,
    };
  }

  private enterDepth(): boolean {
    this.depth += 1;
    if (this.depth > MAX_EXPRESSION_RECURSION_DEPTH) {
      this.diagnostics.push(
        createDiagnostic(
          this.line,
          'expr_max_depth_exceeded',
          'Expression nesting depth exceeded maximum limit of 100.',
        ),
      );
      return false;
    }
    return true;
  }

  private leaveDepth() {
    this.depth = Math.max(0, this.depth - 1);
  }

  /** Assignment has the lowest precedence and is right-associative, so a=b=c
   * parses as a=(b=c). Compound assignment (`x += y`) desugars here into
   * `x = x + y`, which is exactly what EEL does; every downstream tier then
   * sees an ordinary assignment and needs no compound-operator handling. */
  private parseAssignment(): MilkdropExpressionNode {
    if (!this.enterDepth()) {
      return { type: 'literal', value: 0 };
    }
    try {
      const left = this.parseConditional();
      const operator = this.matchOperator(
        '=',
        ...COMPOUND_ASSIGNMENT_OPERATORS,
      );
      if (!operator) {
        return left;
      }
      const right = this.parseAssignment();
      if (operator === '=') {
        return { type: 'binary', operator: '=', left, right };
      }
      return {
        type: 'binary',
        operator: '=',
        left,
        // The target is re-read, not re-evaluated for effect: for the
        // identifier and megabuf targets EEL allows, reading is pure.
        right: {
          type: 'binary',
          operator: operator[0] as '+' | '-' | '*' | '/' | '%',
          left,
          right,
        },
      };
    } finally {
      this.leaveDepth();
    }
  }

  /**
   * The EEL ternary, which binds tighter than assignment and looser than
   * `||`, and is right-associative (`a ? b : c ? d : e` groups to the right).
   *
   * It desugars to the intrinsic `if(cond, then, else)` — the same node the
   * parser already produces for the call form — so every tier keeps its
   * existing lazy-branch semantics and needs no new case.
   */
  private parseConditional(): MilkdropExpressionNode {
    const condition = this.parseLogicalOr();
    if (!this.matchOperator('?')) {
      return condition;
    }
    const whenTrue = this.parseAssignment();
    if (!this.matchOperator(':')) {
      this.diagnostics.push(
        createDiagnostic(
          this.line,
          'expr_expected_conditional_colon',
          'Expected ":" to complete a "?:" conditional.',
        ),
      );
      return condition;
    }
    // The else branch parses as a full assignment, matching how JS (and how
    // preset authors) read `c ? a = 5 : a = 9`. Recursing through
    // parseAssignment still reaches parseConditional, so a chained
    // `a ? b : c ? d : e` stays right-associative.
    const whenFalse = this.parseAssignment();
    return {
      type: 'call',
      name: 'if',
      args: [condition, whenTrue, whenFalse],
    };
  }

  private peek() {
    return this.tokens[this.index] as Token;
  }

  private advance() {
    const token = this.tokens[this.index] as Token;
    this.index = Math.min(this.index + 1, this.tokens.length - 1);
    return token;
  }

  private matchOperator(...operators: string[]) {
    const token = this.peek();
    if (token.type === 'operator' && operators.includes(token.value)) {
      this.advance();
      return token.value;
    }
    return null;
  }

  private parseLogicalOr(): MilkdropExpressionNode {
    let node = this.parseLogicalAnd();
    while (this.matchOperator('||')) {
      node = {
        type: 'binary',
        operator: '||',
        left: node,
        right: this.parseLogicalAnd(),
      };
    }
    return node;
  }

  private parseLogicalAnd(): MilkdropExpressionNode {
    let node = this.parseBitwiseOr();
    while (this.matchOperator('&&')) {
      node = {
        type: 'binary',
        operator: '&&',
        left: node,
        right: this.parseBitwiseOr(),
      };
    }
    return node;
  }

  private parseBitwiseOr(): MilkdropExpressionNode {
    let node = this.parseBitwiseAnd();
    while (this.matchOperator('|')) {
      node = {
        type: 'binary',
        operator: '|',
        left: node,
        right: this.parseBitwiseAnd(),
      };
    }
    return node;
  }

  private parseBitwiseAnd(): MilkdropExpressionNode {
    let node = this.parseEquality();
    while (this.matchOperator('&')) {
      node = {
        type: 'binary',
        operator: '&',
        left: node,
        right: this.parseEquality(),
      };
    }
    return node;
  }

  private parseEquality(): MilkdropExpressionNode {
    let node = this.parseComparison();
    while (true) {
      const operator = this.matchOperator('==', '!=');
      if (!operator) {
        return node;
      }
      node = {
        type: 'binary',
        operator: operator as '==' | '!=',
        left: node,
        right: this.parseComparison(),
      };
    }
  }

  private parseComparison(): MilkdropExpressionNode {
    let node = this.parseTerm();
    while (true) {
      const operator = this.matchOperator('<', '<=', '>', '>=');
      if (!operator) {
        return node;
      }
      node = {
        type: 'binary',
        operator: operator as '<' | '<=' | '>' | '>=',
        left: node,
        right: this.parseTerm(),
      };
    }
  }

  private parseTerm(): MilkdropExpressionNode {
    let node = this.parseFactor();
    while (true) {
      const operator = this.matchOperator('+', '-');
      if (!operator) {
        return node;
      }
      node = {
        type: 'binary',
        operator: operator as '+' | '-',
        left: node,
        right: this.parseFactor(),
      };
    }
  }

  private parseFactor(): MilkdropExpressionNode {
    let node = this.parsePower();
    while (true) {
      const operator = this.matchOperator('*', '/', '%');
      if (!operator) {
        return node;
      }
      node = {
        type: 'binary',
        operator: operator as '*' | '/' | '%',
        left: node,
        right: this.parsePower(),
      };
    }
  }

  private parsePower(): MilkdropExpressionNode {
    let node = this.parseUnary();
    while (true) {
      const operator = this.matchOperator('^');
      if (!operator) {
        return node;
      }
      node = {
        type: 'binary',
        operator: '^',
        left: node,
        right: this.parseUnary(),
      };
    }
  }

  private parseUnary(): MilkdropExpressionNode {
    const operator = this.matchOperator('+', '-', '!');
    if (operator) {
      return {
        type: 'unary',
        operator: operator as '+' | '-' | '!',
        operand: this.parseUnary(),
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): MilkdropExpressionNode {
    const token = this.advance();

    if (token.type === 'number') {
      return { type: 'literal', value: token.value };
    }

    if (token.type === 'identifier') {
      if (this.isParen('(')) {
        this.advance();
        const args: MilkdropExpressionNode[] = [];
        while (!this.isParen(')')) {
          args.push(this.parseAssignment());
          if (this.peek().type === 'comma') {
            this.advance();
            continue;
          }
          if (this.isParen(')')) {
            break;
          }
          this.diagnostics.push(
            createDiagnostic(
              this.line,
              'expr_expected_comma',
              'Expected a comma or closing parenthesis in function call.',
            ),
          );
          break;
        }
        if (this.isParen(')')) {
          this.advance();
        } else {
          this.diagnostics.push(
            createDiagnostic(
              this.line,
              'expr_expected_closing_paren',
              'Expected a closing parenthesis.',
            ),
          );
        }
        return {
          type: 'call',
          name: token.value,
          args,
        };
      }

      return { type: 'identifier', name: token.value };
    }

    if (token.type === 'paren' && token.value === '(') {
      const expression = this.parseAssignment();
      if (!this.isParen(')')) {
        this.diagnostics.push(
          createDiagnostic(
            this.line,
            'expr_unclosed_group',
            'Expected a closing parenthesis.',
          ),
        );
      } else {
        this.advance();
      }
      return expression;
    }

    this.diagnostics.push(
      createDiagnostic(
        this.line,
        'expr_expected_primary',
        'Expected a number, variable, or parenthesized expression.',
      ),
    );
    return { type: 'literal', value: 0 };
  }

  private isParen(value: '(' | ')') {
    const token = this.peek();
    return token.type === 'paren' && token.value === value;
  }
}

type EvalHelpers = EelEvalHelpers;

export function evaluateMilkdropExpression(
  node: MilkdropExpressionNode,
  env: Record<string, number>,
  helpers: EvalHelpers = {},
): number {
  switch (node.type) {
    case 'literal':
      return node.value;
    case 'identifier': {
      const normalized = node.name.toLowerCase();
      // pi/e are ordinary prepopulated variables in MilkDrop's EEL (ns-eel
      // registers them like any other var), so preset assignments to them
      // must stick — ~74 corpus presets overwrite one of them. The GPU field
      // planner already models this (isOverwritableConstant); resolving the
      // env first converges the CPU tiers with it. Envs without the key
      // (partial analysis envs) still see the constants.
      if (normalized === 'pi')
        return resolveMilkdropIdentifier(env, node.name) ?? Math.PI;
      if (normalized === 'e')
        return resolveMilkdropIdentifier(env, node.name) ?? Math.E;
      return resolveMilkdropIdentifier(env, node.name) ?? 0;
    }
    case 'unary': {
      const value = evaluateMilkdropExpression(node.operand, env, helpers);
      return EEL_UNARY_OPERATORS[node.operator]?.interp?.(value) ?? 0;
    }
    case 'binary': {
      // Assignment is handled specially to allow side effects on LHS
      if (node.operator === '=') {
        // Clamp before the store, not after: the JIT emits the same clamp on
        // its nested-assignment temporary, and without it an assignment
        // nested inside an expression (`zoom = (q1 = 1e300 * 1e300)`) writes
        // a raw Infinity/NaN straight into the persistent register/state
        // mirrors, where it survives every later frame. The statement-level
        // clamp in expression-jit's interpreted runner only covers the
        // outermost value, so it never caught these.
        const rvalue = finiteOrZero(
          evaluateMilkdropExpression(node.right, env, helpers),
        );
        // Perform assignment to the left side
        if (node.left.type === 'identifier') {
          const key = node.left.name.toLowerCase();
          env[key] = rvalue;
        } else if (
          node.left.type === 'call' &&
          (node.left.name.toLowerCase() === 'megabuf' ||
            node.left.name.toLowerCase() === 'gmegabuf')
        ) {
          const write =
            node.left.name.toLowerCase() === 'megabuf'
              ? helpers.megabufWrite
              : helpers.gmegabufWrite;
          const index = toMilkdropInt(
            evaluateMilkdropExpression(
              node.left.args[0] ?? { type: 'literal', value: 0 },
              env,
              helpers,
            ),
          );
          // Bounds checking is owned by the helper provider, matching the
          // read side where out-of-range access resolves to 0.
          write?.(index, rvalue);
        }
        return rvalue;
      }

      const left = evaluateMilkdropExpression(node.left, env, helpers);
      // Short-circuit like EEL (and the JIT's emitted JS): the right side of
      // a decided boolean op must not run — preset code puts assignments
      // there and relies on them being skipped.
      if (node.operator === '&&' || node.operator === '||') {
        const leftTruthy = Math.abs(left) > MILKDROP_EEL_CLOSE_FACTOR;
        if (node.operator === '&&' && !leftTruthy) return 0;
        if (node.operator === '||' && leftTruthy) return 1;
        const right = evaluateMilkdropExpression(node.right, env, helpers);
        return Math.abs(right) > MILKDROP_EEL_CLOSE_FACTOR ? 1 : 0;
      }
      const right = evaluateMilkdropExpression(node.right, env, helpers);
      return EEL_BINARY_OPERATORS[node.operator]?.interp?.(left, right) ?? 0;
    }
    case 'call': {
      const lazyName = node.name.toLowerCase();
      // `if` must evaluate only the taken branch — EEL compiles it to a
      // branch, and preset code relies on that for side effects
      // (`if(c, q1 = a, q1 = b)`). The JIT emits a lazy ternary; evaluating
      // all three args here ran both branches' assignments and diverged.
      if (lazyName === 'if') {
        const condition = node.args[0]
          ? evaluateMilkdropExpression(node.args[0], env, helpers)
          : 0;
        const branch =
          Math.abs(condition) > MILKDROP_EEL_CLOSE_FACTOR
            ? node.args[1]
            : node.args[2];
        return branch ? evaluateMilkdropExpression(branch, env, helpers) : 0;
      }
      const args = node.args.map((arg) =>
        evaluateMilkdropExpression(arg, env, helpers),
      );
      return evaluateEelCall(lazyName, args, helpers);
    }
  }
}

export function splitMilkdropStatements(source: string) {
  const normalizedSource = source
    .replace(/\r\n/gu, '\n')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\/\/[^\n]*/gu, '');
  const statements: string[] = [];
  let current = '';
  let depth = 0;

  for (let index = 0; index < normalizedSource.length; index += 1) {
    const char = normalizedSource[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }

    if ((char === ';' || char === '\n') && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) {
    statements.push(tail);
  }

  return statements;
}

/**
 * Locates the top-level assignment operator, returning where it starts and
 * which one it is (`=` or a compound form).
 *
 * The `=` in `==`, `<=`, `>=` and `!=` is NOT an assignment: matching it split
 * `x == 1` into the target `x` and the expression `= 1`, reporting a bogus
 * invalid-target error for a statement that is merely a (useless but legal)
 * comparison.
 */
function findAssignmentIndex(source: string): {
  index: number;
  operator: string;
} {
  let depth = 0;
  let sawConditional = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === '?' && depth === 0) {
      // Past a top-level `?` every `=` belongs to a ternary branch
      // (`c ? x = 1 : x = 2`), not to a statement-level assignment.
      sawConditional = true;
      continue;
    }
    if (char !== '=' || depth !== 0 || sawConditional) {
      continue;
    }
    if (source[index + 1] === '=' || '<>!='.includes(source[index - 1] ?? '')) {
      continue;
    }
    const compound = COMPOUND_ASSIGNMENT_OPERATORS.find(
      (operator) => operator[0] === source[index - 1],
    );
    return compound
      ? { index: index - 1, operator: compound }
      : { index, operator: '=' };
  }
  return { index: -1, operator: '=' };
}

export function parseMilkdropExpression(
  source: string,
  line: number,
): ParseResult<MilkdropExpressionNode> {
  const tokenResult = tokenize(source, line);
  if (!tokenResult.value) {
    return { value: null, diagnostics: tokenResult.diagnostics };
  }
  const parser = new ExpressionParser(tokenResult.value, line);
  const parsed = parser.parse();
  return {
    value: parsed.value,
    diagnostics: [...tokenResult.diagnostics, ...parsed.diagnostics],
  };
}

const CONTROL_TARGET_SENTINEL = '__control';

/**
 * `loop`/`while` at the head of a statement, allowing whitespace before the
 * `(` and any casing. EEL is whitespace-insensitive and its identifiers are
 * case-insensitive, and the corpus uses both: matching the bare `'loop('`
 * prefix dropped `loop (10000, ...)` — and with it the entire loop body —
 * off the front of 12 shipped presets.
 */
const CONTROL_FLOW_PATTERN = /^(loop|while)\s*\(/iu;

/** True when `source` is a single `loop(...)` or `while(...)` call (possibly
 * trailing a `;`). These lines have no top-level `=`, so the flat-statement
 * parser would otherwise drop them. */
function isControlFlowStatement(source: string) {
  const trimmed = source.trim().replace(/;+\s*$/u, '');
  return CONTROL_FLOW_PATTERN.test(trimmed);
}

/** Returns the text between the outer `(` and its matching `)`, or null when
 * the call does not span the whole source. */
function extractCallInner(source: string): string | null {
  const open = source.indexOf('(');
  if (open < 0) {
    return null;
  }
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(open + 1, i);
      }
    }
  }
  return null;
}

/** Splits `source` on top-level `;` (ignoring those inside parentheses). */
function splitControlBody(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ';' && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  const tail = source.slice(start);
  if (tail.trim()) {
    parts.push(tail);
  }
  return parts;
}

/** Splits `inner` at the first top-level comma into [head, body]. */
function splitControlHeadAndBody(inner: string): [string, string] | null {
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ',' && depth === 0) {
      return [inner.slice(0, i), inner.slice(i + 1)];
    }
  }
  return null;
}

function parseControlFlowStatement(
  source: string,
  line: number,
): ParseResult<MilkdropCompiledStatement> {
  const trimmed = source.trim().replace(/;+\s*$/u, '');
  const isLoop =
    CONTROL_FLOW_PATTERN.exec(trimmed)?.[1]?.toLowerCase() === 'loop';
  const inner = extractCallInner(trimmed);
  if (inner === null) {
    return {
      value: null,
      diagnostics: [
        createDiagnostic(
          line,
          'statement_invalid_target',
          `Unterminated ${isLoop ? 'loop' : 'while'} control statement.`,
        ),
      ],
    };
  }
  const split = splitControlHeadAndBody(inner);
  if (!split) {
    return {
      value: null,
      diagnostics: [
        createDiagnostic(
          line,
          'statement_invalid_target',
          `Malformed ${isLoop ? 'loop' : 'while'} control statement.`,
        ),
      ],
    };
  }
  const [headSource, bodySource] = split;
  const headResult = parseMilkdropExpression(headSource.trim(), line);
  if (!headResult.value) {
    return {
      value: null,
      diagnostics: headResult.diagnostics,
    };
  }

  const body: MilkdropCompiledStatement[] = [];
  const diagnostics: MilkdropDiagnostic[] = [...headResult.diagnostics];
  for (const part of splitControlBody(bodySource)) {
    const sub = parseMilkdropStatement(part.trim(), line);
    diagnostics.push(...sub.diagnostics);
    if (sub.value) {
      body.push(sub.value);
    }
  }

  if (body.length === 0) {
    return { value: null, diagnostics };
  }

  const control: MilkdropControlFlowStatement = isLoop
    ? { kind: 'loop', count: headResult.value, body }
    : { kind: 'while', condition: headResult.value, body };

  return {
    value: {
      target: CONTROL_TARGET_SENTINEL,
      expression: headResult.value,
      line,
      source,
      control,
    },
    diagnostics,
  };
}

export function parseMilkdropStatement(
  source: string,
  line: number,
): ParseResult<MilkdropCompiledStatement> {
  if (isControlFlowStatement(source)) {
    return parseControlFlowStatement(source, line);
  }

  const { index, operator } = findAssignmentIndex(source);

  // Skip empty or missing assignments — common in .milk preset files with
  // blank per-frame/per-pixel lines used as visual spacing between blocks
  if (index < 0) {
    // Try parsing as an expression statement (handles `if(cond, a=1, b=2)`)
    // where there's no top-level `=` but assignments are nested inside
    const trimmed = source.trim().replace(/;+\s*$/u, '');
    if (trimmed.length === 0) {
      return { value: null, diagnostics: [] };
    }
    const exprResult = parseMilkdropExpression(trimmed, line);
    if (!exprResult.value) {
      // Report, don't swallow. Dropping the diagnostics here made every
      // unparseable statement without a top-level `=` disappear in total
      // silence — no error, no warning, just a preset quietly missing an
      // equation. That is how the `loop (` and `+=` gaps above survived a
      // corpus that otherwise compiles with zero errors.
      return { value: null, diagnostics: exprResult.diagnostics };
    }
    // Accept any valid expression as an expression statement
    return {
      value: {
        target: CONTROL_TARGET_SENTINEL,
        expression: exprResult.value,
        line,
        source,
      },
      diagnostics: exprResult.diagnostics,
    };
  }

  const rawValueSource = source.slice(index + operator.length).trim();
  if (!rawValueSource) {
    return { value: null, diagnostics: [] };
  }

  const target = source.slice(0, index).trim();
  // `x += v` is `x = x + (v)`. Parenthesising the value keeps the compound
  // operator's precedence: without it `x *= a + b` would become `x = x * a + b`.
  const expressionSource =
    operator === '='
      ? rawValueSource
      : `${target} ${operator[0]} (${rawValueSource})`;
  const megabufTarget = target.match(/^(g?megabuf)\((.+)\)$/iu);

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(target) && !megabufTarget) {
    return {
      value: null,
      diagnostics: [
        createDiagnostic(
          line,
          'statement_invalid_target',
          `Invalid assignment target "${target}".`,
        ),
      ],
    };
  }

  const expressionResult = parseMilkdropExpression(expressionSource, line);
  if (!expressionResult.value) {
    return {
      value: null,
      diagnostics: expressionResult.diagnostics,
    };
  }

  const targetExpression = megabufTarget
    ? parseMilkdropExpression(megabufTarget[2] ?? '0', line)
    : null;
  if (megabufTarget && targetExpression && !targetExpression.value) {
    return {
      value: null,
      diagnostics: targetExpression.diagnostics,
    };
  }

  return {
    value: {
      target: megabufTarget
        ? (megabufTarget[1] as string).toLowerCase()
        : target,
      ...(targetExpression?.value
        ? { targetExpression: targetExpression.value }
        : {}),
      expression: expressionResult.value,
      line,
      source,
    },
    diagnostics: [
      ...expressionResult.diagnostics,
      ...(targetExpression?.diagnostics ?? []),
    ],
  };
}

export function walkMilkdropExpression(
  node: MilkdropExpressionNode,
  visitor: (node: MilkdropExpressionNode) => void,
) {
  visitor(node);
  switch (node.type) {
    case 'literal':
    case 'identifier':
      return;
    case 'unary':
      walkMilkdropExpression(node.operand, visitor);
      return;
    case 'binary':
      walkMilkdropExpression(node.left, visitor);
      walkMilkdropExpression(node.right, visitor);
      return;
    case 'call':
      node.args.forEach((arg) => walkMilkdropExpression(arg, visitor));
  }
}
