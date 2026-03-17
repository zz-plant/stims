import type {
  MilkdropCompiledStatement,
  MilkdropDiagnostic,
  MilkdropExpressionNode,
} from './types';

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

function toMilkdropInt(value: number) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function createDiagnostic(
  line: number,
  code: string,
  message: string,
): MilkdropDiagnostic {
  return { severity: 'error', line, code, message };
}

function isIdentifierStart(char: string) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string) {
  return /[A-Za-z0-9_]/.test(char);
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

    if ('+-*/%^<>!|&'.includes(current)) {
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
      let end = index + 1;
      while (end < source.length && /[0-9._]/.test(source[end])) {
        end += 1;
      }
      const rawValue = source.slice(index, end).split('_').join('');
      const parsedValue = Number.parseFloat(rawValue);
      if (!Number.isFinite(parsedValue)) {
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
    const value = this.parseLogicalOr();
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
          args.push(this.parseLogicalOr());
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
      const expression = this.parseLogicalOr();
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
      return env[node.name] ?? env[normalized] ?? 0;
    }
    case 'unary': {
      const value = evaluateMilkdropExpression(node.operand, env, helpers);
      switch (node.operator) {
        case '+':
          return value;
        case '-':
          return -value;
        case '!':
          return value === 0 ? 1 : 0;
      }
      return 0;
    }
    case 'binary': {
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
        case '^':
          return left ** right;
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
          return left !== 0 && right !== 0 ? 1 : 0;
        case '||':
          return left !== 0 || right !== 0 ? 1 : 0;
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
        case 'pow':
          return (args[0] ?? 0) ** (args[1] ?? 0);
        case 'min':
          return Math.min(...args);
        case 'max':
          return Math.max(...args);
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
        case 'log':
          return Math.log(Math.max(0.000001, args[0] ?? 0));
        case 'exp':
          return Math.exp(args[0] ?? 0);
        case 'sign':
          return Math.sign(args[0] ?? 0);
        case 'bor':
          return toMilkdropInt(args[0] ?? 0) | toMilkdropInt(args[1] ?? 0);
        case 'band':
          return toMilkdropInt(args[0] ?? 0) & toMilkdropInt(args[1] ?? 0);
        case 'bnot':
          return ~toMilkdropInt(args[0] ?? 0);
        case 'atan2':
          return Math.atan2(args[0] ?? 0, args[1] ?? 0);
        case 'frac': {
          const value = args[0] ?? 0;
          return value - Math.floor(value);
        }
        case 'if':
          return (args[0] ?? 0) !== 0 ? (args[1] ?? 0) : (args[2] ?? 0);
        case 'above':
          return (args[0] ?? 0) > (args[1] ?? 0) ? 1 : 0;
        case 'below':
          return (args[0] ?? 0) < (args[1] ?? 0) ? 1 : 0;
        case 'equal':
          return (args[0] ?? 0) === (args[1] ?? 0) ? 1 : 0;
        case 'rand':
          return (helpers.nextRandom?.() ?? 0.5) * (args[0] ?? 1);
        default:
          return 0;
      }
    }
  }
}

export function splitMilkdropStatements(source: string) {
  const statements: string[] = [];
  let current = '';
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    }

    if (char === ';' && depth === 0) {
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

export function parseMilkdropStatement(
  source: string,
  line: number,
): ParseResult<MilkdropCompiledStatement> {
  const index = findAssignmentIndex(source);
  if (index < 0) {
    return {
      value: null,
      diagnostics: [
        createDiagnostic(
          line,
          'statement_missing_assignment',
          'Expected a variable assignment.',
        ),
      ],
    };
  }

  const target = source.slice(0, index).trim();
  const expressionSource = source.slice(index + 1).trim();

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(target)) {
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

  return {
    value: {
      target,
      expression: expressionResult.value,
      line,
      source,
    },
    diagnostics: expressionResult.diagnostics,
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
