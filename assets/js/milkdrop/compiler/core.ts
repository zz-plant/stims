import {
  evaluateMilkdropExpression,
  MILKDROP_INTRINSIC_FUNCTIONS,
  MILKDROP_INTRINSIC_IDENTIFIERS,
  parseMilkdropExpression,
  parseMilkdropStatement,
  splitMilkdropStatements,
  walkMilkdropExpression,
} from '../expression';
import {
  aliasMap,
  normalizeFieldSuffix,
  normalizeProgramAssignmentTarget,
} from '../field-normalization';
import type {
  MilkdropBackendSupportEvidence,
  MilkdropCompatibilityFeatureKey,
  MilkdropDiagnostic,
  MilkdropDiagnosticSeverity,
  MilkdropExpressionNode,
  MilkdropFeatureKey,
  MilkdropGpuFieldExpression,
  MilkdropGpuFieldProgramDescriptor,
  MilkdropGpuFieldStatement,
  MilkdropPresetAST,
  MilkdropPresetField,
  MilkdropPresetIR,
  MilkdropPresetSource,
  MilkdropProgramBlock,
  MilkdropRenderBackend,
  MilkdropShapeDefinition,
  MilkdropWaveDefinition,
} from '../types';
import {
  buildBackendDivergence,
  buildBlockingConstructDetails,
  buildCompatibilityEvidence,
  buildDegradationReasons,
  buildVisualFallbacks,
  classifyFidelity,
} from './compatibility';
import {
  DEFAULT_MILKDROP_STATE,
  MAX_CUSTOM_SHAPES,
  MAX_CUSTOM_WAVES,
} from './default-state';
import { buildWebGpuDescriptorPlan } from './gpu-descriptor-plan';
import { createMilkdropIr } from './ir';
import {
  buildBackendSupport,
  buildFeatureAnalysis,
  type HardUnsupportedFieldSpec,
} from './parity';
import {
  buildShaderProgramPayload,
  buildUnsupportedVolumeSamplerWarnings,
  extractShaderControls,
  mergeShaderControlAnalysis,
} from './shader-analysis';

const FEATURE_ORDER: MilkdropFeatureKey[] = [
  'base-globals',
  'per-frame-equations',
  'per-pixel-equations',
  'custom-waves',
  'custom-shapes',
  'borders',
  'motion-vectors',
  'video-echo',
  'post-effects',
  'unsupported-shader-text',
];

const metadataKeys = new Set(['title', 'author', 'description']);
const waveformSectionNames = new Set(['wave', 'waveform']);
const rootProgramPattern = /^(init|per_frame|per_frame_init|per_pixel)_(\d+)$/u;
const customWaveProgramPattern =
  /^wave_(\d+)_(init|per_frame|per_point)(\d+)?$/u;
const customShapeProgramPattern = /^shape_(\d+)_(init|per_frame)(\d+)?$/u;
const shapeSectionPattern = /^shape_(\d+)$/u;
const wavecodeFieldPattern = /^wavecode_(\d+)_(.+)$/u;
const shapecodeFieldPattern = /^shapecode_(\d+)_(.+)$/u;
const shaderFieldPattern =
  /^(?:warp_[0-9]+|comp_[0-9]+|warp_shader|comp_shader|shader_text|warp_code|comp_code)$/u;

const HARD_UNSUPPORTED_FIELD_SPECS: readonly HardUnsupportedFieldSpec[] = [];
const hardUnsupportedKeys = new Map<
  string,
  { feature: MilkdropCompatibilityFeatureKey; message: string }
>(
  HARD_UNSUPPORTED_FIELD_SPECS.flatMap((spec) =>
    [spec.key, ...(spec.aliases ?? [])].map((key) => [
      key,
      {
        feature: spec.feature,
        message: spec.message,
      },
    ]),
  ),
);
const BACKEND_PARTIAL_FEATURE_GAPS: Record<
  MilkdropRenderBackend,
  Partial<Record<MilkdropFeatureKey, string>>
> = {
  webgl: {},
  webgpu: {},
};
const BACKEND_SHADER_TEXT_GAPS: Record<
  MilkdropRenderBackend,
  {
    supportedSubset?: string;
    unsupportedSubset?: string;
  }
> = {
  webgl: {
    unsupportedSubset:
      'This preset includes custom shader text outside the fully supported subset and will be approximated.',
  },
  webgpu: {
    supportedSubset:
      'WebGPU now translates the supported shader-text subset into its direct feedback execution plan while preserving control-based fallbacks for the remaining composite state.',
    unsupportedSubset:
      'WebGPU cannot safely approximate unsupported shader-text lines and must fall back to WebGL.',
  },
};

function normalizeBlockedConstructValue(value: string) {
  return value.trim().replace(/\s+/gu, ' ');
}

function toBlockedFieldConstruct(key: string) {
  return `field:${normalizeBlockedConstructValue(key)}`;
}

function toBlockedShaderConstruct(line: string) {
  return `shader:${normalizeBlockedConstructValue(line)}`;
}

function resolveRuntimeGlobals({
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

function lowerGpuFieldProgram(
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

const LEGACY_MOTION_VECTOR_CONTROL_TARGETS = new Set([
  'motion_vectors_x',
  'motion_vectors_y',
  'mv_dx',
  'mv_dy',
  'mv_l',
]);

function hasLegacyMotionVectorControls(
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

function collectExpressionCompatibilityGaps(
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

function collectExpressionsFromValue(
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

function createBackendEvidence(
  evidence: MilkdropBackendSupportEvidence,
): MilkdropBackendSupportEvidence {
  return evidence;
}

function getHardUnsupportedField(key: string) {
  return hardUnsupportedKeys.get(key);
}

function isHardUnsupportedFieldBlocking(
  _spec: HardUnsupportedFieldSpec,
  _numericFields: Partial<Record<string, number>>,
) {
  return true;
}

function normalizeVideoEchoOrientation(value: number) {
  const truncated = Math.trunc(value);
  return (((truncated % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

function resolveLegacyCustomSlotIndex(rawIndex: number, maxSlots: number) {
  if (!Number.isFinite(rawIndex)) {
    return null;
  }
  if (rawIndex >= 0 && rawIndex < maxSlots) {
    return rawIndex + 1;
  }
  if (rawIndex === maxSlots) {
    return maxSlots;
  }
  return null;
}

const legacyCustomWaveSuffixMap: Record<string, string | null> = {
  mode: 'spectrum',
  bspectrum: 'spectrum',
  bdrawthick: 'thick',
  badditive: 'additive',
};

const legacyCustomShapeSuffixMap: Record<string, string | null> = {
  badditive: 'additive',
  thickoutline: 'thickoutline',
  thick_outline: 'thickoutline',
  bthickoutline: 'thickoutline',
  bthick_outline: 'thickoutline',
};

function defaultSourceId(rawTitle: string) {
  return (
    rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'milkdrop-preset'
  );
}

function normalizeString(rawValue: string) {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeShaderFieldChunk(rawValue: string) {
  const normalized = normalizeString(rawValue).replace(/^`+/u, '').trim();
  if (
    normalized.length === 0 ||
    normalized === '{' ||
    normalized === '}' ||
    normalized.toLowerCase() === 'shader_body'
  ) {
    return null;
  }
  return normalized;
}

function normalizeLegacyCustomWaveSuffix(value: string) {
  const normalized = normalizeFieldSuffix(value);
  if (normalized in legacyCustomWaveSuffixMap) {
    return legacyCustomWaveSuffixMap[normalized];
  }
  return normalized;
}

function normalizeLegacyCustomShapeSuffix(value: string) {
  const normalized = normalizeFieldSuffix(value);
  if (normalized in legacyCustomShapeSuffixMap) {
    return legacyCustomShapeSuffixMap[normalized];
  }
  return normalized;
}

function createProgramBlock(): MilkdropProgramBlock {
  return {
    statements: [],
    sourceLines: [],
  };
}

function createWaveDefinition(index: number): MilkdropWaveDefinition {
  return {
    index,
    fields: {},
    programs: {
      init: createProgramBlock(),
      perFrame: createProgramBlock(),
      perPoint: createProgramBlock(),
    },
  };
}

function createShapeDefinition(index: number): MilkdropShapeDefinition {
  return {
    index,
    fields: {},
    programs: {
      init: createProgramBlock(),
      perFrame: createProgramBlock(),
    },
  };
}

function addDiagnostic(
  diagnostics: MilkdropDiagnostic[],
  severity: MilkdropDiagnosticSeverity,
  code: string,
  message: string,
  options: { line?: number; field?: string } = {},
) {
  diagnostics.push({
    severity,
    code,
    message,
    line: options.line,
    field: options.field,
  });
}

function compileScalarField(
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

function pushProgramStatement(
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
        target: normalizeProgramAssignmentTarget(parsed.value.target),
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

function pushProgramStatementWithContinuation(
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

function getProgramBlock(
  programType:
    | 'init'
    | 'per_frame'
    | 'per_frame_init'
    | 'per_pixel'
    | 'per_point',
  blocks: {
    init: MilkdropProgramBlock;
    perFrame: MilkdropProgramBlock;
    perPixel?: MilkdropProgramBlock;
    perPoint?: MilkdropProgramBlock;
  },
) {
  if (programType === 'init' || programType === 'per_frame_init') {
    return blocks.init;
  }
  if (programType === 'per_frame') {
    return blocks.perFrame;
  }
  if (programType === 'per_point' && blocks.perPoint) {
    return blocks.perPoint;
  }
  if (programType === 'per_pixel' && blocks.perPixel) {
    return blocks.perPixel;
  }
  return null;
}

function normalizeFieldKey(field: MilkdropPresetField) {
  const rawKey = normalizeFieldSuffix(field.key);
  if (field.section) {
    if (waveformSectionNames.has(field.section)) {
      return `wave_${rawKey}`;
    }
    if (shapeSectionPattern.test(field.section)) {
      return `${field.section}_${rawKey}`;
    }
  }

  const wavecodeMatch = rawKey.match(wavecodeFieldPattern);
  if (wavecodeMatch) {
    const index = resolveLegacyCustomSlotIndex(
      Number.parseInt(wavecodeMatch[1] ?? '0', 10),
      MAX_CUSTOM_WAVES,
    );
    if (index !== null) {
      const suffix = normalizeLegacyCustomWaveSuffix(wavecodeMatch[2] ?? '');
      if (suffix !== null) {
        return `custom_wave_${index}_${suffix}`;
      }
    }
  }

  const shapecodeMatch = rawKey.match(shapecodeFieldPattern);
  if (shapecodeMatch) {
    const index = resolveLegacyCustomSlotIndex(
      Number.parseInt(shapecodeMatch[1] ?? '0', 10),
      MAX_CUSTOM_SHAPES,
    );
    if (index !== null) {
      const suffix = normalizeLegacyCustomShapeSuffix(shapecodeMatch[2] ?? '');
      if (suffix !== null) {
        return `shape_${index}_${suffix}`;
      }
    }
  }

  if (rawKey in aliasMap) {
    return aliasMap[rawKey];
  }
  if (rawKey === 'shapethickoutline') {
    return 'shape_1_thickoutline';
  }
  return rawKey;
}

function ensureWaveDefinition(
  waves: Map<number, MilkdropWaveDefinition>,
  index: number,
) {
  let definition = waves.get(index);
  if (!definition) {
    definition = createWaveDefinition(index);
    waves.set(index, definition);
  }
  return definition;
}

function ensureShapeDefinition(
  shapes: Map<number, MilkdropShapeDefinition>,
  index: number,
) {
  let definition = shapes.get(index);
  if (!definition) {
    definition = createShapeDefinition(index);
    shapes.set(index, definition);
  }
  return definition;
}

function compileProgramsFromField(
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

function analyzeProgramRegisters(
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

function hasProgramStatements(block: MilkdropProgramBlock) {
  return block.statements.length > 0;
}

export function createPresetSource(
  source: Partial<MilkdropPresetSource>,
  raw: string,
  title: string,
  author?: string,
): MilkdropPresetSource {
  const resolvedTitle = source.title?.trim() || title;
  return {
    id: source.id ?? defaultSourceId(resolvedTitle),
    title: resolvedTitle,
    raw,
    origin: source.origin ?? 'draft',
    author: source.author ?? author,
    fileName: source.fileName,
    path: source.path,
    updatedAt: source.updatedAt ?? Date.now(),
  };
}

export function createIR(
  ast: MilkdropPresetAST,
  diagnostics: MilkdropDiagnostic[],
  source: Partial<MilkdropPresetSource> = {},
) {
  return createMilkdropIr({
    ast,
    diagnostics,
    source,
    defaultState: DEFAULT_MILKDROP_STATE,
    metadataKeys,
    shaderFieldPattern,
    maxCustomWaves: MAX_CUSTOM_WAVES,
    maxCustomShapes: MAX_CUSTOM_SHAPES,
    featureOrder: FEATURE_ORDER,
    backendPartialFeatureGaps: BACKEND_PARTIAL_FEATURE_GAPS,
    backendShaderTextGaps: BACKEND_SHADER_TEXT_GAPS,
    lowerGpuFieldProgram,
    hasLegacyMotionVectorControls,
    analyzeProgramRegisters,
    hasProgramStatements,
    programHelpers: {
      createProgramBlock,
      compileProgramsFromField,
    },
    fieldHelpers: {
      normalizeFieldKey,
      getHardUnsupportedField: (key) => getHardUnsupportedField(key),
      normalizeString,
      normalizeShaderFieldChunk: (rawValue) =>
        normalizeShaderFieldChunk(rawValue),
      compileScalarField,
      addDiagnostic,
      ensureWaveDefinition,
      ensureShapeDefinition,
      normalizeVideoEchoOrientation,
      pushProgramStatement,
      resolveRuntimeGlobals,
      isHardUnsupportedFieldBlocking,
    },
    shaderHelpers: {
      extractShaderControls,
      mergeShaderControlAnalysis,
      buildShaderProgramPayload: (args) => buildShaderProgramPayload(args),
      normalizeBlockedConstructValue,
      buildUnsupportedVolumeSamplerWarnings,
    },
    compatibilityHelpers: {
      buildBlockingConstructDetails,
      collectExpressionsFromValue,
      collectExpressionCompatibilityGaps,
      buildBackendSupport,
      createBackendEvidence: (evidence) =>
        createBackendEvidence(evidence as MilkdropBackendSupportEvidence),
      buildFeatureAnalysis,
      buildWebGpuDescriptorPlan,
      buildBackendDivergence,
      buildVisualFallbacks,
      buildDegradationReasons,
      buildCompatibilityEvidence,
      classifyFidelity,
      toBlockedFieldConstruct,
      toBlockedShaderConstruct,
    },
  });
}
