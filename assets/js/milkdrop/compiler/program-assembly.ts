import {
  evaluateMilkdropExpression,
  MILKDROP_INTRINSIC_FUNCTIONS,
  MILKDROP_INTRINSIC_IDENTIFIERS,
  parseMilkdropExpression,
  parseMilkdropStatement,
  splitMilkdropStatements,
  walkMilkdropExpression,
} from '../expression.ts';
import { aliasMap, normalizeFieldSuffix } from '../field-normalization.ts';
import type {
  MilkdropDiagnostic,
  MilkdropExpressionNode,
  MilkdropPresetField,
  MilkdropPresetIR,
  MilkdropProgramBlock,
  MilkdropShapeDefinition,
  MilkdropWaveDefinition,
} from '../types.ts';
import {
  DEFAULT_MILKDROP_STATE,
  MAX_CUSTOM_SHAPES,
  MAX_CUSTOM_WAVES,
} from './default-state.ts';
import {
  ensureShapeDefinition,
  ensureWaveDefinition,
  getProgramBlock,
  normalizeProgramTarget,
  presetProgramPatterns,
  resolveLegacyCustomSlotIndex,
} from './preset-normalization.ts';

const LEGACY_MOTION_VECTOR_CONTROL_TARGETS = new Set([
  'motion_vectors_x',
  'motion_vectors_y',
  'mv_dx',
  'mv_dy',
  'mv_l',
]);

export function resolveRuntimeGlobals({
  numericFields,
  programs,
}: {
  numericFields: Record<string, number>;
  programs: Pick<MilkdropPresetIR['programs'], 'init' | 'perFrame'>;
}) {
  const runtimeGlobals = {
    ...DEFAULT_MILKDROP_STATE,
    ...numericFields,
  };
  const evaluationEnv: Record<string, number> = {
    ...runtimeGlobals,
  };

  for (let index = 1; index <= 32; index += 1) {
    evaluationEnv[`q${index}`] = 0;
  }

  for (const block of [programs.init, programs.perFrame]) {
    for (const statement of block.statements) {
      const value = evaluateMilkdropExpression(
        statement.expression,
        evaluationEnv,
      );
      evaluationEnv[statement.target] = value;
      if (statement.target in runtimeGlobals) {
        runtimeGlobals[statement.target] = value;
      }
    }
  }

  return runtimeGlobals;
}

function buildSupportedExpressionIdentifierSet() {
  const supported = new Set<string>([
    ...Object.keys(DEFAULT_MILKDROP_STATE),
    ...Object.keys(aliasMap).filter((key) => aliasMap[key] !== null),
    ...MILKDROP_INTRINSIC_IDENTIFIERS,
    'time',
    'frame',
    'fps',
    'bass',
    'mid',
    'mids',
    'treb',
    'treble',
    'bass_att',
    'mid_att',
    'mids_att',
    'treb_att',
    'treble_att',
    'bassatt',
    'midsatt',
    'trebleatt',
    'beat',
    'beat_pulse',
    'beatpulse',
    'rms',
    'vol',
    'music',
    'weighted_energy',
    'progress',
    'sample',
    'value',
    'value1',
    'value2',
    'x',
    'y',
    'rad',
    'ang',
    'sides',
    'enabled',
    'samples',
    'spectrum',
    'additive',
    'usedots',
    'scaling',
    'smoothing',
    'mystery',
    'thick',
    'a',
    'r',
    'g',
    'b',
    'a2',
    'r2',
    'g2',
    'b2',
    'border_a',
    'border_r',
    'border_g',
    'border_b',
    'thickoutline',
  ]);
  return supported;
}

function isSupportedExpressionIdentifier(
  identifier: string,
  supportedIdentifiers: Set<string>,
) {
  const normalized = identifier.toLowerCase();
  return (
    supportedIdentifiers.has(identifier) ||
    supportedIdentifiers.has(normalized) ||
    /^q\d+$/u.test(normalized) ||
    /^t\d+$/u.test(normalized)
  );
}

export function collectExpressionCompatibilityGaps(
  expressions: MilkdropExpressionNode[],
  assignedTargets: Iterable<string>,
) {
  const supportedIdentifiers = buildSupportedExpressionIdentifierSet();
  for (const target of assignedTargets) {
    supportedIdentifiers.add(target);
    supportedIdentifiers.add(target.toLowerCase());
  }

  const missing = new Set<string>();
  for (const expression of expressions) {
    walkMilkdropExpression(expression, (node) => {
      if (node.type === 'identifier') {
        if (!isSupportedExpressionIdentifier(node.name, supportedIdentifiers)) {
          missing.add(node.name.toLowerCase());
        }
        return;
      }
      if (
        node.type === 'call' &&
        !MILKDROP_INTRINSIC_FUNCTIONS.has(node.name.toLowerCase())
      ) {
        missing.add(node.name.toLowerCase());
      }
    });
  }

  return [...missing].sort();
}

export function collectExpressionsFromValue(
  value: unknown,
  expressions: MilkdropExpressionNode[],
) {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (
    'type' in value &&
    typeof value.type === 'string' &&
    ['literal', 'identifier', 'unary', 'binary', 'call'].includes(value.type)
  ) {
    expressions.push(value as MilkdropExpressionNode);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectExpressionsFromValue(entry, expressions));
    return;
  }
  Object.values(value).forEach((entry) =>
    collectExpressionsFromValue(entry, expressions),
  );
}

export function hasLegacyMotionVectorControls(
  numericFields: Record<string, number>,
  programs?: Pick<MilkdropPresetIR['programs'], 'init' | 'perFrame'>,
) {
  const hasLegacyFieldValues =
    Math.abs(numericFields.mv_dx ?? 0) > 0.0001 ||
    Math.abs(numericFields.mv_dy ?? 0) > 0.0001 ||
    Math.abs(numericFields.mv_l ?? 0) > 0.0001;
  if (hasLegacyFieldValues) {
    return true;
  }

  if (!programs) {
    return false;
  }

  return [programs.init, programs.perFrame].some((block) =>
    block.statements.some((statement) =>
      LEGACY_MOTION_VECTOR_CONTROL_TARGETS.has(statement.target),
    ),
  );
}

export function compileScalarField(
  field: MilkdropPresetField,
  diagnostics: MilkdropDiagnostic[],
): { value: number | null; expression?: MilkdropExpressionNode } {
  const normalizedValue = field.rawValue.trim().replace(/;+\s*$/u, '');
  const numeric = Number(normalizedValue);
  if (Number.isFinite(numeric)) {
    return { value: numeric };
  }

  const expressionResult = parseMilkdropExpression(normalizedValue, field.line);
  diagnostics.push(...expressionResult.diagnostics);
  if (!expressionResult.value) {
    return { value: null };
  }

  return {
    value: evaluateMilkdropExpression(
      expressionResult.value,
      DEFAULT_MILKDROP_STATE,
    ),
    expression: expressionResult.value,
  };
}

export function pushProgramStatement(
  block: MilkdropProgramBlock,
  sourceLine: string,
  line: number,
  diagnostics: MilkdropDiagnostic[],
) {
  const statements = splitMilkdropStatements(sourceLine);
  statements.forEach((statement) => {
    const parsed = parseMilkdropStatement(statement, line);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.value) {
      block.statements.push({
        ...parsed.value,
        target: normalizeProgramTarget(parsed.value.target),
      });
      block.sourceLines.push(statement);
    }
  });
}

function canContinueMilkdropProgramLine(sourceLine: string) {
  const trimmed = sourceLine.trim();
  if (!trimmed) {
    return false;
  }

  return /(?:[+\-*/,(]|\b(?:and|or)\b)$/iu.test(trimmed);
}

export function pushProgramStatementWithContinuation(
  block: MilkdropProgramBlock,
  sourceLine: string,
  line: number,
  diagnostics: MilkdropDiagnostic[],
  pendingProgramSources: Map<
    MilkdropProgramBlock,
    { sourceLine: string; line: number }
  >,
) {
  const trimmedValue = sourceLine.trim();
  const pending = pendingProgramSources.get(block);

  if (pending) {
    if (!trimmedValue) {
      return;
    }

    if (!trimmedValue.includes('=')) {
      const combined = `${pending.sourceLine} ${trimmedValue}`.trim();
      if (canContinueMilkdropProgramLine(combined)) {
        pendingProgramSources.set(block, {
          sourceLine: combined,
          line: pending.line,
        });
        return;
      }
      pendingProgramSources.delete(block);
      pushProgramStatement(block, combined, pending.line, diagnostics);
      return;
    }

    pendingProgramSources.delete(block);
    pushProgramStatement(block, pending.sourceLine, pending.line, diagnostics);
  }

  if (!trimmedValue) {
    return;
  }

  if (
    trimmedValue.includes('=') &&
    canContinueMilkdropProgramLine(trimmedValue)
  ) {
    pendingProgramSources.set(block, { sourceLine: trimmedValue, line });
    return;
  }

  pushProgramStatement(block, sourceLine, line, diagnostics);
}

export function compileProgramsFromField(
  field: MilkdropPresetField,
  programs: MilkdropPresetIR['programs'],
  customWaves: Map<number, MilkdropWaveDefinition>,
  customShapes: Map<number, MilkdropShapeDefinition>,
  diagnostics: MilkdropDiagnostic[],
  pendingProgramSources: Map<
    MilkdropProgramBlock,
    { sourceLine: string; line: number }
  >,
) {
  if (field.section === 'init') {
    pushProgramStatementWithContinuation(
      programs.init,
      `${field.key.trim()} = ${field.rawValue.trim()}`,
      field.line,
      diagnostics,
      pendingProgramSources,
    );
    return true;
  }

  if (field.section === 'per_frame') {
    pushProgramStatementWithContinuation(
      programs.perFrame,
      `${field.key.trim()} = ${field.rawValue.trim()}`,
      field.line,
      diagnostics,
      pendingProgramSources,
    );
    return true;
  }

  if (field.section === 'per_pixel') {
    pushProgramStatementWithContinuation(
      programs.perPixel,
      `${field.key.trim()} = ${field.rawValue.trim()}`,
      field.line,
      diagnostics,
      pendingProgramSources,
    );
    return true;
  }

  const {
    rootProgramPattern,
    customWaveProgramPattern,
    customShapeProgramPattern,
  } = presetProgramPatterns;
  const rawKey = normalizeFieldSuffix(field.key);
  const rootMatch = rawKey.match(rootProgramPattern);
  if (rootMatch) {
    const block = getProgramBlock(
      rootMatch[1] as 'init' | 'per_frame' | 'per_frame_init' | 'per_pixel',
      {
        init: programs.init,
        perFrame: programs.perFrame,
        perPixel: programs.perPixel,
      },
    );
    if (block) {
      pushProgramStatementWithContinuation(
        block,
        field.rawValue,
        field.line,
        diagnostics,
        pendingProgramSources,
      );
      return true;
    }
  }

  const waveMatch = rawKey.match(customWaveProgramPattern);
  if (waveMatch) {
    const index = resolveLegacyCustomSlotIndex(
      Number.parseInt(waveMatch[1] ?? '0', 10),
      MAX_CUSTOM_WAVES,
    );
    if (index !== null) {
      const wave = ensureWaveDefinition(customWaves, index);
      const block = getProgramBlock(
        waveMatch[2] as 'init' | 'per_frame' | 'per_point',
        {
          init: wave.programs.init,
          perFrame: wave.programs.perFrame,
          perPoint: wave.programs.perPoint,
        },
      );
      if (block) {
        pushProgramStatementWithContinuation(
          block,
          field.rawValue,
          field.line,
          diagnostics,
          pendingProgramSources,
        );
        return true;
      }
    }
  }

  const shapeMatch = rawKey.match(customShapeProgramPattern);
  if (shapeMatch) {
    const index = resolveLegacyCustomSlotIndex(
      Number.parseInt(shapeMatch[1] ?? '0', 10),
      MAX_CUSTOM_SHAPES,
    );
    if (index !== null) {
      const shape = ensureShapeDefinition(customShapes, index);
      const block = getProgramBlock(shapeMatch[2] as 'init' | 'per_frame', {
        init: shape.programs.init,
        perFrame: shape.programs.perFrame,
      });
      if (block) {
        pushProgramStatementWithContinuation(
          block,
          field.rawValue,
          field.line,
          diagnostics,
          pendingProgramSources,
        );
        return true;
      }
    }
  }

  return false;
}

function collectRegisterUsage(target: string, usage: { q: number; t: number }) {
  const match = target.toLowerCase().match(/^([qt])(\d+)$/u);
  if (!match) {
    return;
  }
  const bucket = match[1] as 'q' | 't';
  const index = Number.parseInt(match[2] ?? '0', 10);
  if (Number.isFinite(index)) {
    usage[bucket] = Math.max(usage[bucket], index);
  }
}

export function analyzeProgramRegisters(
  block: MilkdropProgramBlock,
  usage: { q: number; t: number },
) {
  block.statements.forEach((statement) => {
    collectRegisterUsage(statement.target, usage);
    walkMilkdropExpression(statement.expression, (node) => {
      if (node.type === 'identifier') {
        collectRegisterUsage(node.name, usage);
      }
    });
  });
}

export function hasProgramStatements(block: MilkdropProgramBlock) {
  return block.statements.length > 0;
}
