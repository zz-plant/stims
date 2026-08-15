import type {
  MilkdropExpressionNode,
  MilkdropProgramBlock,
} from '../common-types.ts';
import type {
  MilkdropGpuFieldExpression,
  MilkdropGpuFieldProgramDescriptor,
  MilkdropGpuFieldStatement,
} from '../compiler-types.ts';

const GPU_FIELD_STATE_IDENTIFIERS = new Set([
  'x',
  'y',
  'rad',
  'ang',
  'zoom',
  'zoomexp',
  'rot',
  'warp',
  'warp_scale',
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
  ['aspect', 'aspect'],
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
  'rand',
  'if',
  'above',
  'below',
  'equal',
  'exec2',
  'exec3',
]);

type LowerGpuFieldProgramOptions = {
  additionalStateIdentifiers?: Iterable<string>;
  additionalAllowedIdentifiers?: Iterable<string>;
  /**
   * Per-frame register names (`q1`..`q8`) that a per-pixel program may READ as
   * frame constants. A register that is only read (never assigned inside the
   * per-pixel program) lowers to a per-frame uniform input instead of bailing;
   * a register that is assigned stays a per-vertex temporary. Excludes the
   * wave-local `t` bank, which is per-wave state and never a per-pixel input.
   */
  registerInputs?: Iterable<string>;
};

const GPU_FIELD_REGISTER_PATTERN = /^q[0-9]+$/u;

/** Per-frame registers exposed to per-pixel programs as frame-constant
 * uniform inputs. Bounded to `q1`..`q8`: the bundled catalog reads no higher,
 * and the per-wave `t` bank is not a per-pixel input. */
export const PER_FRAME_FIELD_REGISTER_INPUTS = [
  'q1',
  'q2',
  'q3',
  'q4',
  'q5',
  'q6',
  'q7',
  'q8',
];

function collectGpuFieldIdentifierReads(
  expression: MilkdropExpressionNode,
): Set<string> {
  const reads = new Set<string>();
  const visit = (node: MilkdropExpressionNode): void => {
    switch (node.type) {
      case 'identifier':
        reads.add(lowerGpuFieldIdentifier(node.name));
        break;
      case 'unary':
        visit(node.operand);
        break;
      case 'binary':
        visit(node.left);
        visit(node.right);
        break;
      case 'call':
        for (const arg of node.args) {
          visit(arg);
        }
        break;
      case 'literal':
        break;
    }
  };
  visit(expression);
  return reads;
}

/**
 * A per-pixel program may declare scratch locals with any name it likes —
 * `thresh`, `du`, `rd`, `snee`. They live for one vertex and never persist, so
 * anything that is not already a state slot, a signal, or a constant lowers to
 * a GPU temporary.
 *
 * WHY this is not just `/^[qt]\d+$/` (measured 2026-08-14 over the 1,870-preset
 * corpus): of the 1,139 presets with per-pixel code, 813 failed to lower, and
 * **492 of those — 60.5% — failed solely because they assigned to an
 * ordinarily-named local**. Restricting temporaries to q/t-numbered names was
 * the single largest blocker on the procedural GPU field path.
 *
 * The caller's reserved set (state slots + signals + `pi`/`e` +
 * `additionalAllowedIdentifiers`) is passed in rather than closed over so that
 * the custom-wave path, which injects `sample`/`value1`/`mystery` and friends,
 * keeps treating those as its own bindings instead of silently shadowing them
 * with a zero-initialised local.
 */
const GPU_FIELD_TEMPORARY_PATTERN = /^[a-z_][a-z0-9_]*$/u;

function isGpuFieldTemporary(
  identifier: string,
  reservedIdentifiers: ReadonlySet<string>,
) {
  return (
    GPU_FIELD_TEMPORARY_PATTERN.test(identifier) &&
    !reservedIdentifiers.has(identifier)
  );
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
      if (expression.operator === '=') {
        return null;
      }
      const left = lowerGpuFieldExpression(expression.left, allowedIdentifiers);
      const right = lowerGpuFieldExpression(
        expression.right,
        allowedIdentifiers,
      );
      return left && right
        ? ({
            type: 'binary',
            operator: expression.operator,
            left,
            right,
          } as MilkdropGpuFieldExpression)
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
  {
    additionalStateIdentifiers = [],
    additionalAllowedIdentifiers = [],
    registerInputs = [],
  }: LowerGpuFieldProgramOptions = {},
): MilkdropGpuFieldProgramDescriptor | null {
  if (program.statements.length === 0) {
    return null;
  }

  const availableRegisters = new Set(
    Array.from(registerInputs ?? [], (name) => lowerGpuFieldIdentifier(name)),
  );
  const stateIdentifiers = new Set<string>([
    ...GPU_FIELD_STATE_IDENTIFIERS,
    ...Array.from(additionalStateIdentifiers, (identifier) =>
      lowerGpuFieldIdentifier(identifier),
    ),
  ]);
  const allowedIdentifiers = new Set<string>([
    ...stateIdentifiers,
    ...GPU_FIELD_SIGNAL_ALIAS_MAP.values(),
    ...Array.from(additionalAllowedIdentifiers, (identifier) =>
      lowerGpuFieldIdentifier(identifier),
    ),
    'pi',
    'e',
  ]);
  // Snapshot before the loop: `allowedIdentifiers` grows as targets are
  // assigned, and a name the program introduced itself must stay eligible as a
  // temporary rather than reserving itself on its second assignment.
  const reservedIdentifiers: ReadonlySet<string> = new Set(allowedIdentifiers);
  const temporaries = new Set<string>();
  const statements: MilkdropGpuFieldStatement[] = [];

  // MilkDrop initialises every variable to 0, so reading a local before its
  // first assignment is legal and yields 0 — and the emitted code already
  // declares each temporary as `= 0.0` at the top of the per-vertex function.
  // Pre-declaring every local the program assigns therefore matches MilkDrop
  // semantics exactly, and lets those early reads lower instead of bailing.
  // (Measured: worth ~83 further presets, `thresh` alone accounting for 73.)
  // A name that is never assigned anywhere still bails — it cannot be told
  // apart from a misspelled builtin.
  for (const statement of program.statements) {
    const target = lowerGpuFieldIdentifier(statement.target);
    if (
      !stateIdentifiers.has(target) &&
      isGpuFieldTemporary(target, reservedIdentifiers)
    ) {
      temporaries.add(target);
      allowedIdentifiers.add(target);
    }
  }

  // A register (`q1`..`q8`) that the per-pixel program only READS is the
  // per-frame register value — a frame constant, identical across all vertices
  // — so it lowers to a per-frame uniform input rather than bailing. A register
  // that is ASSIGNED inside the per-pixel program was caught above as a
  // per-vertex temporary (MilkDrop register semantics are honoured by the
  // vertex-local initialisation to 0.0). Reads of registers not in the
  // caller's available set (e.g. `q9`+ or the per-wave `t` bank) still bail.
  const registerInputIdentifiers = new Set<string>();
  for (const statement of program.statements) {
    for (const read of collectGpuFieldIdentifierReads(statement.expression)) {
      if (
        GPU_FIELD_REGISTER_PATTERN.test(read) &&
        availableRegisters.has(read) &&
        !temporaries.has(read)
      ) {
        registerInputIdentifiers.add(read);
        allowedIdentifiers.add(read);
      }
    }
  }

  for (const statement of program.statements) {
    const target = lowerGpuFieldIdentifier(statement.target);
    // State slots win over the temporary rule, so a caller-injected binding is
    // written in place instead of being shadowed by a fresh local.
    const targetIsState = stateIdentifiers.has(target);
    const targetIsTemporary =
      !targetIsState && isGpuFieldTemporary(target, reservedIdentifiers);
    if (!(targetIsState || targetIsTemporary)) {
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
    if (targetIsTemporary) {
      temporaries.add(target);
    }
  }

  const registerInputNames = [...registerInputIdentifiers].sort();
  return {
    kind: 'gpu-field-program',
    statements,
    temporaries: [...temporaries].sort(),
    registerInputs: registerInputNames,
    signature: JSON.stringify({
      temporaries: [...temporaries].sort(),
      registerInputs: registerInputNames,
      statements,
    }),
  };
}
