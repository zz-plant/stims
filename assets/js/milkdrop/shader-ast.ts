import { evaluateMilkdropExpression } from './expression';
import { normalizeMilkdropShaderSamplerName } from './shader-samplers';
import type {
  MilkdropExpressionNode,
  MilkdropShaderExpressionNode,
  MilkdropShaderStatement,
  MilkdropShaderTextureSampler,
} from './types';

type Token =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'comma' }
  | { type: 'dot' }
  | { type: 'eof' };

type ShaderValue =
  | { kind: 'scalar'; value: number }
  | { kind: 'vec2'; value: [number, number] }
  | { kind: 'vec3'; value: [number, number, number] }
  | {
      kind: 'sample';
      source: MilkdropShaderTextureSampler | 'main' | null;
      uv: ShaderValue;
    };

function normalizeShaderSamplerName(value: string) {
  return normalizeMilkdropShaderSamplerName(value);
}

const operatorTokens = ['<=', '>=', '==', '!=', '&&', '||'];

function isIdentifierStart(char: string) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string) {
  return /[A-Za-z0-9_]/.test(char);
}

function tokenize(source: string) {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const current = source[index];
    if (!current) {
      break;
    }
    if (/\s/u.test(current)) {
      index += 1;
      continue;
    }

    const twoChar = source.slice(index, index + 2);
    if (operatorTokens.includes(twoChar)) {
      tokens.push({ type: 'operator', value: twoChar });
      index += 2;
      continue;
    }

    if ('+-*/%^<>!='.includes(current)) {
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
      tokens.push({ type: 'comma' });
      index += 1;
      continue;
    }

    if (current === '.') {
      tokens.push({ type: 'dot' });
      index += 1;
      continue;
    }

    if (/[0-9.]/u.test(current)) {
      let end = index + 1;
      while (end < source.length && /[0-9._]/u.test(source[end] ?? '')) {
        end += 1;
      }
      tokens.push({
        type: 'number',
        value: Number.parseFloat(source.slice(index, end).replace(/_/gu, '')),
      });
      index = end;
      continue;
    }

    if (isIdentifierStart(current)) {
      let end = index + 1;
      while (end < source.length && isIdentifierPart(source[end] ?? '')) {
        end += 1;
      }
      tokens.push({
        type: 'identifier',
        value: source.slice(index, end),
      });
      index = end;
      continue;
    }

    return null;
  }

  tokens.push({ type: 'eof' });
  return tokens;
}

class ShaderExpressionParser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse() {
    const expression = this.parseTerm();
    return this.peek().type === 'eof' ? expression : null;
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

  private isParen(value: '(' | ')') {
    const token = this.peek();
    return token.type === 'paren' && token.value === value;
  }

  private parseTerm(): MilkdropShaderExpressionNode | null {
    let node = this.parseFactor();
    if (!node) {
      return null;
    }
    while (true) {
      const operator = this.matchOperator('+', '-');
      if (!operator) {
        return node;
      }
      const right = this.parseFactor();
      if (!right) {
        return null;
      }
      node = {
        type: 'binary',
        operator: operator as '+' | '-',
        left: node,
        right,
      };
    }
  }

  private parseFactor(): MilkdropShaderExpressionNode | null {
    let node = this.parseUnary();
    if (!node) {
      return null;
    }
    while (true) {
      const operator = this.matchOperator('*', '/');
      if (!operator) {
        return node;
      }
      const right = this.parseUnary();
      if (!right) {
        return null;
      }
      node = {
        type: 'binary',
        operator: operator as '*' | '/',
        left: node,
        right,
      };
    }
  }

  private parseUnary(): MilkdropShaderExpressionNode | null {
    const operator = this.matchOperator('+', '-');
    if (operator) {
      const operand = this.parseUnary();
      if (!operand) {
        return null;
      }
      return {
        type: 'unary',
        operator: operator as '+' | '-',
        operand,
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): MilkdropShaderExpressionNode | null {
    const token = this.advance();
    if (token.type === 'number') {
      return { type: 'literal', value: token.value };
    }

    if (token.type === 'identifier') {
      let base: MilkdropShaderExpressionNode;
      if (this.isParen('(')) {
        this.advance();
        const args: MilkdropShaderExpressionNode[] = [];
        while (!this.isParen(')')) {
          const arg = this.parseTerm();
          if (!arg) {
            return null;
          }
          args.push(arg);
          if (this.peek().type === 'comma') {
            this.advance();
            continue;
          }
          if (this.isParen(')')) {
            break;
          }
          return null;
        }
        this.advance();
        base = { type: 'call', name: token.value, args };
      } else {
        base = { type: 'identifier', name: token.value };
      }

      while (this.peek().type === 'dot') {
        this.advance();
        const member = this.advance();
        if (member.type !== 'identifier') {
          return null;
        }
        base = {
          type: 'member',
          object: base,
          property: member.value,
        };
      }
      return base;
    }

    if (token.type === 'paren' && token.value === '(') {
      const expression = this.parseTerm();
      if (!expression) {
        return null;
      }
      const closing = this.advance();
      if (closing.type !== 'paren' || closing.value !== ')') {
        return null;
      }
      return expression;
    }

    return null;
  }
}

export function parseMilkdropShaderStatement(
  line: string,
): MilkdropShaderStatement | null {
  const assignment = line.match(
    /^(?:(const|float|vec2|vec3)\s+)?([a-z_][a-z0-9_]*)\s*(=|\+=|-=|\*=|\/=)\s*(.+)$/iu,
  );
  if (!assignment) {
    return null;
  }
  const expressionTokens = tokenize(assignment[4] ?? '');
  if (!expressionTokens) {
    return null;
  }
  const expression = new ShaderExpressionParser(expressionTokens).parse();
  if (!expression) {
    return null;
  }
  return {
    declaration:
      (assignment[1]?.toLowerCase() as
        | 'const'
        | 'float'
        | 'vec2'
        | 'vec3'
        | undefined) ?? null,
    target: assignment[2]?.toLowerCase() ?? '',
    operator: (assignment[3] ?? '=') as '=' | '+=' | '-=' | '*=' | '/=',
    rawValue: assignment[4]?.trim() ?? '',
    expression,
    source: line,
  };
}

function scalar(value: number): ShaderValue {
  return { kind: 'scalar', value };
}

function vec2(x: number, y: number): ShaderValue {
  return { kind: 'vec2', value: [x, y] };
}

function vec3(r: number, g: number, b: number): ShaderValue {
  return { kind: 'vec3', value: [r, g, b] };
}

function isScalar(
  value: ShaderValue,
): value is { kind: 'scalar'; value: number } {
  return value.kind === 'scalar';
}

function isVec2(
  value: ShaderValue,
): value is { kind: 'vec2'; value: [number, number] } {
  return value.kind === 'vec2';
}

function isVec3(
  value: ShaderValue,
): value is { kind: 'vec3'; value: [number, number, number] } {
  return value.kind === 'vec3';
}

function applyBinary(
  operator: '+' | '-' | '*' | '/',
  left: ShaderValue,
  right: ShaderValue,
) {
  const applyScalar = (a: number, b: number) =>
    operator === '+'
      ? a + b
      : operator === '-'
        ? a - b
        : operator === '*'
          ? a * b
          : b === 0
            ? 0
            : a / b;

  if (isScalar(left) && isScalar(right)) {
    return scalar(applyScalar(left.value, right.value));
  }
  if (isVec2(left) && isVec2(right)) {
    return vec2(
      applyScalar(left.value[0], right.value[0]),
      applyScalar(left.value[1], right.value[1]),
    );
  }
  if (isVec3(left) && isVec3(right)) {
    return vec3(
      applyScalar(left.value[0], right.value[0]),
      applyScalar(left.value[1], right.value[1]),
      applyScalar(left.value[2], right.value[2]),
    );
  }
  if (isVec2(left) && isScalar(right)) {
    return vec2(
      applyScalar(left.value[0], right.value),
      applyScalar(left.value[1], right.value),
    );
  }
  if (isVec3(left) && isScalar(right)) {
    return vec3(
      applyScalar(left.value[0], right.value),
      applyScalar(left.value[1], right.value),
      applyScalar(left.value[2], right.value),
    );
  }
  if (isScalar(left) && isVec2(right)) {
    return vec2(
      applyScalar(left.value, right.value[0]),
      applyScalar(left.value, right.value[1]),
    );
  }
  if (isScalar(left) && isVec3(right)) {
    return vec3(
      applyScalar(left.value, right.value[0]),
      applyScalar(left.value, right.value[1]),
      applyScalar(left.value, right.value[2]),
    );
  }
  return null;
}

function toScalarMilkdropExpression(
  node: MilkdropShaderExpressionNode,
): MilkdropExpressionNode | null {
  switch (node.type) {
    case 'literal':
      return { type: 'literal', value: node.value };
    case 'identifier':
      return { type: 'identifier', name: node.name.toLowerCase() };
    case 'unary': {
      const operand = toScalarMilkdropExpression(node.operand);
      if (!operand) {
        return null;
      }
      return {
        type: 'unary',
        operator: node.operator,
        operand,
      };
    }
    case 'binary': {
      const left = toScalarMilkdropExpression(node.left);
      const right = toScalarMilkdropExpression(node.right);
      if (!left || !right) {
        return null;
      }
      return {
        type: 'binary',
        operator: node.operator,
        left,
        right,
      };
    }
    case 'call': {
      const name = node.name.toLowerCase();
      if (
        name === 'vec2' ||
        name === 'vec3' ||
        name === 'tex2d' ||
        name === 'texture'
      ) {
        return null;
      }
      const args = node.args
        .map((arg) => toScalarMilkdropExpression(arg))
        .filter((arg): arg is MilkdropExpressionNode => arg !== null);
      if (args.length !== node.args.length) {
        return null;
      }
      return {
        type: 'call',
        name,
        args,
      };
    }
    case 'member':
      return null;
  }
}

export function evaluateMilkdropShaderExpression(
  node: MilkdropShaderExpressionNode,
  env: Record<string, ShaderValue>,
  scalarEnv: Record<string, number>,
): ShaderValue | null {
  switch (node.type) {
    case 'literal':
      return scalar(node.value);
    case 'identifier':
      if (node.name.toLowerCase() === 'pi') {
        return scalar(Math.PI);
      }
      if (node.name.toLowerCase() === 'e') {
        return scalar(Math.E);
      }
      return (
        env[node.name] ??
        env[node.name.toLowerCase()] ??
        scalar(scalarEnv[node.name] ?? scalarEnv[node.name.toLowerCase()] ?? 0)
      );
    case 'unary': {
      const operand = evaluateMilkdropShaderExpression(
        node.operand,
        env,
        scalarEnv,
      );
      if (!operand) {
        return null;
      }
      if (node.operator === '+') {
        return operand;
      }
      return applyBinary('*', scalar(-1), operand);
    }
    case 'binary': {
      const left = evaluateMilkdropShaderExpression(node.left, env, scalarEnv);
      const right = evaluateMilkdropShaderExpression(
        node.right,
        env,
        scalarEnv,
      );
      if (!left || !right) {
        return null;
      }
      return applyBinary(node.operator, left, right);
    }
    case 'call': {
      const args = node.args
        .map((arg) => evaluateMilkdropShaderExpression(arg, env, scalarEnv))
        .filter((value): value is ShaderValue => value !== null);
      if (args.length !== node.args.length) {
        return null;
      }
      const name = node.name.toLowerCase();
      if (
        name === 'vec2' &&
        args.length >= 2 &&
        isScalar(args[0]) &&
        isScalar(args[1])
      ) {
        return vec2(args[0].value, args[1].value);
      }
      if (
        name === 'vec3' &&
        args.length >= 3 &&
        isScalar(args[0]) &&
        isScalar(args[1]) &&
        isScalar(args[2])
      ) {
        return vec3(args[0].value, args[1].value, args[2].value);
      }
      if ((name === 'tex2d' || name === 'texture') && args.length >= 2) {
        const samplerArg = node.args[0];
        const source =
          samplerArg?.type === 'identifier'
            ? normalizeShaderSamplerName(samplerArg.name)
            : 'main';
        return { kind: 'sample', source, uv: args[1] };
      }
      if (name === 'mix' && args.length >= 3 && isScalar(args[2])) {
        const blend = args[2].value;
        const left = args[0];
        const right = args[1];
        if (isScalar(left) && isScalar(right)) {
          return scalar(left.value + (right.value - left.value) * blend);
        }
        if (isVec3(left) && isVec3(right)) {
          return vec3(
            left.value[0] + (right.value[0] - left.value[0]) * blend,
            left.value[1] + (right.value[1] - left.value[1]) * blend,
            left.value[2] + (right.value[2] - left.value[2]) * blend,
          );
        }
      }
      if (name === 'abs' && args.length >= 1) {
        const value = args[0];
        if (isScalar(value)) {
          return scalar(Math.abs(value.value));
        }
        if (isVec3(value)) {
          return vec3(
            Math.abs(value.value[0]),
            Math.abs(value.value[1]),
            Math.abs(value.value[2]),
          );
        }
      }
      if (name === 'pow' && args.length >= 2) {
        const left = args[0];
        const right = args[1];
        if (isScalar(left) && isScalar(right)) {
          return scalar(left.value ** right.value);
        }
        if (isVec3(left) && isScalar(right)) {
          return vec3(
            left.value[0] ** right.value,
            left.value[1] ** right.value,
            left.value[2] ** right.value,
          );
        }
        if (isVec3(left) && isVec3(right)) {
          return vec3(
            left.value[0] ** right.value[0],
            left.value[1] ** right.value[1],
            left.value[2] ** right.value[2],
          );
        }
      }
      const scalarExpression = toScalarMilkdropExpression(node);
      if (scalarExpression) {
        return scalar(evaluateMilkdropExpression(scalarExpression, scalarEnv));
      }
      return null;
    }
    case 'member': {
      const object = evaluateMilkdropShaderExpression(
        node.object,
        env,
        scalarEnv,
      );
      if (!object) {
        return null;
      }
      const property = node.property.toLowerCase();
      if (object.kind === 'sample' && property === 'rgb') {
        return vec3(1, 1, 1);
      }
      if (isVec2(object)) {
        return property === 'x'
          ? scalar(object.value[0])
          : property === 'y'
            ? scalar(object.value[1])
            : null;
      }
      if (isVec3(object)) {
        return property === 'r' || property === 'x'
          ? scalar(object.value[0])
          : property === 'g' || property === 'y'
            ? scalar(object.value[1])
            : property === 'b' || property === 'z'
              ? scalar(object.value[2])
              : null;
      }
      return null;
    }
  }
}
