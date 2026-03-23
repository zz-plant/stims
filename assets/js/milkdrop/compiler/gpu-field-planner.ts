import type {
  MilkdropExpressionNode,
  MilkdropGpuFieldExpression,
  MilkdropGpuFieldProgramDescriptor,
  MilkdropGpuFieldStatement,
  MilkdropProgramBlock,
} from '../types.ts';

const GPU_FIELD_STATE_IDENTIFIERS = new Set([
  'x',
  'y',
  'rad',
  'ang',
  'zoom',
  'zoomexp',
  'rot',
  'warp',
  'cx',
  'cy',
  'sx',
  'sy',
  'dx',
  'dy',
]);

const GPU_FIELD_SIGNAL_ALIAS_MAP = new Map<string, string>([
  ['time', 'time'],
  ['frame', 'frame'],
  ['fps', 'fps'],
  ['bass', 'bass'],
  ['mid', 'mid'],
  ['mids', 'mids'],
  ['treb', 'treble'],
  ['treble', 'treble'],
  ['bass_att', 'bassAtt'],
  ['bassatt', 'bassAtt'],
  ['mid_att', 'midAtt'],
  ['mids_att', 'midsAtt'],
  ['midsatt', 'midsAtt'],
  ['treb_att', 'trebleAtt'],
  ['treble_att', 'trebleAtt'],
  ['trebleatt', 'trebleAtt'],
  ['beat', 'beat'],
  ['beat_pulse', 'beatPulse'],
  ['beatpulse', 'beatPulse'],
  ['rms', 'rms'],
  ['vol', 'vol'],
  ['music', 'music'],
  ['weighted_energy', 'weightedEnergy'],
]);

const GPU_FIELD_FUNCTIONS = new Set([
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'abs',
  'sqrt',
  'pow',
  'mod',
  'fmod',
  'min',
  'max',
  'mix',
  'lerp',
  'floor',
  'int',
  'ceil',
  'sqr',
  'clamp',
  'step',
  'smoothstep',
  'log',
  'exp',
  'sigmoid',
  'sign',
  'bor',
  'band',
  'bnot',
  'atan2',
  'frac',
  'if',
  'above',
  'below',
  'equal',
]);

function isGpuFieldTemporary(identifier: string) {
  return /^q\d+$/u.test(identifier) || /^t\d+$/u.test(identifier);
}

function lowerGpuFieldIdentifier(identifier: string) {
  const normalized = identifier.toLowerCase();
  if (normalized === 'pi' || normalized === 'e') {
    return normalized;
  }
  if (GPU_FIELD_SIGNAL_ALIAS_MAP.has(normalized)) {
    return GPU_FIELD_SIGNAL_ALIAS_MAP.get(normalized) ?? normalized;
  }
  return normalized;
}

function isSupportedGpuFieldTarget(identifier: string) {
  return (
    GPU_FIELD_STATE_IDENTIFIERS.has(identifier) ||
    isGpuFieldTemporary(identifier)
  );
}

function lowerGpuFieldExpression(
  expression: MilkdropExpressionNode,
  allowedIdentifiers: Set<string>,
): MilkdropGpuFieldExpression | null {
  switch (expression.type) {
    case 'literal':
      return expression;
    case 'identifier': {
      const identifier = lowerGpuFieldIdentifier(expression.name);
      return allowedIdentifiers.has(identifier)
        ? { type: 'identifier', name: identifier }
        : null;
    }
    case 'unary': {
      const operand = lowerGpuFieldExpression(
        expression.operand,
        allowedIdentifiers,
      );
      return operand
        ? {
            type: 'unary',
            operator: expression.operator,
            operand,
          }
        : null;
    }
    case 'binary': {
      const left = lowerGpuFieldExpression(expression.left, allowedIdentifiers);
      const right = lowerGpuFieldExpression(
        expression.right,
        allowedIdentifiers,
      );
      return left && right
        ? {
            type: 'binary',
            operator: expression.operator,
            left,
            right,
          }
        : null;
    }
    case 'call': {
      const name = expression.name.toLowerCase();
      if (!GPU_FIELD_FUNCTIONS.has(name)) {
        return null;
      }
      const args = expression.args
        .map((arg) => lowerGpuFieldExpression(arg, allowedIdentifiers))
        .filter((arg): arg is MilkdropGpuFieldExpression => arg !== null);
      if (args.length !== expression.args.length) {
        return null;
      }
      return { type: 'call', name, args };
    }
    default:
      return null;
  }
}

export function lowerGpuFieldProgram(
  program: MilkdropProgramBlock,
): MilkdropGpuFieldProgramDescriptor | null {
  if (program.statements.length === 0) {
    return null;
  }

  const allowedIdentifiers = new Set<string>([
    ...GPU_FIELD_STATE_IDENTIFIERS,
    ...GPU_FIELD_SIGNAL_ALIAS_MAP.values(),
    'pi',
    'e',
  ]);
  const temporaries = new Set<string>();
  const statements: MilkdropGpuFieldStatement[] = [];

  for (const statement of program.statements) {
    const target = lowerGpuFieldIdentifier(statement.target);
    if (!isSupportedGpuFieldTarget(target)) {
      return null;
    }

    const expression = lowerGpuFieldExpression(
      statement.expression,
      allowedIdentifiers,
    );
    if (!expression) {
      return null;
    }

    statements.push({ target, expression });
    allowedIdentifiers.add(target);
    if (isGpuFieldTemporary(target)) {
      temporaries.add(target);
    }
  }

  return {
    kind: 'gpu-field-program',
    statements,
    temporaries: [...temporaries].sort(),
    signature: JSON.stringify({
      temporaries: [...temporaries].sort(),
      statements,
    }),
  };
}
