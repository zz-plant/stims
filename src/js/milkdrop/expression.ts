import {
  MILKDROP_INTRINSIC_FUNCTION_NAMES,
  MILKDROP_INTRINSIC_IDENTIFIER_NAMES,
} from './builtin-docs';
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
    if (c.toLowerCase() === lower) return c;
    let matches = 0;
    for (let i = 0; i < lower.length; i++) {
      if (c.toLowerCase().includes(lower[i])) matches++;
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

const operatorTokens = ['<=', '>=', '==', '!=', '&&', '||'];

// The names live in `builtin-docs.ts` (the single source of truth shared with
// the editor's highlighter, autocomplete, and hover docs); these sets remain
// the authoritative interface for what the compiler accepts. Every name must
// have a case in `evaluateMilkdropExpression`'s call switch below.
export const MILKDROP_INTRINSIC_IDENTIFIERS = new Set(
  MILKDROP_INTRINSIC_IDENTIFIER_NAMES,
);

export const MILKDROP_INTRINSIC_FUNCTIONS = new Set(
  MILKDROP_INTRINSIC_FUNCTION_NAMES,
);

/** NS-EEL treats values within this distance of zero as false. */
export const MILKDROP_EEL_CLOSE_FACTOR = 0.00001;

function toMilkdropInt(value: number) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

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

    if ('+-*/%^<>!|&='.includes(current)) {
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

class ExpressionParser {
  private readonly tokens: Token[];
  private readonly line: number;
  private readonly diagnostics: MilkdropDiagnostic[] = [];
  private index = 0;

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

  /** Assignment has the lowest precedence and is right-associative, so a=b=c
   * parses as a=(b=c). */
  private parseAssignment(): MilkdropExpressionNode {
    const left = this.parseLogicalOr();
    const operator = this.matchOperator('=');
    if (!operator) {
      return left;
    }
    const right = this.parseAssignment();
    return {
      type: 'binary',
      operator: '=',
      left,
      right,
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

type EvalHelpers = {
  nextRandom?: () => number;
  megabuf?: (index: number) => number;
  gmegabuf?: (index: number) => number;
  megabufWrite?: (index: number, value: number) => void;
  gmegabufWrite?: (index: number, value: number) => void;
};

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
      if (normalized === 'pi') return Math.PI;
      if (normalized === 'e') return Math.E;
      return resolveMilkdropIdentifier(env, node.name) ?? 0;
    }
    case 'unary': {
      const value = evaluateMilkdropExpression(node.operand, env, helpers);
      switch (node.operator) {
        case '+':
          return value;
        case '-':
          return -value;
        case '!':
          return Math.abs(value) > MILKDROP_EEL_CLOSE_FACTOR ? 0 : 1;
      }
      return 0;
    }
    case 'binary': {
      // Assignment is handled specially to allow side effects on LHS
      if (node.operator === '=') {
        const rvalue = evaluateMilkdropExpression(node.right, env, helpers);
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
      const right = evaluateMilkdropExpression(node.right, env, helpers);
      switch (node.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return right === 0 ? 0 : left / right;
        case '%': {
          const leftInt = toMilkdropInt(left);
          const rightInt = toMilkdropInt(right);
          return rightInt === 0 ? 0 : leftInt % rightInt;
        }
        case '^': {
          const res = left ** right;
          return Number.isFinite(res) ? res : 0;
        }
        case '|':
          return toMilkdropInt(left) | toMilkdropInt(right);
        case '&':
          return toMilkdropInt(left) & toMilkdropInt(right);
        case '<':
          return left < right ? 1 : 0;
        case '<=':
          return left <= right ? 1 : 0;
        case '>':
          return left > right ? 1 : 0;
        case '>=':
          return left >= right ? 1 : 0;
        case '==':
          return left === right ? 1 : 0;
        case '!=':
          return left !== right ? 1 : 0;
        case '&&':
          return Math.abs(left) > MILKDROP_EEL_CLOSE_FACTOR &&
            Math.abs(right) > MILKDROP_EEL_CLOSE_FACTOR
            ? 1
            : 0;
        case '||':
          return Math.abs(left) > MILKDROP_EEL_CLOSE_FACTOR ||
            Math.abs(right) > MILKDROP_EEL_CLOSE_FACTOR
            ? 1
            : 0;
      }
      return 0;
    }
    case 'call': {
      const args = node.args.map((arg) =>
        evaluateMilkdropExpression(arg, env, helpers),
      );
      const name = node.name.toLowerCase();
      switch (name) {
        case 'sin':
          return Math.sin(args[0] ?? 0);
        case 'cos':
          return Math.cos(args[0] ?? 0);
        case 'tan':
          return Math.tan(args[0] ?? 0);
        case 'asin':
          return Math.asin(Math.min(1, Math.max(-1, args[0] ?? 0)));
        case 'acos':
          return Math.acos(Math.min(1, Math.max(-1, args[0] ?? 0)));
        case 'atan':
          return Math.atan(args[0] ?? 0);
        case 'abs':
          return Math.abs(args[0] ?? 0);
        case 'sqrt':
          return Math.sqrt(Math.max(0, args[0] ?? 0));
        case 'pow': {
          const res = (args[0] ?? 0) ** (args[1] ?? 0);
          return Number.isFinite(res) ? res : 0;
        }
        case 'mod':
        case 'fmod': {
          const left = args[0] ?? 0;
          const right = args[1] ?? 0;
          return right === 0 ? 0 : left % right;
        }
        case 'min':
          return Math.min(...args);
        case 'max':
          return Math.max(...args);
        case 'mix':
        case 'lerp': {
          const start = args[0] ?? 0;
          const end = args[1] ?? 0;
          const amount = args[2] ?? 0;
          return start + (end - start) * amount;
        }
        case 'floor':
          return Math.floor(args[0] ?? 0);
        case 'int':
          return toMilkdropInt(args[0] ?? 0);
        case 'ceil':
          return Math.ceil(args[0] ?? 0);
        case 'sqr': {
          const value = args[0] ?? 0;
          return value * value;
        }
        case 'clamp':
          return Math.min(Math.max(args[0] ?? 0, args[1] ?? 0), args[2] ?? 1);
        case 'step':
          return (args[1] ?? 0) < (args[0] ?? 0) ? 0 : 1;
        case 'smoothstep': {
          const edge0 = args[0] ?? 0;
          const edge1 = args[1] ?? 1;
          const value = args[2] ?? 0;
          if (edge0 === edge1) {
            return value < edge0 ? 0 : 1;
          }
          const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
          return t * t * (3 - 2 * t);
        }
        case 'log': {
          const res = Math.log(Math.max(0, args[0] ?? 0));
          return Number.isFinite(res) ? res : 0;
        }
        case 'log10': {
          const res = Math.log10(Math.max(0, args[0] ?? 0));
          return Number.isFinite(res) ? res : 0;
        }
        case 'exp':
          return Math.exp(args[0] ?? 0);
        case 'sigmoid': {
          const value = args[0] ?? 0;
          const slope = args[1] ?? 1;
          return 1 / (1 + Math.exp(-value * slope));
        }
        case 'sign':
          return Math.sign(args[0] ?? 0) || 0;
        case 'bor':
          return Math.abs(args[0] ?? 0) > MILKDROP_EEL_CLOSE_FACTOR ||
            Math.abs(args[1] ?? 0) > MILKDROP_EEL_CLOSE_FACTOR
            ? 1
            : 0;
        case 'band':
          return Math.abs(args[0] ?? 0) > MILKDROP_EEL_CLOSE_FACTOR &&
            Math.abs(args[1] ?? 0) > MILKDROP_EEL_CLOSE_FACTOR
            ? 1
            : 0;
        case 'bnot':
          return Math.abs(args[0] ?? 0) > MILKDROP_EEL_CLOSE_FACTOR ? 0 : 1;
        case 'atan2':
          return Math.atan2(args[0] ?? 0, args[1] ?? 0);
        case 'frac': {
          const value = args[0] ?? 0;
          return value - Math.floor(value);
        }
        case 'if':
          return Math.abs(args[0] ?? 0) > MILKDROP_EEL_CLOSE_FACTOR
            ? (args[1] ?? 0)
            : (args[2] ?? 0);
        case 'above':
          return (args[0] ?? 0) > (args[1] ?? 0) ? 1 : 0;
        case 'below':
          return (args[0] ?? 0) < (args[1] ?? 0) ? 1 : 0;
        case 'equal':
          return Math.abs((args[0] ?? 0) - (args[1] ?? 0)) <=
            MILKDROP_EEL_CLOSE_FACTOR
            ? 1
            : 0;
        case 'rand':
          return (helpers.nextRandom?.() ?? 0.5) * (args[0] ?? 1);
        case 'randint':
          return Math.floor((helpers.nextRandom?.() ?? 0.5) * (args[0] ?? 1));
        case 'megabuf':
          return helpers.megabuf?.(args[0] ?? 0) ?? 0;
        case 'gmegabuf':
          return helpers.gmegabuf?.(args[0] ?? 0) ?? 0;
        case 'exec2':
        case 'exec3':
          return args[args.length - 1] ?? 0;
        default:
          return 0;
      }
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

function findAssignmentIndex(source: string) {
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === '=' && depth === 0) {
      return index;
    }
  }
  return -1;
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

const CONTROL_LOOP_PREFIX = 'loop(';
const CONTROL_WHILE_PREFIX = 'while(';
const CONTROL_TARGET_SENTINEL = '__control';

/** True when `source` is a single `loop(...)` or `while(...)` call (possibly
 * trailing a `;`). These lines have no top-level `=`, so the flat-statement
 * parser would otherwise drop them. */
function isControlFlowStatement(source: string) {
  const trimmed = source.trim().replace(/;+\s*$/u, '');
  return (
    trimmed.startsWith(CONTROL_LOOP_PREFIX) ||
    trimmed.startsWith(CONTROL_WHILE_PREFIX)
  );
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
  const isLoop = trimmed.startsWith(CONTROL_LOOP_PREFIX);
  const inner = extractCallInner(trimmed);
  if (inner === null) {
    return { value: null, diagnostics: [] };
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

  const index = findAssignmentIndex(source);

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
      return { value: null, diagnostics: [] };
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

  if (!source.slice(index + 1).trim()) {
    return { value: null, diagnostics: [] };
  }

  const target = source.slice(0, index).trim();
  const expressionSource = source.slice(index + 1).trim();
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
