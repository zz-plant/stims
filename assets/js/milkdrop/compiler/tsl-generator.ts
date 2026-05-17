/**
 * Compiles MilkDrop expression trees to TSL (Three.js Shading Language) nodes.
 * Used by the WebGPU feedback compositor to execute per-pixel equations
 * directly in the fragment shader instead of on the CPU.
 */
import type { MilkdropExpressionNode } from '../types';

const TSL_IDENTIFIER_MAP = new Map<string, string>([
  ['pi', '3.141592653589793'],
  ['e', '2.718281828459045'],
]);

function toTslIdentifier(name: string): string {
  const key = name.toLowerCase();
  return TSL_IDENTIFIER_MAP.get(key) ?? name.toLowerCase();
}

function isRegisterIdentifier(name: string): boolean {
  return /^[qt]\d+$/u.test(name.toLowerCase());
}

/**
 * Build a TSL expression string from a MilkDrop expression tree.
 * The output string is valid TSL code that can be injected into a
 * `Fn()` block using `tslEval()` or similar dynamic compilation.
 */
export function buildTslExpression(expression: MilkdropExpressionNode): string {
  switch (expression.type) {
    case 'literal':
      return Number.isFinite(expression.value)
        ? expression.value.toString()
        : '0.0';

    case 'identifier': {
      const name = expression.name.toLowerCase();
      const mapped = TSL_IDENTIFIER_MAP.get(name);
      if (mapped !== undefined) return mapped;
      if (name === 'rand') return 'rand()';
      if (isRegisterIdentifier(name)) {
        return `state.${toTslIdentifier(expression.name)}`;
      }
      // Per-pixel targets that modify the feedback UV transform
      if (
        [
          'warp',
          'zoom',
          'rot',
          'cx',
          'cy',
          'sx',
          'sy',
          'dx',
          'dy',
          'flip',
        ].includes(name)
      ) {
        return `perPixel.${name}`;
      }
      // Regular state fields or signals
      return `${toTslIdentifier(expression.name)}`;
    }

    case 'unary': {
      const operand = buildTslExpression(expression.operand);
      switch (expression.operator) {
        case '+':
          return operand;
        case '-':
          return `neg(${operand})`;
        case '!':
          return `select(${operand}.equal(0.0), 1.0, 0.0)`;
      }
      return '0.0';
    }

    case 'binary': {
      const left = buildTslExpression(expression.left);
      const right = buildTslExpression(expression.right);
      switch (expression.operator) {
        case '+':
          return `(${left}).add(${right})`;
        case '-':
          return `(${left}).sub(${right})`;
        case '*':
          return `(${left}).mul(${right})`;
        case '/':
          return `(${left}).div(max(${right}, 0.000001))`;
        case '%':
          return `(${left}).mod(${right})`;
        case '^':
          return `pow(${left}, ${right})`;
        case '<':
          return `select((${left}).greaterThanEqual(${right}), 0.0, 1.0)`;
        case '<=':
          return `select((${left}).greaterThan(${right}), 0.0, 1.0)`;
        case '>':
          return `select((${left}).lessThanEqual(${right}), 0.0, 1.0)`;
        case '>=':
          return `select((${left}).lessThan(${right}), 0.0, 1.0)`;
        case '==':
          return `select(abs((${left}).sub(${right})).lessThan(0.0001), 1.0, 0.0)`;
        case '!=':
          return `select(abs((${left}).sub(${right})).lessThan(0.0001), 0.0, 1.0)`;
        case '&&':
          return `select((${left}).greaterThan(0.5), ${right}, 0.0)`;
        case '||':
          return `select((${left}).greaterThan(0.5), 1.0, ${right})`;
      }
      return '0.0';
    }

    case 'call': {
      const args = expression.args.map(buildTslExpression);
      const callee = expression.callee.toLowerCase();
      switch (callee) {
        case 'sin':
          return `sin(${args[0] ?? '0.0'})`;
        case 'cos':
          return `cos(${args[0] ?? '0.0'})`;
        case 'tan':
          return `tan(${args[0] ?? '0.0'})`;
        case 'asin':
          return `asin(${args[0] ?? '0.0'})`;
        case 'acos':
          return `acos(${args[0] ?? '0.0'})`;
        case 'atan':
          return `atan(${args[0] ?? '0.0'})`;
        case 'abs':
          return `abs(${args[0] ?? '0.0'})`;
        case 'sqrt':
          return `sqrt(${args[0] ?? '0.0'})`;
        case 'pow':
          return `pow(${args[0] ?? '0.0'}, ${args[1] ?? '1.0'})`;
        case 'exp':
          return `exp(${args[0] ?? '0.0'})`;
        case 'log':
          return `log(${args[0] ?? '0.0'})`;
        case 'min':
          return `min(${args[0] ?? '0.0'}, ${args[1] ?? '0.0'})`;
        case 'max':
          return `max(${args[0] ?? '0.0'}, ${args[1] ?? '0.0'})`;
        case 'clamp':
          return `clamp(${args[0] ?? '0.0'}, ${args[1] ?? '0.0'}, ${args[2] ?? '1.0'})`;
        case 'floor':
          return `floor(${args[0] ?? '0.0'})`;
        case 'ceil':
          return `ceil(${args[0] ?? '0.0'})`;
        case 'round':
          return `round(${args[0] ?? '0.0'})`;
        case 'frac':
        case 'fract':
          return `fract(${args[0] ?? '0.0'})`;
        case 'mod':
          return `(${args[0] ?? '0.0'}).mod(${args[1] ?? '1.0'})`;
        case 'sign':
          return `sign(${args[0] ?? '0.0'})`;
        case 'above':
          return `select((${args[0] ?? '0.0'}).greaterThan(${args[1] ?? '0.0'}), 1.0, 0.0)`;
        case 'below':
          return `select((${args[0] ?? '0.0'}).lessThan(${args[1] ?? '0.0'}), 1.0, 0.0)`;
        case 'equal':
          return `select(abs((${args[0] ?? '0.0'}).sub(${args[1] ?? '0.0'})).lessThan(0.0001), 1.0, 0.0)`;
        case 'if': {
          const cond = args[0] ?? '0.0';
          const thenVal = args[1] ?? '0.0';
          const elseVal = args[2] ?? '0.0';
          return `select((${cond}).greaterThan(0.5), ${thenVal}, ${elseVal})`;
        }
        case 'mix':
        case 'lerp':
          return `mix(${args[0] ?? '0.0'}, ${args[1] ?? '0.0'}, ${args[2] ?? '0.5'})`;
        case 'sqr':
          return `((${args[0] ?? '0.0'}).mul(${args[0] ?? '0.0'}))`;
        case 'sig':
          return `(1.0).div((1.0).add(exp(neg(${args[0] ?? '0.0'}))))`;
        case 'rand':
        case 'noise':
          return `rand()`;
      }
      return '0.0';
    }

    default:
      return '0.0';
  }
}

/**
 * Compile a series of per-pixel assignment statements into a TSL code string.
 * Each statement assigns a computed value to a target variable (warp, zoom, etc.).
 */
export function buildPerPixelTslCode(
  statements: Array<{
    target: string;
    expression: MilkdropExpressionNode | null;
  }>,
): string {
  if (statements.length === 0) return '';

  const lines: string[] = [];
  const seenTargets = new Set<string>();

  for (const stmt of statements) {
    const target = stmt.target.toLowerCase();
    if (
      !stmt.expression ||
      !['warp', 'zoom', 'rot', 'cx', 'cy', 'sx', 'sy', 'dx', 'dy'].includes(
        target,
      )
    ) {
      continue;
    }
    if (seenTargets.has(target)) continue;
    seenTargets.add(target);

    const exprStr = buildTslExpression(stmt.expression);
    lines.push(`  perPixel.${target} = ${exprStr};`);
  }

  if (lines.length === 0) return '';

  return `Fn(() => {
  const perPixel = {
    warp: float(0),
    zoom: float(1),
    rot: float(0),
    cx: float(0),
    cy: float(0),
    sx: float(1),
    sy: float(1),
    dx: float(0),
    dy: float(0),
  };
${lines.join('\n')}
  return perPixel;
})`;
}
