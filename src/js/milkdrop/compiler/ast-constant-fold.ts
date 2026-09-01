/**
 * AST Constant Folding & Algebraic Simplification Pass
 *
 * Performs compile-time optimizations over EEL2 expression trees before
 * JIT/WGSL code emission:
 *
 * - **Literal folding:** `2 * 3.14159265` → `6.2831853`
 * - **Pure intrinsic folding:** `sqrt(4)` → `2`, `abs(-1.5)` → `1.5`
 * - **Identity reduction:** `x + 0` → `x`, `x * 1` → `x`, `x * 0` → `0`
 *
 * Operates on `MilkdropExpressionNode` trees produced by the EEL2 parser.
 * Must not mutate the original tree — returns a new (or the same) node.
 *
 * The pass is idempotent and can be applied to both per-frame and per-pixel
 * program blocks. It does NOT evaluate expressions that reference runtime
 * state (variables, signal fields, registers, rand, megabuf/gmegabuf) —
 * only fully-static subexpressions are folded.
 */

import type { MilkdropExpressionNode } from '../types';
import { finiteOrZero, toMilkdropInt } from './eel-function-table.ts';

/**
 * Set of EEL function names that are pure (deterministic, no side effects,
 * output depends only on argument values). A call to any of these with all-
 * literal arguments can be folded at compile time.
 */
const PURE_FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'abs',
  'sqrt',
  'invsqrt',
  'pow',
  'mod',
  'fmod',
  'min',
  'max',
  'mix',
  'lerp',
  'floor',
  'ceil',
  'int',
  'sqr',
  'clamp',
  'step',
  'smoothstep',
  'log',
  'log10',
  'exp',
  'sigmoid',
  'sign',
  'equal',
  'above',
  'below',
  'qurgb',
  'midrgb',
  'bassrgb',
  'trebrgb',
  'qairgb',
  'midiarbg',
  'bassiarbg',
  'trebiarbg',
  'radical',
  'cbrt',
  'trunc',
  'frac',
]);

function isAllLiterals(args: readonly MilkdropExpressionNode[]): boolean {
  return args.every((a) => a.type === 'literal');
}

/** Try to evaluate a pure function call with literal arguments. */
function tryFoldFunction(
  name: string,
  args: readonly MilkdropExpressionNode[],
): number | null {
  const values = args.map((a) => (a.type === 'literal' ? a.value : NaN));
  if (values.some((v) => !Number.isFinite(v))) return null;

  switch (name) {
    case 'sin':
      return Math.sin(values[0]);
    case 'cos':
      return Math.cos(values[0]);
    case 'tan':
      return Math.tan(values[0]);
    case 'asin':
      return Math.asin(Math.min(1, Math.max(-1, values[0])));
    case 'acos':
      return Math.acos(Math.min(1, Math.max(-1, values[0])));
    case 'atan':
      return Math.atan(values[0]);
    case 'abs':
      return Math.abs(values[0]);
    case 'sqrt':
      return Math.sqrt(Math.max(0, values[0]));
    case 'invsqrt':
      return finiteOrZero(1 / Math.sqrt(Math.max(0, values[0])));
    case 'pow':
      return finiteOrZero(values[0] ** values[1]);
    case 'mod':
    case 'fmod':
      return values[1] === 0 ? 0 : values[0] % values[1];
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'mix':
    case 'lerp':
      return values[0] + (values[1] - values[0]) * values[2];
    case 'floor':
      return Math.floor(values[0]);
    case 'ceil':
      return Math.ceil(values[0]);
    case 'int':
      return toMilkdropInt(values[0]);
    case 'trunc':
      return toMilkdropInt(values[0]);
    case 'frac':
      return values[0] - Math.trunc(values[0]);
    case 'sqr':
      return values[0] * values[0];
    case 'cbrt':
      return Math.cbrt(values[0]);
    case 'clamp':
      return Math.min(Math.max(values[0], values[1]), values[2]);
    case 'step':
      return values[1] < values[0] ? 0 : 1;
    case 'smoothstep': {
      const [edge0, edge1, value] = values;
      if (edge0 === edge1) return value < edge0 ? 0 : 1;
      const t = Math.min(Math.max((value - edge0) / (edge1 - edge0), 0), 1);
      return t * t * (3 - 2 * t);
    }
    case 'log':
      return finiteOrZero(Math.log(Math.max(0, values[0])));
    case 'log10':
      return finiteOrZero(Math.log10(Math.max(0, values[0])));
    case 'exp':
      return Math.exp(values[0]);
    case 'sigmoid':
      return 1 / (1 + Math.exp(-values[0] * (values[1] ?? 1)));
    case 'sign':
      return Math.sign(values[0]) || 0;
    case 'equal':
      return Math.abs(values[0] - values[1]) < 0.00001 ? 1 : 0;
    case 'above':
      return values[0] > values[1] ? 1 : 0;
    case 'below':
      return values[0] < values[1] ? 1 : 0;
    case 'radical':
      return finiteOrZero(Math.abs(values[0]) ** (1 / Math.max(0, values[1])));
    default:
      return null;
  }
}

function foldUnary(
  operator: string,
  operand: MilkdropExpressionNode,
): MilkdropExpressionNode {
  if (operand.type === 'literal') {
    const result =
      operator === '+'
        ? operand.value
        : operator === '-'
          ? -operand.value
          : operator === '!'
            ? Math.abs(operand.value) > 0.00001
              ? 0
              : 1
            : null;
    if (result !== null) {
      return { type: 'literal', value: finiteOrZero(result) };
    }
  }
  return { type: 'unary', operator: operator as '+' | '-' | '!', operand };
}

function foldBinary(
  operator: string,
  left: MilkdropExpressionNode,
  right: MilkdropExpressionNode,
): MilkdropExpressionNode | null {
  // Both operands are literals → fold directly
  if (left.type === 'literal' && right.type === 'literal') {
    const l = left.value;
    const r = right.value;
    let result: number | null = null;
    switch (operator) {
      case '+':
        result = l + r;
        break;
      case '-':
        result = l - r;
        break;
      case '*':
        result = l * r;
        break;
      case '/':
        result = r === 0 ? 0 : l / r;
        break;
      case '%': {
        const li = toMilkdropInt(l);
        const ri = toMilkdropInt(r);
        result = ri === 0 ? 0 : li % ri;
        break;
      }
      case '^':
        result = finiteOrZero(l ** r);
        break;
      case '|':
        result = toMilkdropInt(l) | toMilkdropInt(r);
        break;
      case '&':
        result = toMilkdropInt(l) & toMilkdropInt(r);
        break;
      case '<':
        result = l < r ? 1 : 0;
        break;
      case '<=':
        result = l <= r ? 1 : 0;
        break;
      case '>':
        result = l > r ? 1 : 0;
        break;
      case '>=':
        result = l >= r ? 1 : 0;
        break;
      case '==':
        result = l === r ? 1 : 0;
        break;
      case '!=':
        result = l !== r ? 1 : 0;
        break;
      case '&&':
        result = Math.abs(l) > 0.00001 && Math.abs(r) > 0.00001 ? 1 : 0;
        break;
      case '||':
        result = Math.abs(l) > 0.00001 || Math.abs(r) > 0.00001 ? 1 : 0;
        break;
    }
    if (result !== null) {
      return { type: 'literal', value: finiteOrZero(result) };
    }
  }

  // Algebraic identities (one operand is literal)
  if (right.type === 'literal') {
    const r = right.value;
    switch (operator) {
      case '+':
        // x + 0 → x
        if (r === 0) return left;
        break;
      case '-':
        // x - 0 → x
        if (r === 0) return left;
        break;
      case '*':
        // x * 0 → 0
        if (r === 0) return { type: 'literal', value: 0 };
        // x * 1 → x
        if (r === 1) return left;
        break;
      case '/':
        // x / 1 → x
        if (r === 1) return left;
        break;
      case '^':
        // x ^ 0 → 1
        if (r === 0) return { type: 'literal', value: 1 };
        // x ^ 1 → x
        if (r === 1) return left;
        break;
    }
  }

  if (left.type === 'literal') {
    const l = left.value;
    switch (operator) {
      case '+':
        // 0 + x → x
        if (l === 0) return right;
        break;
      case '-':
        // 0 - x → -x
        if (l === 0)
          return {
            type: 'unary',
            operator: '-',
            operand: right,
          };
        break;
      case '*':
        // 0 * x → 0
        if (l === 0) return { type: 'literal', value: 0 };
        // 1 * x → x
        if (l === 1) return right;
        break;
      case '^':
        // 0 ^ x → 0 (except 0^0=1)
        if (l === 0) {
          if (right.type === 'literal' && right.value === 0)
            return { type: 'literal', value: 1 };
          return { type: 'literal', value: 0 };
        }
        // 1 ^ x → 1
        if (l === 1) return { type: 'literal', value: 1 };
        break;
    }
  }

  return null;
}

const EMPTY_NAMES: ReadonlySet<string> = new Set<string>();

/**
 * Names the program writes to, lowercased. A written name is never treated as
 * a compile-time constant, because a later read of it must see the assigned
 * value rather than the builtin one.
 *
 * Deliberately flow-insensitive: a single assignment anywhere in the block
 * (including inside a loop or conditional body) disqualifies the name for the
 * whole block. Reads that precede the first write lose a fold they could have
 * kept; nothing loses correctness.
 */
export function collectAssignedNames(
  statements: readonly import('../types').MilkdropCompiledStatement[],
  inherited: ReadonlySet<string> = EMPTY_NAMES,
): ReadonlySet<string> {
  const names = new Set<string>(inherited);
  const visitExpression = (node: MilkdropExpressionNode): void => {
    switch (node.type) {
      case 'binary':
        if (node.operator === '=' && node.left.type === 'identifier') {
          names.add(node.left.name.toLowerCase());
        }
        visitExpression(node.left);
        visitExpression(node.right);
        return;
      case 'unary':
        visitExpression(node.operand);
        return;
      case 'call':
        node.args.forEach(visitExpression);
        return;
      default:
    }
  };
  const visitStatement = (
    stmt: import('../types').MilkdropCompiledStatement,
  ): void => {
    if (stmt.control) {
      if (stmt.control.count) visitExpression(stmt.control.count);
      if (stmt.control.condition) visitExpression(stmt.control.condition);
      stmt.control.body.forEach(visitStatement);
      return;
    }
    names.add(stmt.target.toLowerCase());
    if (stmt.targetExpression) visitExpression(stmt.targetExpression);
    visitExpression(stmt.expression);
  };
  statements.forEach(visitStatement);
  return names;
}

/**
 * Recursively fold an expression tree. Returns a (possibly simplified) node.
 * Does not mutate the input.
 */
export function foldExpression(
  node: MilkdropExpressionNode,
  shadowed: ReadonlySet<string> = EMPTY_NAMES,
): MilkdropExpressionNode {
  switch (node.type) {
    case 'literal':
      return node;

    case 'identifier': {
      const name = node.name.toLowerCase();
      // Resolve known constants inline — but only while the preset leaves
      // them alone. MilkDrop lets a program assign `pi`/`e` like any other
      // variable, and presets do (`per_pixel_1=pi=3.14159;`). Inlining the
      // builtin value there would silently ignore the override.
      if (shadowed.has(name)) return node;
      if (name === 'pi') return { type: 'literal', value: Math.PI };
      if (name === 'e') return { type: 'literal', value: Math.E };
      return node;
    }

    case 'unary': {
      const operand = foldExpression(node.operand, shadowed);
      const simplified = foldUnary(node.operator, operand);
      return simplified;
    }

    case 'binary': {
      // Do not fold assignment operators — they have side effects
      if (node.operator === '=') {
        const left = foldExpression(node.left, shadowed);
        const right = foldExpression(node.right, shadowed);
        return { type: 'binary', operator: '=', left, right };
      }

      const left = foldExpression(node.left, shadowed);
      const right = foldExpression(node.right, shadowed);
      const folded = foldBinary(node.operator, left, right);
      if (folded) return folded;
      return { type: 'binary', operator: node.operator, left, right };
    }

    case 'call': {
      const name = node.name.toLowerCase();
      const args = node.args.map((arg) => foldExpression(arg, shadowed));

      // Fold pure functions with all-literal args
      if (PURE_FUNCTIONS.has(name) && isAllLiterals(args)) {
        const result = tryFoldFunction(name, args);
        if (result !== null) {
          return { type: 'literal', value: finiteOrZero(result) };
        }
      }

      return { type: 'call', name: node.name, args };
    }
  }
}

/**
 * Fold all expressions in a compiled statement (including the target
 * expression for buffer stores and control-flow sub-statements).
 */
export function foldStatement(
  stmt: import('../types').MilkdropCompiledStatement,
  shadowed: ReadonlySet<string> = EMPTY_NAMES,
): import('../types').MilkdropCompiledStatement {
  const expression = foldExpression(stmt.expression, shadowed);
  const targetExpression = stmt.targetExpression
    ? foldExpression(stmt.targetExpression, shadowed)
    : undefined;
  const control = stmt.control
    ? foldControlFlow(stmt.control, shadowed)
    : undefined;

  if (
    expression === stmt.expression &&
    targetExpression === stmt.targetExpression &&
    control === stmt.control
  ) {
    return stmt;
  }

  return {
    ...stmt,
    expression,
    targetExpression,
    control,
  };
}

function foldControlFlow(
  control: import('../types').MilkdropControlFlowStatement,
  shadowed: ReadonlySet<string> = EMPTY_NAMES,
): import('../types').MilkdropControlFlowStatement {
  const count = control.count
    ? foldExpression(control.count, shadowed)
    : undefined;
  const condition = control.condition
    ? foldExpression(control.condition, shadowed)
    : undefined;
  const body = control.body.map((stmt) => foldStatement(stmt, shadowed));

  if (
    count === control.count &&
    condition === control.condition &&
    body === control.body
  ) {
    return control;
  }

  return { ...control, count, condition, body };
}

/**
 * Fold all expressions in a program block. Returns a new block with simplified
 * expressions; the original is not mutated.
 */
export function foldProgramBlock(
  block: import('../types').MilkdropProgramBlock,
  shadowed: ReadonlySet<string> = EMPTY_NAMES,
): import('../types').MilkdropProgramBlock {
  const blockShadowed = collectAssignedNames(block.statements, shadowed);
  const statements = block.statements.map((stmt) =>
    foldStatement(stmt, blockShadowed),
  );
  if (statements.every((stmt, index) => stmt === block.statements[index])) {
    return block;
  }
  return { ...block, statements };
}
