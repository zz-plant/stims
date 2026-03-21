import {
  evaluateMilkdropExpression,
  MILKDROP_INTRINSIC_FUNCTIONS,
  MILKDROP_INTRINSIC_IDENTIFIERS,
  parseMilkdropExpression,
  parseMilkdropStatement,
  splitMilkdropStatements,
  walkMilkdropExpression,
} from './expression';
import {
  aliasMap,
  normalizeFieldSuffix,
  normalizeProgramAssignmentTarget,
} from './field-normalization';
import { formatMilkdropPreset } from './formatter';
import { isMilkdropParityConstructAllowlisted } from './parity-allowlist';
import { parseMilkdropPreset } from './preset-parser';
import {
  evaluateMilkdropShaderExpression,
  parseMilkdropShaderStatement,
} from './shader-ast';
import {
  isMilkdropShaderSamplerName,
  isMilkdropVolumeShaderSamplerName,
  normalizeMilkdropShaderSamplerName,
} from './shader-samplers';
import type {
  MilkdropBackendSupport,
  MilkdropBackendSupportEvidence,
  MilkdropBlockingConstruct,
  MilkdropCompatibilityEvidence,
  MilkdropCompatibilityFeatureKey,
  MilkdropCompiledPreset,
  MilkdropCompileOptions,
  MilkdropDegradationReason,
  MilkdropDiagnostic,
  MilkdropDiagnosticSeverity,
  MilkdropExpressionNode,
  MilkdropExtractedShaderSampleMetadata,
  MilkdropFeatureAnalysis,
  MilkdropFeatureKey,
  MilkdropFidelityClass,
  MilkdropParityReport,
  MilkdropPresetAST,
  MilkdropPresetField,
  MilkdropPresetIR,
  MilkdropPresetSource,
  MilkdropProgramBlock,
  MilkdropRenderBackend,
  MilkdropShaderControlExpressions,
  MilkdropShaderControls,
  MilkdropShaderExpressionNode,
  MilkdropShaderProgramPayload,
  MilkdropShaderProgramStage,
  MilkdropShaderSampleDimension,
  MilkdropShaderStatement,
  MilkdropShaderTextureBlendMode,
  MilkdropShaderTextureSampler,
  MilkdropShapeDefinition,
  MilkdropWaveDefinition,
} from './types';

const MAX_CUSTOM_WAVES = 32;
const MAX_CUSTOM_SHAPES = 32;
const SHADER_TEXTURE_BLEND_MODES = new Set([
  'none',
  'replace',
  'mix',
  'add',
  'multiply',
]);

function createDefaultShapeSlot(index: number): Record<string, number> {
  if (index === 1) {
    return {
      shape_1_enabled: 1,
      shape_1_sides: 6,
      shape_1_x: 0.5,
      shape_1_y: 0.5,
      shape_1_rad: 0.17,
      shape_1_ang: 0,
      shape_1_a: 0.24,
      shape_1_r: 1,
      shape_1_g: 0.48,
      shape_1_b: 0.84,
      shape_1_a2: 0,
      shape_1_r2: 0,
      shape_1_g2: 0,
      shape_1_b2: 0,
      shape_1_border_a: 0.86,
      shape_1_border_r: 1,
      shape_1_border_g: 0.8,
      shape_1_border_b: 1,
      shape_1_additive: 1,
      shape_1_thickoutline: 1,
    };
  }

  const fallbackByIndex: Record<number, Record<string, number>> = {
    2: {
      sides: 5,
      rad: 0.12,
      a: 0.18,
      r: 0.8,
      g: 0.5,
      b: 1,
      border_a: 0.78,
      border_r: 0.9,
      border_g: 0.9,
      border_b: 1,
    },
    3: {
      sides: 4,
      rad: 0.1,
      a: 0.16,
      r: 1,
      g: 0.7,
      b: 0.4,
      border_a: 0.7,
      border_r: 1,
      border_g: 0.9,
      border_b: 0.5,
    },
    4: {
      sides: 8,
      rad: 0.09,
      a: 0.14,
      r: 0.6,
      g: 0.85,
      b: 1,
      border_a: 0.7,
      border_r: 0.75,
      border_g: 0.95,
      border_b: 1,
    },
    5: {
      sides: 7,
      rad: 0.08,
      a: 0.14,
      r: 1,
      g: 0.8,
      b: 0.45,
      border_a: 0.72,
      border_r: 1,
      border_g: 0.9,
      border_b: 0.6,
    },
    6: {
      sides: 3,
      rad: 0.07,
      a: 0.13,
      r: 0.8,
      g: 1,
      b: 0.55,
      border_a: 0.7,
      border_r: 0.9,
      border_g: 1,
      border_b: 0.7,
    },
    7: {
      sides: 9,
      rad: 0.06,
      a: 0.12,
      r: 0.7,
      g: 0.9,
      b: 1,
      border_a: 0.68,
      border_r: 0.8,
      border_g: 0.95,
      border_b: 1,
    },
    8: {
      sides: 5,
      rad: 0.05,
      a: 0.1,
      r: 1,
      g: 0.65,
      b: 0.9,
      border_a: 0.66,
      border_r: 1,
      border_g: 0.75,
      border_b: 0.95,
    },
  };

  const fallback = fallbackByIndex[index] ?? fallbackByIndex[8];
  return {
    [`shape_${index}_enabled`]: 0,
    [`shape_${index}_sides`]: fallback.sides,
    [`shape_${index}_x`]: 0.5,
    [`shape_${index}_y`]: 0.5,
    [`shape_${index}_rad`]: fallback.rad,
    [`shape_${index}_ang`]: 0,
    [`shape_${index}_a`]: fallback.a,
    [`shape_${index}_r`]: fallback.r,
    [`shape_${index}_g`]: fallback.g,
    [`shape_${index}_b`]: fallback.b,
    [`shape_${index}_a2`]: 0,
    [`shape_${index}_r2`]: 0,
    [`shape_${index}_g2`]: 0,
    [`shape_${index}_b2`]: 0,
    [`shape_${index}_border_a`]: fallback.border_a,
    [`shape_${index}_border_r`]: fallback.border_r,
    [`shape_${index}_border_g`]: fallback.border_g,
    [`shape_${index}_border_b`]: fallback.border_b,
    [`shape_${index}_additive`]: 0,
    [`shape_${index}_thickoutline`]: 0,
  };
}

function createDefaultCustomWaveSlot(index: number): Record<string, number> {
  return {
    [`custom_wave_${index}_enabled`]: 0,
    [`custom_wave_${index}_samples`]: 64,
    [`custom_wave_${index}_spectrum`]: 0,
    [`custom_wave_${index}_additive`]: 0,
    [`custom_wave_${index}_usedots`]: 0,
    [`custom_wave_${index}_scaling`]: 1,
    [`custom_wave_${index}_smoothing`]: 0.5,
    [`custom_wave_${index}_mystery`]: 0,
    [`custom_wave_${index}_thick`]: 1,
    [`custom_wave_${index}_x`]: 0.5,
    [`custom_wave_${index}_y`]: 0.5,
    [`custom_wave_${index}_r`]: 1,
    [`custom_wave_${index}_g`]: 1,
    [`custom_wave_${index}_b`]: 1,
    [`custom_wave_${index}_a`]: 0.4,
  };
}

export const DEFAULT_MILKDROP_STATE: Record<string, number> = {
  fRating: 3,
  beat_sensitivity: 0.7,
  blend_duration: 2.4,
  decay: 0.93,
  zoom: 1,
  zoomexp: 1,
  rot: 0,
  warp: 0.08,
  cx: 0.5,
  cy: 0.5,
  sx: 1,
  sy: 1,
  dx: 0,
  dy: 0,
  warpanimspeed: 1,
  shader: 1,
  modwavealphastart: 1,
  modwavealphaend: 1,
  wave_mode: 0,
  wave_scale: 1,
  wave_smoothing: 0.72,
  wave_a: 0.86,
  wave_r: 0.35,
  wave_g: 0.7,
  wave_b: 1,
  wave_x: 0.5,
  wave_y: 0.5,
  wave_mystery: 0.18,
  wave_thick: 1.4,
  wave_additive: 1,
  wave_usedots: 0,
  wave_brighten: 1,
  mesh_density: 18,
  mesh_alpha: 0.22,
  mesh_r: 0.3,
  mesh_g: 0.5,
  mesh_b: 0.95,
  bg_r: 0.02,
  bg_g: 0.03,
  bg_b: 0.06,
  brighten: 0,
  darken: 0,
  solarize: 0,
  invert: 0,
  gammaadj: 1,
  video_echo_enabled: 0,
  video_echo_alpha: 0.18,
  video_echo_zoom: 1.02,
  video_echo_orientation: 0,
  ob_size: 0,
  ob_r: 0.92,
  ob_g: 0.96,
  ob_b: 1,
  ob_a: 0.8,
  ib_size: 0,
  ib_r: 0.92,
  ib_g: 0.96,
  ib_b: 1,
  ib_a: 0.76,
  texture_wrap: 0,
  feedback_texture: 0,
  ob_border: 0,
  ib_border: 0,
  motion_vectors: 0,
  motion_vectors_x: 16,
  motion_vectors_y: 12,
  mv_dx: 0,
  mv_dy: 0,
  mv_l: 0,
  mv_r: 1,
  mv_g: 1,
  mv_b: 1,
  mv_a: 0.35,
  ...Object.fromEntries(
    Array.from({ length: MAX_CUSTOM_SHAPES }, (_, index) =>
      Object.entries(createDefaultShapeSlot(index + 1)),
    ).flat(),
  ),
  ...Object.fromEntries(
    Array.from({ length: MAX_CUSTOM_WAVES }, (_, index) =>
      Object.entries(createDefaultCustomWaveSlot(index + 1)),
    ).flat(),
  ),
};

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
type HardUnsupportedFieldSpec = {
  key: string;
  feature: MilkdropCompatibilityFeatureKey;
  message: string;
  aliases?: readonly string[];
};

type PendingHardUnsupportedField = HardUnsupportedFieldSpec & {
  line: number;
};

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
  webgpu: {
    'video-echo':
      'WebGPU still routes video echo through the legacy feedback path and may diverge from WebGL output.',
    'post-effects':
      'WebGPU post-processing parity is still incomplete for MilkDrop post effects.',
  },
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
      'WebGPU applies supported shader-text controls through a compatibility translation path that may not exactly match WebGL.',
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
    block.statements.some(
      (statement) =>
        statement.target === 'motion_vectors_x' ||
        statement.target === 'motion_vectors_y',
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

function buildBackendDivergence({
  webgl,
  webgpu,
}: {
  webgl: MilkdropBackendSupport;
  webgpu: MilkdropBackendSupport;
}) {
  const divergence = new Set<string>();
  if (webgl.status !== webgpu.status) {
    divergence.add(`status:webgl=${webgl.status},webgpu=${webgpu.status}`);
  }
  const webglEvidenceKeys = new Set(
    webgl.evidence.map((entry) => `${entry.code}:${entry.feature ?? 'none'}`),
  );
  const webgpuEvidenceKeys = new Set(
    webgpu.evidence.map((entry) => `${entry.code}:${entry.feature ?? 'none'}`),
  );
  webgl.evidence
    .filter(
      (entry) =>
        entry.scope === 'backend' &&
        !webgpuEvidenceKeys.has(`${entry.code}:${entry.feature ?? 'none'}`),
    )
    .forEach((entry) =>
      divergence.add(
        `webgl:${entry.code}${entry.feature ? `:${entry.feature}` : ''}`,
      ),
    );
  webgpu.evidence
    .filter(
      (entry) =>
        entry.scope === 'backend' &&
        !webglEvidenceKeys.has(`${entry.code}:${entry.feature ?? 'none'}`),
    )
    .forEach((entry) =>
      divergence.add(
        `webgpu:${entry.code}${entry.feature ? `:${entry.feature}` : ''}`,
      ),
    );
  return [...divergence];
}

function buildVisualFallbacks({
  approximatedShaderLines,
  webgl,
  webgpu,
}: {
  approximatedShaderLines: string[];
  webgl: MilkdropBackendSupport;
  webgpu: MilkdropBackendSupport;
}) {
  const fallbacks = new Set<string>();
  if (approximatedShaderLines.length > 0) {
    fallbacks.add('shader-text-control-extraction');
  }
  webgl.evidence
    .filter(
      (entry) => entry.status === 'unsupported' && entry.scope === 'backend',
    )
    .forEach((entry) =>
      fallbacks.add(
        `webgl:${entry.code}${entry.feature ? `:${entry.feature}` : ''}`,
      ),
    );
  webgpu.evidence
    .filter(
      (entry) => entry.status === 'unsupported' && entry.scope === 'backend',
    )
    .forEach((entry) =>
      fallbacks.add(
        `webgpu:${entry.code}${entry.feature ? `:${entry.feature}` : ''}`,
      ),
    );
  if (webgl.recommendedFallback) {
    fallbacks.add(`webgl->${webgl.recommendedFallback}`);
  }
  if (webgpu.recommendedFallback) {
    fallbacks.add(`webgpu->${webgpu.recommendedFallback}`);
  }
  return [...fallbacks];
}

function buildBlockingConstructDetails({
  sourceId,
  ignoredFields,
  hardUnsupportedFields,
  approximatedShaderLines,
}: {
  sourceId?: string;
  ignoredFields: string[];
  hardUnsupportedFields: Map<string, HardUnsupportedFieldSpec>;
  approximatedShaderLines: string[];
}): MilkdropBlockingConstruct[] {
  return [
    ...ignoredFields.map((value) => {
      const signature = toBlockedFieldConstruct(value);
      const hardUnsupportedField = hardUnsupportedFields.get(value);
      return {
        kind: 'field' as const,
        value,
        system: 'preset-field' as const,
        allowlisted: isMilkdropParityConstructAllowlisted({
          presetId: sourceId,
          signature,
        }),
        feature: hardUnsupportedField?.feature,
        classification: hardUnsupportedField
          ? ('hard-unsupported' as const)
          : ('soft-unknown' as const),
      };
    }),
    ...approximatedShaderLines.map((value) => {
      const signature = toBlockedShaderConstruct(value);
      return {
        kind: 'shader' as const,
        value,
        system: 'shader-text' as const,
        allowlisted: isMilkdropParityConstructAllowlisted({
          presetId: sourceId,
          signature,
        }),
      };
    }),
  ];
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

function buildDegradationReasons({
  blockedConstructDetails,
  backendDivergence,
  visualFallbacks,
  webgl,
  webgpu,
}: {
  blockedConstructDetails: MilkdropBlockingConstruct[];
  backendDivergence: string[];
  visualFallbacks: string[];
  webgl: MilkdropBackendSupport;
  webgpu: MilkdropBackendSupport;
}): MilkdropDegradationReason[] {
  const reasons: MilkdropDegradationReason[] = [];

  blockedConstructDetails.forEach((construct) => {
    if (construct.allowlisted) {
      reasons.push({
        code: 'allowlisted-gap',
        category: 'acceptable-approximation',
        message: `Allowlisted parity gap remains visible for ${construct.kind} "${construct.value}".`,
        system: construct.kind === 'field' ? 'compiler' : 'shader',
        blocking: false,
      });
      return;
    }
    reasons.push({
      code:
        construct.kind === 'field'
          ? construct.classification === 'hard-unsupported'
            ? 'unsupported-hard-feature'
            : 'unknown-field'
          : 'shader-approximation',
      category:
        construct.kind === 'field'
          ? 'unsupported-syntax'
          : 'unsupported-shader',
      message:
        construct.kind === 'field'
          ? construct.classification === 'hard-unsupported'
            ? `Unsupported feature "${construct.feature ?? construct.value}" is triggered by preset field "${construct.value}".`
            : `Unknown preset field "${construct.value}" was ignored.`
          : `Shader line "${construct.value}" could not be executed directly and is being approximated.`,
      system: construct.kind === 'field' ? 'compiler' : 'shader',
      blocking: true,
    });
  });

  const addBackendReason = (
    backend: 'webgl' | 'webgpu',
    support: MilkdropBackendSupport,
  ) => {
    if (support.evidence.length === 0) {
      return;
    }
    support.evidence.forEach((entry) => {
      reasons.push({
        code:
          entry.status === 'unsupported'
            ? 'backend-unsupported'
            : 'backend-partial',
        category: 'backend-degradation',
        message: `${backend.toUpperCase()}: ${entry.message}`,
        system: 'backend',
        blocking: entry.status === 'unsupported',
      });
    });
  };

  addBackendReason('webgl', webgl);
  addBackendReason('webgpu', webgpu);

  backendDivergence.forEach((divergence) => {
    reasons.push({
      code: 'backend-divergence',
      category: 'runtime-divergence',
      message: `Backends diverge for this preset: ${divergence}.`,
      system: 'runtime',
      blocking: false,
    });
  });

  visualFallbacks.forEach((fallback) => {
    reasons.push({
      code: 'visual-fallback',
      category: 'runtime-divergence',
      message: `Visual fallback active: ${fallback}.`,
      system: 'runtime',
      blocking: false,
    });
  });

  return reasons;
}

function classifyFidelity({
  blockedConstructDetails,
  degradationReasons,
  webgl,
  webgpu,
  noBlockedConstructs,
}: {
  blockedConstructDetails: MilkdropBlockingConstruct[];
  degradationReasons: MilkdropDegradationReason[];
  webgl: MilkdropBackendSupport;
  webgpu: MilkdropBackendSupport;
  noBlockedConstructs: boolean;
}): MilkdropFidelityClass {
  const hasBlockingConstruct = blockedConstructDetails.some(
    (construct) => !construct.allowlisted,
  );
  const blockingReasons = degradationReasons.filter(
    (reason) => reason.blocking,
  );
  const hasBlockingReason = blockingReasons.length > 0;
  const hasUnsupportedBackend =
    webgl.status === 'unsupported' || webgpu.status === 'unsupported';
  const hasBackendPartial = [...webgl.evidence, ...webgpu.evidence].some(
    (entry) => entry.status === 'partial',
  );
  const hasOnlyAllowlistedConstructs =
    blockedConstructDetails.length > 0 &&
    blockedConstructDetails.every((construct) => construct.allowlisted);
  const hasOnlyAllowlistedBackendBlockingReasons =
    hasOnlyAllowlistedConstructs &&
    hasBlockingReason &&
    blockingReasons.every((reason) => reason.code === 'backend-unsupported');

  if (
    (hasUnsupportedBackend || hasBlockingReason) &&
    !hasOnlyAllowlistedBackendBlockingReasons
  ) {
    return 'fallback';
  }
  if (hasBlockingConstruct) {
    return 'partial';
  }
  if (hasBackendPartial) {
    return 'near-exact';
  }
  if (!noBlockedConstructs || degradationReasons.length > 0) {
    return 'near-exact';
  }
  return 'exact';
}

function buildCompatibilityEvidence({
  diagnostics,
  visualEvidenceTier,
}: {
  diagnostics: MilkdropDiagnostic[];
  visualEvidenceTier: MilkdropParityReport['visualEvidenceTier'];
}): MilkdropCompatibilityEvidence {
  return {
    compile: diagnostics.some((entry) => entry.severity === 'error')
      ? 'issues'
      : 'verified',
    runtime: visualEvidenceTier === 'none' ? 'not-run' : 'smoke-tested',
    visual:
      visualEvidenceTier === 'visual' ? 'reference-suite' : 'not-captured',
  };
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

function createDefaultShaderControls(): MilkdropShaderControls {
  return {
    warpScale: 0,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    zoom: 1,
    saturation: 1,
    contrast: 1,
    colorScale: { r: 1, g: 1, b: 1 },
    hueShift: 0,
    mixAlpha: 0,
    brightenBoost: 0,
    invertBoost: 0,
    solarizeBoost: 0,
    tint: { r: 1, g: 1, b: 1 },
    textureLayer: {
      source: 'none',
      mode: 'none',
      sampleDimension: '2d',
      amount: 0,
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      volumeSliceZ: null,
    },
    warpTexture: {
      source: 'none',
      sampleDimension: '2d',
      amount: 0,
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      volumeSliceZ: null,
    },
  };
}

function createDefaultShaderControlExpressions(): MilkdropShaderControlExpressions {
  return {
    warpScale: null,
    offsetX: null,
    offsetY: null,
    rotation: null,
    zoom: null,
    saturation: null,
    contrast: null,
    colorScale: { r: null, g: null, b: null },
    hueShift: null,
    mixAlpha: null,
    brightenBoost: null,
    invertBoost: null,
    solarizeBoost: null,
    tint: { r: null, g: null, b: null },
    textureLayer: {
      sampleDimension: '2d',
      amount: null,
      scaleX: null,
      scaleY: null,
      offsetX: null,
      offsetY: null,
      volumeSliceZ: null,
    },
    warpTexture: {
      sampleDimension: '2d',
      amount: null,
      scaleX: null,
      scaleY: null,
      offsetX: null,
      offsetY: null,
      volumeSliceZ: null,
    },
  };
}

type ShaderRuntimeValue = Exclude<
  ReturnType<typeof evaluateMilkdropShaderExpression>,
  null
>;
type ShaderRuntimeEnv = Record<string, ShaderRuntimeValue>;
type ShaderExpressionEnv = Record<string, MilkdropShaderExpressionNode>;

function isShaderScalarValue(
  value: ReturnType<typeof evaluateMilkdropShaderExpression>,
): value is Extract<ShaderRuntimeValue, { kind: 'scalar' }> {
  return value?.kind === 'scalar';
}

function normalizeShaderCallName(value: string) {
  const normalized = value.toLowerCase();
  switch (normalized) {
    case 'float2':
      return 'vec2';
    case 'float3':
      return 'vec3';
    case 'texture':
    case 'texture2d':
    case 'tex2d':
      return 'tex2d';
    case 'texture3d':
    case 'tex3d':
      return 'tex3d';
    default:
      return normalized;
  }
}

function normalizeShaderSyntax(value: string) {
  return value
    .trim()
    .replace(/texture2d/giu, 'tex2d')
    .replace(/texture3d/giu, 'tex3d')
    .replace(/\btexture(?=\()/giu, 'tex2d')
    .replace(/\bfloat2(?=\()/giu, 'vec2')
    .replace(/\bfloat3(?=\()/giu, 'vec3');
}

function resolveShaderExpressionIdentifiers(
  node: MilkdropShaderExpressionNode,
  env: ShaderExpressionEnv,
  visited = new Set<string>(),
): MilkdropShaderExpressionNode {
  switch (node.type) {
    case 'identifier': {
      const key = node.name.toLowerCase();
      const resolved = env[key];
      if (!resolved || visited.has(key)) {
        return {
          ...node,
          name: key,
        };
      }
      const nextVisited = new Set(visited);
      nextVisited.add(key);
      return resolveShaderExpressionIdentifiers(resolved, env, nextVisited);
    }
    case 'unary':
      return {
        ...node,
        operand: resolveShaderExpressionIdentifiers(node.operand, env, visited),
      };
    case 'binary':
      return {
        ...node,
        left: resolveShaderExpressionIdentifiers(node.left, env, visited),
        right: resolveShaderExpressionIdentifiers(node.right, env, visited),
      };
    case 'call':
      return {
        ...node,
        name: normalizeShaderCallName(node.name),
        args: node.args.map((arg) =>
          resolveShaderExpressionIdentifiers(arg, env, visited),
        ),
      };
    case 'member':
      return {
        ...node,
        property: node.property.toLowerCase(),
        object: resolveShaderExpressionIdentifiers(node.object, env, visited),
      };
    case 'literal':
      return node;
  }
}

function toMilkdropExpression(
  node: MilkdropShaderExpressionNode,
): MilkdropExpressionNode | null {
  switch (node.type) {
    case 'literal':
      return { type: 'literal', value: node.value };
    case 'identifier':
      return { type: 'identifier', name: node.name.toLowerCase() };
    case 'unary': {
      const operand = toMilkdropExpression(node.operand);
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
      const left = toMilkdropExpression(node.left);
      const right = toMilkdropExpression(node.right);
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
      const name = normalizeShaderCallName(node.name);
      if (
        name === 'vec2' ||
        name === 'vec3' ||
        name === 'tex2d' ||
        name === 'tex3d'
      ) {
        return null;
      }
      const args = node.args
        .map((arg) => toMilkdropExpression(arg))
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

function cloneShaderNode(node: MilkdropShaderExpressionNode) {
  return resolveShaderExpressionIdentifiers(node, {});
}

function createShaderUnaryNode(
  operator: '+' | '-' | '!',
  operand: MilkdropShaderExpressionNode,
): MilkdropShaderExpressionNode {
  return {
    type: 'unary',
    operator,
    operand: cloneShaderNode(operand),
  };
}

function createShaderBinaryNode(
  operator:
    | '+'
    | '-'
    | '*'
    | '/'
    | '%'
    | '<'
    | '<='
    | '>'
    | '>='
    | '=='
    | '!='
    | '&&'
    | '||',
  left: MilkdropShaderExpressionNode,
  right: MilkdropShaderExpressionNode,
): MilkdropShaderExpressionNode {
  return {
    type: 'binary',
    operator,
    left: cloneShaderNode(left),
    right: cloneShaderNode(right),
  };
}

function expandShaderVectorComponents(
  node: MilkdropShaderExpressionNode,
  size: 2 | 3,
  expressionEnv: ShaderExpressionEnv,
): MilkdropShaderExpressionNode[] | null {
  const resolved = resolveShaderExpressionIdentifiers(node, expressionEnv);
  if (resolved.type === 'call') {
    const name = resolved.name.toLowerCase();
    if (name === `vec${size}` && resolved.args.length >= size) {
      return resolved.args.slice(0, size).map((arg) => cloneShaderNode(arg));
    }
  }
  if (resolved.type === 'unary') {
    const operand = expandShaderVectorComponents(
      resolved.operand,
      size,
      expressionEnv,
    );
    if (!operand) {
      return null;
    }
    return operand.map((component) =>
      createShaderUnaryNode(resolved.operator, component),
    );
  }
  if (resolved.type === 'binary') {
    const leftVector = expandShaderVectorComponents(
      resolved.left,
      size,
      expressionEnv,
    );
    const rightVector = expandShaderVectorComponents(
      resolved.right,
      size,
      expressionEnv,
    );
    const leftScalar = toMilkdropExpression(resolved.left)
      ? Array.from({ length: size }, () => cloneShaderNode(resolved.left))
      : null;
    const rightScalar = toMilkdropExpression(resolved.right)
      ? Array.from({ length: size }, () => cloneShaderNode(resolved.right))
      : null;
    const left = leftVector ?? leftScalar;
    const right = rightVector ?? rightScalar;
    if (!left || !right) {
      return null;
    }
    return left.map((component, index) =>
      createShaderBinaryNode(
        resolved.operator,
        component,
        right[index] as MilkdropShaderExpressionNode,
      ),
    );
  }
  return null;
}

function evaluateShaderScalarResult(
  node: MilkdropShaderExpressionNode,
  valueEnv: ShaderRuntimeEnv,
  scalarEnv: Record<string, number>,
  expressionEnv: ShaderExpressionEnv,
) {
  const resolved = resolveShaderExpressionIdentifiers(node, expressionEnv);
  const value = evaluateMilkdropShaderExpression(resolved, valueEnv, scalarEnv);
  if (!isShaderScalarValue(value)) {
    return null;
  }
  return {
    value: value.value,
    expression: toMilkdropExpression(resolved),
  };
}

function evaluateShaderVectorResult(
  node: MilkdropShaderExpressionNode,
  size: 2 | 3,
  valueEnv: ShaderRuntimeEnv,
  scalarEnv: Record<string, number>,
  expressionEnv: ShaderExpressionEnv,
) {
  const components = expandShaderVectorComponents(node, size, expressionEnv);
  if (!components) {
    return null;
  }
  const values = components
    .map((component) =>
      evaluateMilkdropShaderExpression(component, valueEnv, scalarEnv),
    )
    .filter((value): value is Extract<ShaderRuntimeValue, { kind: 'scalar' }> =>
      isShaderScalarValue(value),
    );
  if (values.length !== size) {
    return null;
  }
  return {
    values: values.map((value) => value.value),
    expressions: components.map((component) => toMilkdropExpression(component)),
  };
}

function parseShaderScalar(
  rawValue: string,
  env: Record<string, number> = DEFAULT_MILKDROP_STATE,
) {
  const numeric = Number(rawValue);
  if (Number.isFinite(numeric)) {
    return {
      value: numeric,
      expression: null,
    };
  }

  const expressionResult = parseMilkdropExpression(rawValue, 1);
  if (!expressionResult.value) {
    return null;
  }

  return {
    value: evaluateMilkdropExpression(expressionResult.value, env),
    expression: expressionResult.value,
  };
}

function splitShaderListValues(rawValue: string) {
  if (rawValue.includes(',')) {
    const values: string[] = [];
    let depth = 0;
    let start = 0;

    for (let index = 0; index < rawValue.length; index += 1) {
      const char = rawValue[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth = Math.max(depth - 1, 0);
      } else if (char === ',' && depth === 0) {
        values.push(rawValue.slice(start, index).trim());
        start = index + 1;
      }
    }

    values.push(rawValue.slice(start).trim());
    return values.filter(Boolean);
  }

  return rawValue
    .trim()
    .split(/\s+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseShaderTintList(
  rawValue: string,
  env: Record<string, number> = DEFAULT_MILKDROP_STATE,
) {
  const components = splitShaderListValues(rawValue)
    .slice(0, 3)
    .map((entry) => parseShaderScalar(entry, env));
  if (components.length < 3 || components.some((entry) => entry === null)) {
    return null;
  }
  const values = components as Array<{
    value: number;
    expression: MilkdropExpressionNode | null;
  }>;
  return {
    value: {
      r: Math.min(Math.max(values[0]?.value ?? 1, 0), 2),
      g: Math.min(Math.max(values[1]?.value ?? 1, 0), 2),
      b: Math.min(Math.max(values[2]?.value ?? 1, 0), 2),
    },
    expressions: {
      r: values[0]?.expression ?? null,
      g: values[1]?.expression ?? null,
      b: values[2]?.expression ?? null,
    },
  };
}

function parseShaderVec2List(
  rawValue: string,
  env: Record<string, number> = DEFAULT_MILKDROP_STATE,
) {
  const components = splitShaderListValues(rawValue)
    .slice(0, 2)
    .map((entry) => parseShaderScalar(entry, env));
  if (components.length < 2 || components.some((entry) => entry === null)) {
    return null;
  }
  const values = components as Array<{
    value: number;
    expression: MilkdropExpressionNode | null;
  }>;
  return {
    value: {
      x: values[0]?.value ?? 0,
      y: values[1]?.value ?? 0,
    },
    expressions: {
      x: values[0]?.expression ?? null,
      y: values[1]?.expression ?? null,
    },
  };
}

function parseShaderVec2Constructor(
  rawValue: string,
  env: Record<string, number> = DEFAULT_MILKDROP_STATE,
) {
  const match = normalizeShaderSyntax(rawValue).match(/^vec2\((.+)\)$/iu);
  if (!match) {
    return null;
  }
  return parseShaderVec2List(match[1] ?? '', env);
}

function createLiteralExpression(value: number): MilkdropExpressionNode {
  return {
    type: 'literal',
    value,
  };
}

function applyShaderExpressionOperator(
  operator: '=' | '+=' | '-=' | '*=' | '/=',
  currentValue: number,
  currentExpression: MilkdropExpressionNode | null,
  nextValue: number,
  nextExpression: MilkdropExpressionNode | null,
) {
  if (operator === '=') {
    return {
      value: nextValue,
      expression: nextExpression,
    };
  }

  const leftExpression =
    currentExpression ?? createLiteralExpression(currentValue);
  const rightExpression = nextExpression ?? createLiteralExpression(nextValue);
  const binaryOperator =
    operator === '+='
      ? '+'
      : operator === '-='
        ? '-'
        : operator === '*='
          ? '*'
          : '/';

  return {
    value:
      operator === '+='
        ? currentValue + nextValue
        : operator === '-='
          ? currentValue - nextValue
          : operator === '*='
            ? currentValue * nextValue
            : nextValue === 0
              ? 0
              : currentValue / nextValue,
    expression: {
      type: 'binary',
      operator: binaryOperator,
      left: leftExpression,
      right: rightExpression,
    } satisfies MilkdropExpressionNode,
  };
}

function applyShaderControlValue(
  operator: '=' | '+=' | '-=' | '*=' | '/=',
  currentValue: number,
  currentExpression: MilkdropExpressionNode | null,
  nextValue: number,
  nextExpression: MilkdropExpressionNode | null,
) {
  return applyShaderExpressionOperator(
    operator,
    currentValue,
    currentExpression,
    nextValue,
    nextExpression,
  );
}

function parseShaderVec3Constructor(
  rawValue: string,
  env: Record<string, number>,
) {
  const match = normalizeShaderSyntax(rawValue).match(/^vec3\((.+)\)$/iu);
  if (!match) {
    return null;
  }
  return parseShaderTintList(match[1] ?? '', env);
}

function parseShaderSampleMixPattern(rawValue: string) {
  const normalized = normalizeShaderSyntax(rawValue);
  const match = normalized.match(/^mix\((.+)\)$/iu);
  if (!match) {
    return null;
  }
  const parts = splitShaderListValues(match[1] ?? '');
  if (parts.length !== 3) {
    return null;
  }
  return {
    left: (parts[0] ?? '').replace(/\s+/gu, '').toLowerCase(),
    right: (parts[1] ?? '').replace(/\s+/gu, '').toLowerCase(),
    amount: parts[2] ?? '',
  };
}

function normalizeShaderSamplerName(
  value: string,
): MilkdropShaderTextureSampler | 'main' | null {
  return normalizeMilkdropShaderSamplerName(value);
}

function normalizeShaderTextureBlendMode(
  value: string,
): MilkdropShaderTextureBlendMode | null {
  const normalized = value.trim().toLowerCase();
  return SHADER_TEXTURE_BLEND_MODES.has(normalized)
    ? (normalized as MilkdropShaderTextureBlendMode)
    : null;
}

function parseShaderSamplerSource(
  rawValue: string,
): MilkdropShaderTextureSampler | 'main' | null {
  return normalizeShaderSamplerName(rawValue.replace(/[;,\s]+$/gu, ''));
}

function parseShaderTextureBlendMode(
  rawValue: string,
): MilkdropShaderTextureBlendMode | null {
  return normalizeShaderTextureBlendMode(rawValue.replace(/[;,\s]+$/gu, ''));
}

function isAuxShaderSamplerName(
  value: string,
): value is MilkdropShaderTextureSampler {
  return value !== 'main' && isMilkdropShaderSamplerName(value);
}

function buildUnsupportedVolumeSamplerWarnings(
  controls: Pick<MilkdropShaderControls, 'textureLayer' | 'warpTexture'>,
) {
  const warnings: string[] = [];
  const appendWarning = (
    controlName: 'textureLayer' | 'warpTexture',
    label: string,
    source: MilkdropShaderTextureSampler,
  ) => {
    if (
      controls[controlName].sampleDimension !== '3d' ||
      source === 'none' ||
      isMilkdropVolumeShaderSamplerName(source)
    ) {
      return;
    }
    warnings.push(
      `${label} uses tex3D/texture3D with aux sampler "${source}", but only "simplex" is backed by the runtime volume atlas; this lookup will be approximated from a 2D texture.`,
    );
  };

  appendWarning(
    'textureLayer',
    'Texture layer shader control',
    controls.textureLayer.source,
  );
  appendWarning(
    'warpTexture',
    'Warp texture shader control',
    controls.warpTexture.source,
  );

  return warnings;
}

function isKnownShaderScalarKey(key: string) {
  return new Set([
    'warp',
    'warp_scale',
    'dx',
    'offset_x',
    'translate_x',
    'dy',
    'offset_y',
    'translate_y',
    'rot',
    'rotation',
    'zoom',
    'scale',
    'saturation',
    'sat',
    'contrast',
    'r',
    'red',
    'g',
    'green',
    'b',
    'blue',
    'hue',
    'hue_shift',
    'mix',
    'feedback',
    'feedback_alpha',
    'brighten',
    'invert',
    'solarize',
    'texture_amount',
    'texture_mix',
    'texture_scale',
    'texture_scale_x',
    'texture_scale_y',
    'texture_offset_x',
    'texture_offset_y',
    'texture_scroll_x',
    'texture_scroll_y',
    'warp_texture_amount',
    'warp_texture_mix',
    'warp_texture_scale',
    'warp_texture_scale_x',
    'warp_texture_scale_y',
    'warp_texture_offset_x',
    'warp_texture_offset_y',
    'warp_texture_scroll_x',
    'warp_texture_scroll_y',
  ]).has(key);
}

function isIdentityTextureSampleExpression(rawValue: string) {
  const normalized = normalizeShaderSyntax(rawValue)
    .toLowerCase()
    .replace(/\s+/gu, '');
  return normalized === 'tex2d(sampler_main,uv).rgb';
}

function isShaderLiteralNumber(
  node: MilkdropShaderExpressionNode,
  value: number,
) {
  return node.type === 'literal' && Math.abs(node.value - value) < 0.000_001;
}

function isShaderSampleRgbExpression(
  node: MilkdropShaderExpressionNode,
): boolean {
  return (
    node.type === 'member' &&
    ['rgb', 'xyz'].includes(node.property.toLowerCase()) &&
    node.object.type === 'call' &&
    ['tex2d', 'tex3d'].includes(normalizeShaderCallName(node.object.name)) &&
    node.object.args.length >= 2
  );
}

function splitShaderSampleCoordinate(
  name: 'tex2d' | 'tex3d',
  coordinate: MilkdropShaderExpressionNode,
): {
  dimension: MilkdropShaderSampleDimension;
  uv: MilkdropShaderExpressionNode;
  z: MilkdropShaderExpressionNode | null;
} | null {
  if (name === 'tex2d') {
    return {
      dimension: '2d',
      uv: coordinate,
      z: null,
    };
  }

  if (
    coordinate.type === 'call' &&
    normalizeShaderCallName(coordinate.name) === 'vec3'
  ) {
    if (coordinate.args.length >= 2) {
      return {
        dimension: '3d',
        uv: coordinate.args[0] as MilkdropShaderExpressionNode,
        z: coordinate.args[1] as MilkdropShaderExpressionNode,
      };
    }

    if (coordinate.args.length >= 3) {
      const [x, y, z] = coordinate.args;
      if (x && y && z) {
        return {
          dimension: '3d',
          uv: {
            type: 'call',
            name: 'vec2',
            args: [x, y],
          },
          z,
        };
      }
    }
  }

  return null;
}

function getShaderSampleInfo(
  node: MilkdropShaderExpressionNode,
): MilkdropExtractedShaderSampleMetadata | null {
  if (
    node.type !== 'member' ||
    !['rgb', 'xyz'].includes(node.property.toLowerCase()) ||
    node.object.type !== 'call' ||
    !['tex2d', 'tex3d'].includes(normalizeShaderCallName(node.object.name)) ||
    node.object.args.length < 2
  ) {
    return null;
  }
  const samplerArg = node.object.args[0];
  const coordinateArg = node.object.args[1];
  if (!samplerArg || !coordinateArg) {
    return null;
  }
  const callName = normalizeShaderCallName(node.object.name) as
    | 'tex2d'
    | 'tex3d';
  const coordinate = splitShaderSampleCoordinate(callName, coordinateArg);
  if (!coordinate) {
    return null;
  }
  const source =
    samplerArg.type === 'identifier'
      ? normalizeShaderSamplerName(samplerArg.name)
      : 'main';
  if (!source) {
    return null;
  }
  return {
    source,
    sampleDimension: coordinate.dimension,
    uv: coordinate.uv,
    volumeSliceZ: coordinate.z,
  };
}

function isShaderMainSampleExpression(node: MilkdropShaderExpressionNode) {
  return getShaderSampleInfo(node)?.source === 'main';
}

function isShaderAuxSampleExpression(node: MilkdropShaderExpressionNode) {
  const source = getShaderSampleInfo(node)?.source;
  return Boolean(source && source !== 'main' && source !== 'none');
}

function extractScaledShaderSampleExpression(
  node: MilkdropShaderExpressionNode,
): {
  amountExpression: MilkdropExpressionNode | null;
  amountValue: number;
  sample: MilkdropExtractedShaderSampleMetadata;
} | null {
  const directSample = getShaderSampleInfo(node);
  if (
    directSample &&
    directSample.source !== 'main' &&
    directSample.source !== 'none'
  ) {
    return {
      amountExpression: createLiteralExpression(1),
      amountValue: 1,
      sample: directSample,
    };
  }

  if (
    node.type !== 'binary' ||
    node.operator !== '*' ||
    (!isShaderAuxSampleExpression(node.left) &&
      !isShaderAuxSampleExpression(node.right))
  ) {
    return null;
  }

  const sampleNode = isShaderAuxSampleExpression(node.left)
    ? node.left
    : node.right;
  const amountNode = sampleNode === node.left ? node.right : node.left;
  const sample = getShaderSampleInfo(sampleNode);
  if (!sample || sample.source === 'main' || sample.source === 'none') {
    return null;
  }

  const scalarExpression = toMilkdropExpression(amountNode);
  if (!scalarExpression) {
    return null;
  }

  return {
    amountExpression: scalarExpression,
    amountValue: evaluateMilkdropExpression(
      scalarExpression,
      DEFAULT_MILKDROP_STATE,
    ),
    sample,
  };
}

function analyzeShaderUvTransform(node: MilkdropShaderExpressionNode): {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
  expressions: {
    scaleX: MilkdropExpressionNode | null;
    scaleY: MilkdropExpressionNode | null;
    offsetX: MilkdropExpressionNode | null;
    offsetY: MilkdropExpressionNode | null;
  };
} | null {
  if (isShaderUvIdentifier(node)) {
    return {
      scaleX: 1,
      scaleY: 1,
      offsetX: 0,
      offsetY: 0,
      expressions: {
        scaleX: null,
        scaleY: null,
        offsetX: null,
        offsetY: null,
      },
    };
  }

  if (
    node.type === 'binary' &&
    (node.operator === '+' || node.operator === '-')
  ) {
    const base = analyzeShaderUvTransform(node.left);
    const offset = evaluateShaderVectorResult(
      node.right,
      2,
      { uv: { kind: 'vec2', value: [0, 0] } },
      DEFAULT_MILKDROP_STATE,
      {},
    );
    if (!base || !offset) {
      return null;
    }
    const sign = node.operator === '-' ? -1 : 1;
    return {
      scaleX: base.scaleX,
      scaleY: base.scaleY,
      offsetX: base.offsetX + offset.values[0] * sign,
      offsetY: base.offsetY + offset.values[1] * sign,
      expressions: {
        scaleX: base.expressions.scaleX,
        scaleY: base.expressions.scaleY,
        offsetX:
          offset.expressions[0] && sign === -1
            ? {
                type: 'unary',
                operator: '-',
                operand: offset.expressions[0],
              }
            : (offset.expressions[0] ?? base.expressions.offsetX),
        offsetY:
          offset.expressions[1] && sign === -1
            ? {
                type: 'unary',
                operator: '-',
                operand: offset.expressions[1],
              }
            : (offset.expressions[1] ?? base.expressions.offsetY),
      },
    };
  }

  if (node.type === 'binary' && node.operator === '*') {
    const uvSide = isShaderUvIdentifier(node.left)
      ? node.left
      : isShaderUvIdentifier(node.right)
        ? node.right
        : null;
    const scaleSide =
      uvSide === node.left
        ? node.right
        : uvSide === node.right
          ? node.left
          : null;
    if (!uvSide || !scaleSide) {
      return null;
    }

    const scalar = evaluateShaderScalarResult(
      scaleSide,
      { uv: { kind: 'vec2', value: [0, 0] } },
      DEFAULT_MILKDROP_STATE,
      {},
    );
    if (scalar) {
      return {
        scaleX: scalar.value,
        scaleY: scalar.value,
        offsetX: 0,
        offsetY: 0,
        expressions: {
          scaleX: scalar.expression,
          scaleY: scalar.expression,
          offsetX: null,
          offsetY: null,
        },
      };
    }

    const vector = evaluateShaderVectorResult(
      scaleSide,
      2,
      { uv: { kind: 'vec2', value: [0, 0] } },
      DEFAULT_MILKDROP_STATE,
      {},
    );
    if (!vector) {
      return null;
    }
    return {
      scaleX: vector.values[0],
      scaleY: vector.values[1],
      offsetX: 0,
      offsetY: 0,
      expressions: {
        scaleX: vector.expressions[0] ?? null,
        scaleY: vector.expressions[1] ?? null,
        offsetX: null,
        offsetY: null,
      },
    };
  }

  if (
    node.type === 'binary' &&
    node.operator === '+' &&
    node.left.type === 'binary' &&
    node.left.operator === '*'
  ) {
    const scaled = analyzeShaderUvTransform(node.left);
    const offset = evaluateShaderVectorResult(
      node.right,
      2,
      { uv: { kind: 'vec2', value: [0, 0] } },
      DEFAULT_MILKDROP_STATE,
      {},
    );
    if (!scaled || !offset) {
      return null;
    }
    return {
      scaleX: scaled.scaleX,
      scaleY: scaled.scaleY,
      offsetX: offset.values[0],
      offsetY: offset.values[1],
      expressions: {
        scaleX: scaled.expressions.scaleX,
        scaleY: scaled.expressions.scaleY,
        offsetX: offset.expressions[0] ?? null,
        offsetY: offset.expressions[1] ?? null,
      },
    };
  }

  return null;
}

function analyzeShaderVolumeSlice(node: MilkdropShaderExpressionNode | null): {
  value: number | null;
  expression: MilkdropExpressionNode | null;
} {
  if (!node) {
    return {
      value: null,
      expression: null,
    };
  }

  const scalar = evaluateShaderScalarResult(
    node,
    { uv: { kind: 'vec2', value: [0, 0] } },
    DEFAULT_MILKDROP_STATE,
    {},
  );
  return {
    value: scalar?.value ?? null,
    expression: scalar?.expression ?? null,
  };
}

function analyzeShaderSampleCoordinate(
  sample: MilkdropExtractedShaderSampleMetadata,
) {
  return {
    uv: analyzeShaderUvTransform(sample.uv),
    volumeSlice: analyzeShaderVolumeSlice(sample.volumeSliceZ),
  };
}

function applyTextureLayerSample(
  controls: MilkdropShaderControls,
  expressions: MilkdropShaderControlExpressions,
  sample: MilkdropExtractedShaderSampleMetadata,
) {
  const coordinate = analyzeShaderSampleCoordinate(sample);
  controls.textureLayer.source = sample.source as MilkdropShaderTextureSampler;
  controls.textureLayer.sampleDimension = sample.sampleDimension;
  controls.textureLayer.volumeSliceZ = coordinate.volumeSlice.value;
  expressions.textureLayer.sampleDimension = sample.sampleDimension;
  expressions.textureLayer.volumeSliceZ = coordinate.volumeSlice.expression;
  if (coordinate.uv) {
    controls.textureLayer.scaleX = coordinate.uv.scaleX;
    controls.textureLayer.scaleY = coordinate.uv.scaleY;
    controls.textureLayer.offsetX = coordinate.uv.offsetX;
    controls.textureLayer.offsetY = coordinate.uv.offsetY;
    expressions.textureLayer.scaleX = coordinate.uv.expressions.scaleX;
    expressions.textureLayer.scaleY = coordinate.uv.expressions.scaleY;
    expressions.textureLayer.offsetX = coordinate.uv.expressions.offsetX;
    expressions.textureLayer.offsetY = coordinate.uv.expressions.offsetY;
  }
}

function isShaderUvIdentifier(node: MilkdropShaderExpressionNode) {
  return node.type === 'identifier' && node.name.toLowerCase() === 'uv';
}

function extractShaderInvertedSampleExpression(
  node: MilkdropShaderExpressionNode,
): MilkdropExtractedShaderSampleMetadata | 'main' | null {
  if (
    node.type !== 'binary' ||
    node.operator !== '-' ||
    !isShaderLiteralNumber(node.left, 1)
  ) {
    return null;
  }

  const sample = getShaderSampleInfo(node.right);
  if (!sample) {
    return null;
  }

  return sample.source === 'main' ? 'main' : sample;
}

function isShaderSolarizeSampleExpression(
  node: MilkdropShaderExpressionNode,
): boolean {
  if (
    node.type !== 'binary' ||
    node.operator !== '*' ||
    !isShaderLiteralNumber(node.right, 1.5)
  ) {
    return false;
  }
  const absCall = node.left;
  if (
    absCall.type !== 'call' ||
    absCall.name.toLowerCase() !== 'abs' ||
    absCall.args.length < 1
  ) {
    return false;
  }
  const arg = absCall.args[0];
  if (arg?.type !== 'binary' || arg.operator !== '-') {
    return false;
  }
  const right = arg.right;
  const centeredSample =
    isShaderMainSampleExpression(arg.left) &&
    (isShaderLiteralNumber(right, 0.5) ||
      (right?.type === 'call' &&
        normalizeShaderCallName(right.name) === 'vec3' &&
        right.args.length >= 1 &&
        right.args.every((entry) => isShaderLiteralNumber(entry, 0.5))));
  return centeredSample;
}

function buildTintBlendExpression(
  tintExpression: MilkdropExpressionNode | null,
  amountExpression: MilkdropExpressionNode | null,
) {
  if (!tintExpression || !amountExpression) {
    return tintExpression;
  }
  return {
    type: 'binary',
    operator: '+',
    left: createLiteralExpression(1),
    right: {
      type: 'binary',
      operator: '*',
      left: {
        type: 'binary',
        operator: '-',
        left: tintExpression,
        right: createLiteralExpression(1),
      },
      right: amountExpression,
    },
  } satisfies MilkdropExpressionNode;
}

function applyShaderAstStatement({
  statement,
  controls,
  expressions,
  shaderEnv,
  shaderValueEnv,
  shaderExpressionEnv,
}: {
  statement: MilkdropShaderStatement;
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
  shaderEnv: Record<string, number>;
  shaderValueEnv: ShaderRuntimeEnv;
  shaderExpressionEnv: ShaderExpressionEnv;
}) {
  const key = statement.target.toLowerCase();
  const operator = statement.operator;
  const resolvedExpression = resolveShaderExpressionIdentifiers(
    statement.expression,
    shaderExpressionEnv,
  );

  const scalarResult = () =>
    evaluateShaderScalarResult(
      resolvedExpression,
      shaderValueEnv,
      shaderEnv,
      shaderExpressionEnv,
    );
  const vec2Result = () =>
    evaluateShaderVectorResult(
      resolvedExpression,
      2,
      shaderValueEnv,
      shaderEnv,
      shaderExpressionEnv,
    );
  const vec3Result = () =>
    evaluateShaderVectorResult(
      resolvedExpression,
      3,
      shaderValueEnv,
      shaderEnv,
      shaderExpressionEnv,
    );

  if (
    (statement.declaration === 'vec2' || statement.declaration === 'vec3') &&
    key !== 'uv' &&
    key !== 'tint' &&
    key !== 'ret' &&
    key !== 'shader_body'
  ) {
    const evaluatedValue = evaluateMilkdropShaderExpression(
      resolvedExpression,
      shaderValueEnv,
      shaderEnv,
    );
    if (!evaluatedValue) {
      return false;
    }
    shaderValueEnv[key] = evaluatedValue;
    shaderExpressionEnv[key] = resolvedExpression;
    return true;
  }

  if (key === 'texture_source') {
    const source =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderSamplerName(resolvedExpression.name)
        : parseShaderSamplerSource(statement.rawValue);
    if (!source || !isAuxShaderSamplerName(source)) {
      return false;
    }
    controls.textureLayer.source = source;
    if (controls.textureLayer.mode === 'none') {
      controls.textureLayer.mode = 'mix';
    }
    return true;
  }

  if (key === 'texture_mode') {
    const mode =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderTextureBlendMode(resolvedExpression.name)
        : parseShaderTextureBlendMode(statement.rawValue);
    if (!mode) {
      return false;
    }
    controls.textureLayer.mode = mode;
    return true;
  }

  if (key === 'warp_texture_source') {
    const source =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderSamplerName(resolvedExpression.name)
        : parseShaderSamplerSource(statement.rawValue);
    if (!source || !isAuxShaderSamplerName(source)) {
      return false;
    }
    controls.warpTexture.source = source;
    return true;
  }

  if (key === 'uv') {
    const directVec = vec2Result();
    if ((operator === '+=' || operator === '-=') && directVec) {
      const sign = operator === '-=' ? -1 : 1;
      const nextX = applyShaderControlValue(
        '=',
        controls.offsetX,
        expressions.offsetX,
        directVec.values[0] * sign,
        directVec.expressions[0] ?? null,
      );
      const nextY = applyShaderControlValue(
        '=',
        controls.offsetY,
        expressions.offsetY,
        directVec.values[1] * sign,
        directVec.expressions[1] ?? null,
      );
      controls.offsetX = nextX.value;
      controls.offsetY = nextY.value;
      expressions.offsetX = nextX.expression;
      expressions.offsetY = nextY.expression;
      shaderEnv.offset_x = nextX.value;
      shaderEnv.offset_y = nextY.value;
      shaderEnv.dx = nextX.value;
      shaderEnv.dy = nextY.value;
      shaderValueEnv.uv = {
        kind: 'vec2',
        value: [nextX.value, nextY.value],
      };
      return true;
    }

    if (
      operator === '=' &&
      resolvedExpression.type === 'binary' &&
      ['+', '-'].includes(resolvedExpression.operator) &&
      isShaderUvIdentifier(resolvedExpression.left)
    ) {
      const offset = evaluateShaderVectorResult(
        resolvedExpression.right,
        2,
        shaderValueEnv,
        shaderEnv,
        shaderExpressionEnv,
      );
      if (offset) {
        const sign = resolvedExpression.operator === '-' ? -1 : 1;
        const nextX = applyShaderControlValue(
          '=',
          controls.offsetX,
          expressions.offsetX,
          offset.values[0] * sign,
          offset.expressions[0] ?? null,
        );
        const nextY = applyShaderControlValue(
          '=',
          controls.offsetY,
          expressions.offsetY,
          offset.values[1] * sign,
          offset.expressions[1] ?? null,
        );
        controls.offsetX = nextX.value;
        controls.offsetY = nextY.value;
        expressions.offsetX = nextX.expression;
        expressions.offsetY = nextY.expression;
        shaderEnv.offset_x = nextX.value;
        shaderEnv.offset_y = nextY.value;
        shaderEnv.dx = nextX.value;
        shaderEnv.dy = nextY.value;
        shaderValueEnv.uv = {
          kind: 'vec2',
          value: [nextX.value, nextY.value],
        };
        return true;
      }
    }
  }

  if (key === 'tint') {
    const tint = vec3Result();
    if (tint) {
      const nextR = applyShaderControlValue(
        operator,
        controls.tint.r,
        expressions.tint.r,
        tint.values[0],
        tint.expressions[0] ?? null,
      );
      const nextG = applyShaderControlValue(
        operator,
        controls.tint.g,
        expressions.tint.g,
        tint.values[1],
        tint.expressions[1] ?? null,
      );
      const nextB = applyShaderControlValue(
        operator,
        controls.tint.b,
        expressions.tint.b,
        tint.values[2],
        tint.expressions[2] ?? null,
      );
      controls.tint = {
        r: nextR.value,
        g: nextG.value,
        b: nextB.value,
      };
      expressions.tint = {
        r: nextR.expression,
        g: nextG.expression,
        b: nextB.expression,
      };
      shaderEnv.tint_r = nextR.value;
      shaderEnv.tint_g = nextG.value;
      shaderEnv.tint_b = nextB.value;
      return true;
    }
  }

  if (key === 'texture_offset' || key === 'texture_scroll') {
    const offset = vec2Result();
    if (offset) {
      const nextX = applyShaderControlValue(
        operator,
        controls.textureLayer.offsetX,
        expressions.textureLayer.offsetX,
        offset.values[0],
        offset.expressions[0] ?? null,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.textureLayer.offsetY,
        expressions.textureLayer.offsetY,
        offset.values[1],
        offset.expressions[1] ?? null,
      );
      controls.textureLayer.offsetX = nextX.value;
      controls.textureLayer.offsetY = nextY.value;
      expressions.textureLayer.offsetX = nextX.expression;
      expressions.textureLayer.offsetY = nextY.expression;
      return true;
    }
  }

  if (key === 'texture_scale') {
    const scale = vec2Result();
    if (scale) {
      const nextX = applyShaderControlValue(
        operator,
        controls.textureLayer.scaleX,
        expressions.textureLayer.scaleX,
        scale.values[0],
        scale.expressions[0] ?? null,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.textureLayer.scaleY,
        expressions.textureLayer.scaleY,
        scale.values[1],
        scale.expressions[1] ?? null,
      );
      controls.textureLayer.scaleX = nextX.value;
      controls.textureLayer.scaleY = nextY.value;
      expressions.textureLayer.scaleX = nextX.expression;
      expressions.textureLayer.scaleY = nextY.expression;
      return true;
    }
  }

  if (key === 'warp_texture_offset' || key === 'warp_texture_scroll') {
    const offset = vec2Result();
    if (offset) {
      const nextX = applyShaderControlValue(
        operator,
        controls.warpTexture.offsetX,
        expressions.warpTexture.offsetX,
        offset.values[0],
        offset.expressions[0] ?? null,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.warpTexture.offsetY,
        expressions.warpTexture.offsetY,
        offset.values[1],
        offset.expressions[1] ?? null,
      );
      controls.warpTexture.offsetX = nextX.value;
      controls.warpTexture.offsetY = nextY.value;
      expressions.warpTexture.offsetX = nextX.expression;
      expressions.warpTexture.offsetY = nextY.expression;
      return true;
    }
  }

  if (key === 'warp_texture_scale') {
    const scale = vec2Result();
    if (scale) {
      const nextX = applyShaderControlValue(
        operator,
        controls.warpTexture.scaleX,
        expressions.warpTexture.scaleX,
        scale.values[0],
        scale.expressions[0] ?? null,
      );
      const nextY = applyShaderControlValue(
        operator,
        controls.warpTexture.scaleY,
        expressions.warpTexture.scaleY,
        scale.values[1],
        scale.expressions[1] ?? null,
      );
      controls.warpTexture.scaleX = nextX.value;
      controls.warpTexture.scaleY = nextY.value;
      expressions.warpTexture.scaleX = nextX.expression;
      expressions.warpTexture.scaleY = nextY.expression;
      return true;
    }
  }

  if (key === 'ret' || key === 'shader_body') {
    const directSample = getShaderSampleInfo(resolvedExpression);
    if (directSample && directSample.source === 'main') {
      return true;
    }

    if (
      directSample &&
      directSample.source !== 'main' &&
      directSample.source !== 'none'
    ) {
      if (!isAuxShaderSamplerName(directSample.source)) {
        return false;
      }
      controls.textureLayer.mode = 'replace';
      controls.textureLayer.amount = 1;
      expressions.textureLayer.amount = createLiteralExpression(1);
      applyTextureLayerSample(controls, expressions, directSample);
      return true;
    }

    if (
      resolvedExpression.type === 'binary' &&
      resolvedExpression.operator === '*' &&
      (isShaderSampleRgbExpression(resolvedExpression.left) ||
        isShaderSampleRgbExpression(resolvedExpression.right))
    ) {
      const scaleNode = isShaderSampleRgbExpression(resolvedExpression.left)
        ? resolvedExpression.right
        : resolvedExpression.left;
      const colorScale = evaluateShaderVectorResult(
        scaleNode,
        3,
        shaderValueEnv,
        shaderEnv,
        shaderExpressionEnv,
      );
      if (colorScale) {
        const nextR = applyShaderControlValue(
          operator,
          controls.colorScale.r,
          expressions.colorScale.r,
          colorScale.values[0],
          colorScale.expressions[0] ?? null,
        );
        const nextG = applyShaderControlValue(
          operator,
          controls.colorScale.g,
          expressions.colorScale.g,
          colorScale.values[1],
          colorScale.expressions[1] ?? null,
        );
        const nextB = applyShaderControlValue(
          operator,
          controls.colorScale.b,
          expressions.colorScale.b,
          colorScale.values[2],
          colorScale.expressions[2] ?? null,
        );
        controls.colorScale = {
          r: nextR.value,
          g: nextG.value,
          b: nextB.value,
        };
        expressions.colorScale = {
          r: nextR.expression,
          g: nextG.expression,
          b: nextB.expression,
        };
        shaderEnv.r = nextR.value;
        shaderEnv.g = nextG.value;
        shaderEnv.b = nextB.value;
        return true;
      }

      const scalarScale = evaluateShaderScalarResult(
        scaleNode,
        shaderValueEnv,
        shaderEnv,
        shaderExpressionEnv,
      );
      if (scalarScale) {
        (['r', 'g', 'b'] as const).forEach((channel) => {
          const next = applyShaderControlValue(
            operator,
            controls.colorScale[channel],
            expressions.colorScale[channel],
            scalarScale.value,
            scalarScale.expression,
          );
          controls.colorScale[channel] = next.value;
          expressions.colorScale[channel] = next.expression;
          shaderEnv[channel] = next.value;
        });
        return true;
      }
    }

    if (
      resolvedExpression.type === 'call' &&
      resolvedExpression.name.toLowerCase() === 'mix' &&
      resolvedExpression.args.length >= 3 &&
      isShaderSampleRgbExpression(
        resolvedExpression.args[0] as MilkdropShaderExpressionNode,
      )
    ) {
      const baseSample = getShaderSampleInfo(
        resolvedExpression.args[0] as MilkdropShaderExpressionNode,
      );
      const amount = evaluateShaderScalarResult(
        resolvedExpression.args[2] as MilkdropShaderExpressionNode,
        shaderValueEnv,
        shaderEnv,
        shaderExpressionEnv,
      );
      if (amount && baseSample?.source === 'main') {
        const targetNode = resolvedExpression
          .args[1] as MilkdropShaderExpressionNode;
        const auxSample = getShaderSampleInfo(targetNode);
        if (
          auxSample &&
          auxSample.source !== 'main' &&
          auxSample.source !== 'none'
        ) {
          if (!isAuxShaderSamplerName(auxSample.source)) {
            return false;
          }
          controls.textureLayer.mode = 'mix';
          controls.textureLayer.amount = amount.value;
          expressions.textureLayer.amount = amount.expression;
          applyTextureLayerSample(controls, expressions, auxSample);
          return true;
        }
        const invertedSample =
          extractShaderInvertedSampleExpression(targetNode);
        if (invertedSample) {
          if (invertedSample === 'main') {
            const next = applyShaderControlValue(
              operator,
              controls.invertBoost,
              expressions.invertBoost,
              amount.value,
              amount.expression,
            );
            controls.invertBoost = next.value;
            expressions.invertBoost = next.expression;
            shaderEnv.invert = next.value;
            return true;
          }
          if (!isAuxShaderSamplerName(invertedSample.source)) {
            return false;
          }
          controls.textureLayer.mode = 'mix';
          controls.textureLayer.amount = amount.value;
          expressions.textureLayer.amount = amount.expression;
          applyTextureLayerSample(controls, expressions, invertedSample);
          return false;
        }
        if (isShaderSolarizeSampleExpression(targetNode)) {
          const next = applyShaderControlValue(
            operator,
            controls.solarizeBoost,
            expressions.solarizeBoost,
            amount.value,
            amount.expression,
          );
          controls.solarizeBoost = next.value;
          expressions.solarizeBoost = next.expression;
          shaderEnv.solarize = next.value;
          return true;
        }
        const tint = evaluateShaderVectorResult(
          targetNode,
          3,
          shaderValueEnv,
          shaderEnv,
          shaderExpressionEnv,
        );
        if (tint) {
          const nextR = applyShaderControlValue(
            operator,
            controls.tint.r,
            expressions.tint.r,
            1 + (tint.values[0] - 1) * amount.value,
            buildTintBlendExpression(
              tint.expressions[0] ?? null,
              amount.expression,
            ),
          );
          const nextG = applyShaderControlValue(
            operator,
            controls.tint.g,
            expressions.tint.g,
            1 + (tint.values[1] - 1) * amount.value,
            buildTintBlendExpression(
              tint.expressions[1] ?? null,
              amount.expression,
            ),
          );
          const nextB = applyShaderControlValue(
            operator,
            controls.tint.b,
            expressions.tint.b,
            1 + (tint.values[2] - 1) * amount.value,
            buildTintBlendExpression(
              tint.expressions[2] ?? null,
              amount.expression,
            ),
          );
          controls.tint = {
            r: nextR.value,
            g: nextG.value,
            b: nextB.value,
          };
          expressions.tint = {
            r: nextR.expression,
            g: nextG.expression,
            b: nextB.expression,
          };
          shaderEnv.tint_r = nextR.value;
          shaderEnv.tint_g = nextG.value;
          shaderEnv.tint_b = nextB.value;
          return true;
        }
      }
    }

    if (
      resolvedExpression.type === 'binary' &&
      resolvedExpression.operator === '+' &&
      (isShaderMainSampleExpression(resolvedExpression.left) ||
        isShaderMainSampleExpression(resolvedExpression.right))
    ) {
      const auxNode = isShaderMainSampleExpression(resolvedExpression.left)
        ? resolvedExpression.right
        : resolvedExpression.left;
      const auxSample = extractScaledShaderSampleExpression(auxNode);
      if (auxSample) {
        if (!isAuxShaderSamplerName(auxSample.sample.source)) {
          return false;
        }
        controls.textureLayer.mode = 'add';
        controls.textureLayer.amount = auxSample.amountValue;
        expressions.textureLayer.amount = auxSample.amountExpression;
        applyTextureLayerSample(controls, expressions, auxSample.sample);
        return true;
      }
    }

    if (
      resolvedExpression.type === 'binary' &&
      resolvedExpression.operator === '*' &&
      (isShaderMainSampleExpression(resolvedExpression.left) ||
        isShaderMainSampleExpression(resolvedExpression.right))
    ) {
      const auxNode = isShaderMainSampleExpression(resolvedExpression.left)
        ? resolvedExpression.right
        : resolvedExpression.left;
      const auxSample = extractScaledShaderSampleExpression(auxNode);
      if (auxSample) {
        if (!isAuxShaderSamplerName(auxSample.sample.source)) {
          return false;
        }
        controls.textureLayer.mode = 'multiply';
        controls.textureLayer.amount = auxSample.amountValue;
        expressions.textureLayer.amount = auxSample.amountExpression;
        applyTextureLayerSample(controls, expressions, auxSample.sample);
        return true;
      }
    }
  }

  const scalarAliases = {
    warp: ['warp', 'warp_scale'],
    offsetX: ['dx', 'offset_x', 'translate_x'],
    offsetY: ['dy', 'offset_y', 'translate_y'],
    rotation: ['rot', 'rotation'],
    zoom: ['zoom', 'scale'],
    saturation: ['saturation', 'sat'],
    contrast: ['contrast'],
    colorScaleR: ['r', 'red'],
    colorScaleG: ['g', 'green'],
    colorScaleB: ['b', 'blue'],
    hueShift: ['hue', 'hue_shift'],
    mixAlpha: ['mix', 'feedback', 'feedback_alpha'],
    brightenBoost: ['brighten'],
    invertBoost: ['invert'],
    solarizeBoost: ['solarize'],
    textureAmount: ['texture_amount', 'texture_mix'],
    textureScaleX: ['texture_scale', 'texture_scale_x'],
    textureScaleY: ['texture_scale', 'texture_scale_y'],
    textureOffsetX: ['texture_offset_x', 'texture_scroll_x'],
    textureOffsetY: ['texture_offset_y', 'texture_scroll_y'],
    warpTextureAmount: ['warp_texture_amount', 'warp_texture_mix'],
    warpTextureScaleX: ['warp_texture_scale', 'warp_texture_scale_x'],
    warpTextureScaleY: ['warp_texture_scale', 'warp_texture_scale_y'],
    warpTextureOffsetX: ['warp_texture_offset_x', 'warp_texture_scroll_x'],
    warpTextureOffsetY: ['warp_texture_offset_y', 'warp_texture_scroll_y'],
  } as const;
  const matchesAlias = (aliases: readonly string[]) => aliases.includes(key);
  const numeric = scalarResult();
  if (numeric) {
    const updateScalarControl = (
      currentValue: number,
      currentExpression: MilkdropExpressionNode | null,
    ) => {
      return applyShaderExpressionOperator(
        operator,
        currentValue,
        currentExpression,
        numeric.value,
        numeric.expression,
      );
    };

    if (matchesAlias(scalarAliases.warp)) {
      const next = updateScalarControl(
        controls.warpScale,
        expressions.warpScale,
      );
      controls.warpScale = next.value;
      expressions.warpScale = next.expression;
      shaderEnv.warp = next.value;
      shaderEnv.warp_scale = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.offsetX)) {
      const next = updateScalarControl(controls.offsetX, expressions.offsetX);
      controls.offsetX = next.value;
      expressions.offsetX = next.expression;
      shaderEnv.dx = next.value;
      shaderEnv.offset_x = next.value;
      shaderEnv.translate_x = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.offsetY)) {
      const next = updateScalarControl(controls.offsetY, expressions.offsetY);
      controls.offsetY = next.value;
      expressions.offsetY = next.expression;
      shaderEnv.dy = next.value;
      shaderEnv.offset_y = next.value;
      shaderEnv.translate_y = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.rotation)) {
      const next = updateScalarControl(controls.rotation, expressions.rotation);
      controls.rotation = next.value;
      expressions.rotation = next.expression;
      shaderEnv.rot = next.value;
      shaderEnv.rotation = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.zoom)) {
      const next = updateScalarControl(controls.zoom, expressions.zoom);
      controls.zoom = next.value;
      expressions.zoom = next.expression;
      shaderEnv.zoom = next.value;
      shaderEnv.scale = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.saturation)) {
      const next = updateScalarControl(
        controls.saturation,
        expressions.saturation,
      );
      controls.saturation = next.value;
      expressions.saturation = next.expression;
      shaderEnv.saturation = next.value;
      shaderEnv.sat = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.contrast)) {
      const next = updateScalarControl(controls.contrast, expressions.contrast);
      controls.contrast = next.value;
      expressions.contrast = next.expression;
      shaderEnv.contrast = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.colorScaleR)) {
      const next = updateScalarControl(
        controls.colorScale.r,
        expressions.colorScale.r,
      );
      controls.colorScale.r = next.value;
      expressions.colorScale.r = next.expression;
      shaderEnv.r = next.value;
      shaderEnv.red = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.colorScaleG)) {
      const next = updateScalarControl(
        controls.colorScale.g,
        expressions.colorScale.g,
      );
      controls.colorScale.g = next.value;
      expressions.colorScale.g = next.expression;
      shaderEnv.g = next.value;
      shaderEnv.green = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.colorScaleB)) {
      const next = updateScalarControl(
        controls.colorScale.b,
        expressions.colorScale.b,
      );
      controls.colorScale.b = next.value;
      expressions.colorScale.b = next.expression;
      shaderEnv.b = next.value;
      shaderEnv.blue = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.hueShift)) {
      const next = updateScalarControl(controls.hueShift, expressions.hueShift);
      controls.hueShift = next.value;
      expressions.hueShift = next.expression;
      shaderEnv.hue = next.value;
      shaderEnv.hue_shift = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.mixAlpha)) {
      const next = updateScalarControl(controls.mixAlpha, expressions.mixAlpha);
      controls.mixAlpha = next.value;
      expressions.mixAlpha = next.expression;
      shaderEnv.mix = next.value;
      shaderEnv.feedback = next.value;
      shaderEnv.feedback_alpha = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.brightenBoost)) {
      const next = updateScalarControl(
        controls.brightenBoost,
        expressions.brightenBoost,
      );
      controls.brightenBoost = next.value;
      expressions.brightenBoost = next.expression;
      shaderEnv.brighten = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.invertBoost)) {
      const next = updateScalarControl(
        controls.invertBoost,
        expressions.invertBoost,
      );
      controls.invertBoost = next.value;
      expressions.invertBoost = next.expression;
      shaderEnv.invert = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.solarizeBoost)) {
      const next = updateScalarControl(
        controls.solarizeBoost,
        expressions.solarizeBoost,
      );
      controls.solarizeBoost = next.value;
      expressions.solarizeBoost = next.expression;
      shaderEnv.solarize = next.value;
      return true;
    }
    if (matchesAlias(scalarAliases.textureAmount)) {
      const next = updateScalarControl(
        controls.textureLayer.amount,
        expressions.textureLayer.amount,
      );
      controls.textureLayer.amount = next.value;
      expressions.textureLayer.amount = next.expression;
      if (controls.textureLayer.mode === 'none') {
        controls.textureLayer.mode = 'mix';
      }
      return true;
    }
    if (matchesAlias(scalarAliases.textureScaleX)) {
      const next = updateScalarControl(
        controls.textureLayer.scaleX,
        expressions.textureLayer.scaleX,
      );
      controls.textureLayer.scaleX = next.value;
      expressions.textureLayer.scaleX = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.textureScaleY)) {
      const next = updateScalarControl(
        controls.textureLayer.scaleY,
        expressions.textureLayer.scaleY,
      );
      controls.textureLayer.scaleY = next.value;
      expressions.textureLayer.scaleY = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.textureOffsetX)) {
      const next = updateScalarControl(
        controls.textureLayer.offsetX,
        expressions.textureLayer.offsetX,
      );
      controls.textureLayer.offsetX = next.value;
      expressions.textureLayer.offsetX = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.textureOffsetY)) {
      const next = updateScalarControl(
        controls.textureLayer.offsetY,
        expressions.textureLayer.offsetY,
      );
      controls.textureLayer.offsetY = next.value;
      expressions.textureLayer.offsetY = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.warpTextureAmount)) {
      const next = updateScalarControl(
        controls.warpTexture.amount,
        expressions.warpTexture.amount,
      );
      controls.warpTexture.amount = next.value;
      expressions.warpTexture.amount = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.warpTextureScaleX)) {
      const next = updateScalarControl(
        controls.warpTexture.scaleX,
        expressions.warpTexture.scaleX,
      );
      controls.warpTexture.scaleX = next.value;
      expressions.warpTexture.scaleX = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.warpTextureScaleY)) {
      const next = updateScalarControl(
        controls.warpTexture.scaleY,
        expressions.warpTexture.scaleY,
      );
      controls.warpTexture.scaleY = next.value;
      expressions.warpTexture.scaleY = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.warpTextureOffsetX)) {
      const next = updateScalarControl(
        controls.warpTexture.offsetX,
        expressions.warpTexture.offsetX,
      );
      controls.warpTexture.offsetX = next.value;
      expressions.warpTexture.offsetX = next.expression;
      return true;
    }
    if (matchesAlias(scalarAliases.warpTextureOffsetY)) {
      const next = updateScalarControl(
        controls.warpTexture.offsetY,
        expressions.warpTexture.offsetY,
      );
      controls.warpTexture.offsetY = next.value;
      expressions.warpTexture.offsetY = next.expression;
      return true;
    }
  }

  const evaluatedValue = evaluateMilkdropShaderExpression(
    resolvedExpression,
    shaderValueEnv,
    shaderEnv,
  );
  if (
    key === 'uv' ||
    key === 'ret' ||
    key === 'shader_body' ||
    key === 'tint' ||
    isKnownShaderScalarKey(key)
  ) {
    return false;
  }
  if (!evaluatedValue) {
    return false;
  }
  shaderValueEnv[key] = evaluatedValue;
  shaderExpressionEnv[key] = resolvedExpression;
  if (isShaderScalarValue(evaluatedValue)) {
    shaderEnv[key] = evaluatedValue.value;
  }
  return true;
}

function applyShaderProgramHeuristicLine({
  key,
  operator,
  rawValue,
  controls,
  expressions,
  shaderEnv,
}: {
  key: string;
  operator: '=' | '+=' | '-=' | '*=' | '/=';
  rawValue: string;
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
  shaderEnv: Record<string, number>;
}) {
  const normalizedValue = normalizeShaderSyntax(rawValue)
    .replace(/\s+/gu, '')
    .toLowerCase();

  if (key === 'shader_body' && isIdentityTextureSampleExpression(rawValue)) {
    return true;
  }

  const uvOffset =
    key === 'uv'
      ? operator === '+=' || operator === '-='
        ? parseShaderVec2Constructor(rawValue, shaderEnv)
        : null
      : null;
  if (key === 'uv' && uvOffset) {
    const xSign = operator === '-=' ? -1 : 1;
    const ySign = operator === '-=' ? -1 : 1;
    const nextX = applyShaderControlValue(
      '=',
      controls.offsetX,
      expressions.offsetX,
      uvOffset.value.x * xSign,
      uvOffset.expressions.x,
    );
    const nextY = applyShaderControlValue(
      '=',
      controls.offsetY,
      expressions.offsetY,
      uvOffset.value.y * ySign,
      uvOffset.expressions.y,
    );
    controls.offsetX = nextX.value;
    controls.offsetY = nextY.value;
    expressions.offsetX = nextX.expression;
    expressions.offsetY = nextY.expression;
    shaderEnv.offset_x = nextX.value;
    shaderEnv.offset_y = nextY.value;
    shaderEnv.dx = nextX.value;
    shaderEnv.dy = nextY.value;
    return true;
  }

  const offsetMatch = normalizedValue.match(/^uv([+-])vec2\((.+),(.+)\)$/u);
  if (key === 'uv' && operator === '=' && offsetMatch) {
    const xScalar = parseShaderScalar(offsetMatch[2] ?? '', shaderEnv);
    const yScalar = parseShaderScalar(offsetMatch[3] ?? '', shaderEnv);
    if (!xScalar || !yScalar) {
      return false;
    }
    const xSign = offsetMatch[1] === '-' ? -1 : 1;
    const ySign = offsetMatch[1] === '-' ? -1 : 1;
    const nextX = applyShaderControlValue(
      '=',
      controls.offsetX,
      expressions.offsetX,
      xScalar.value * xSign,
      xScalar.expression,
    );
    const nextY = applyShaderControlValue(
      '=',
      controls.offsetY,
      expressions.offsetY,
      yScalar.value * ySign,
      yScalar.expression,
    );
    controls.offsetX = nextX.value;
    controls.offsetY = nextY.value;
    expressions.offsetX = nextX.expression;
    expressions.offsetY = nextY.expression;
    shaderEnv.offset_x = nextX.value;
    shaderEnv.offset_y = nextY.value;
    shaderEnv.dx = nextX.value;
    shaderEnv.dy = nextY.value;
    return true;
  }

  const uvAffineMatch = normalizedValue.match(
    /^\(uv-0\.5\)([*/])([^+]+)\+0\.5([+-])vec2\((.+),(.+)\)$/u,
  );
  if (key === 'uv' && operator === '=' && uvAffineMatch) {
    const zoomScalar = parseShaderScalar(uvAffineMatch[2] ?? '', shaderEnv);
    const offset = parseShaderVec2List(
      `${uvAffineMatch[4]}, ${uvAffineMatch[5]}`,
      shaderEnv,
    );
    if (!zoomScalar || !offset) {
      return false;
    }
    const offsetSign = uvAffineMatch[3] === '-' ? -1 : 1;
    const zoomValue =
      uvAffineMatch[1] === '/' && zoomScalar.value !== 0
        ? 1 / zoomScalar.value
        : zoomScalar.value;
    const nextZoom = applyShaderControlValue(
      '=',
      controls.zoom,
      expressions.zoom,
      zoomValue,
      zoomScalar.expression,
    );
    const nextX = applyShaderControlValue(
      '=',
      controls.offsetX,
      expressions.offsetX,
      offset.value.x * offsetSign,
      offset.expressions.x,
    );
    const nextY = applyShaderControlValue(
      '=',
      controls.offsetY,
      expressions.offsetY,
      offset.value.y * offsetSign,
      offset.expressions.y,
    );
    controls.zoom = nextZoom.value;
    controls.offsetX = nextX.value;
    controls.offsetY = nextY.value;
    expressions.zoom = nextZoom.expression;
    expressions.offsetX = nextX.expression;
    expressions.offsetY = nextY.expression;
    shaderEnv.zoom = nextZoom.value;
    shaderEnv.scale = nextZoom.value;
    shaderEnv.offset_x = nextX.value;
    shaderEnv.offset_y = nextY.value;
    shaderEnv.dx = nextX.value;
    shaderEnv.dy = nextY.value;
    return true;
  }

  if (key !== 'ret' && key !== 'shader_body') {
    return false;
  }

  if (isIdentityTextureSampleExpression(rawValue)) {
    return true;
  }

  const scaleMatch = normalizedValue.match(
    /^tex2d\(sampler_main,uv\)\.rgb\*(.+)$/u,
  );
  if (scaleMatch) {
    const scalar = parseShaderScalar(scaleMatch[1] ?? '', shaderEnv);
    if (!scalar) {
      return false;
    }
    const channels: Array<'r' | 'g' | 'b'> = ['r', 'g', 'b'];
    channels.forEach((channel) => {
      const next = applyShaderControlValue(
        operator,
        controls.colorScale[channel],
        expressions.colorScale[channel],
        scalar.value,
        scalar.expression,
      );
      controls.colorScale[channel] = next.value;
      expressions.colorScale[channel] = next.expression;
      shaderEnv[channel] = next.value;
    });
    return true;
  }

  const powMatch = normalizedValue.match(
    /^pow\(tex2d\(sampler_main,uv\)\.rgb,vec3\((.+)\)\)$/u,
  );
  if (powMatch) {
    const scalar = parseShaderScalar(powMatch[1] ?? '', shaderEnv);
    if (!scalar || scalar.value === 0) {
      return false;
    }
    const gammaValue = 1 / scalar.value;
    shaderEnv.gammaadj = gammaValue;
    return true;
  }

  const vecScaleMatch = normalizedValue.match(
    /^tex2d\(sampler_main,uv\)\.rgb\*vec3\((.+),(.+),(.+)\)$/u,
  );
  if (vecScaleMatch) {
    const tint = parseShaderTintList(
      `${vecScaleMatch[1]}, ${vecScaleMatch[2]}, ${vecScaleMatch[3]}`,
      shaderEnv,
    );
    if (!tint) {
      return false;
    }
    const nextR = applyShaderControlValue(
      operator,
      controls.colorScale.r,
      expressions.colorScale.r,
      tint.value.r,
      tint.expressions.r,
    );
    const nextG = applyShaderControlValue(
      operator,
      controls.colorScale.g,
      expressions.colorScale.g,
      tint.value.g,
      tint.expressions.g,
    );
    const nextB = applyShaderControlValue(
      operator,
      controls.colorScale.b,
      expressions.colorScale.b,
      tint.value.b,
      tint.expressions.b,
    );
    controls.colorScale = {
      r: nextR.value,
      g: nextG.value,
      b: nextB.value,
    };
    expressions.colorScale = {
      r: nextR.expression,
      g: nextG.expression,
      b: nextB.expression,
    };
    shaderEnv.r = nextR.value;
    shaderEnv.g = nextG.value;
    shaderEnv.b = nextB.value;
    return true;
  }

  const mixPattern = parseShaderSampleMixPattern(rawValue);
  if (mixPattern) {
    const amount = parseShaderScalar(mixPattern.amount, shaderEnv);
    if (!amount) {
      return false;
    }
    const invertLeft = isIdentityTextureSampleExpression(mixPattern.left);
    const invertRight =
      mixPattern.right === '1.0-tex2d(sampler_main,uv).rgb' ||
      mixPattern.right === '1-tex2d(sampler_main,uv).rgb';
    if (invertLeft && invertRight) {
      const next = applyShaderControlValue(
        operator,
        controls.invertBoost,
        expressions.invertBoost,
        amount.value,
        amount.expression,
      );
      controls.invertBoost = next.value;
      expressions.invertBoost = next.expression;
      shaderEnv.invert = next.value;
      return true;
    }

    const solarizeRight =
      mixPattern.right === 'abs(tex2d(sampler_main,uv).rgb-0.5)*1.5' ||
      mixPattern.right === 'abs(tex2d(sampler_main,uv).rgb-vec3(0.5))*1.5';
    if (invertLeft && solarizeRight) {
      const next = applyShaderControlValue(
        operator,
        controls.solarizeBoost,
        expressions.solarizeBoost,
        amount.value,
        amount.expression,
      );
      controls.solarizeBoost = next.value;
      expressions.solarizeBoost = next.expression;
      shaderEnv.solarize = next.value;
      return true;
    }

    const tintVec = parseShaderVec3Constructor(mixPattern.right, shaderEnv);
    if (invertLeft && tintVec) {
      const nextR = applyShaderControlValue(
        operator,
        controls.tint.r,
        expressions.tint.r,
        1 + (tintVec.value.r - 1) * amount.value,
        tintVec.expressions.r,
      );
      const nextG = applyShaderControlValue(
        operator,
        controls.tint.g,
        expressions.tint.g,
        1 + (tintVec.value.g - 1) * amount.value,
        tintVec.expressions.g,
      );
      const nextB = applyShaderControlValue(
        operator,
        controls.tint.b,
        expressions.tint.b,
        1 + (tintVec.value.b - 1) * amount.value,
        tintVec.expressions.b,
      );
      controls.tint = {
        r: nextR.value,
        g: nextG.value,
        b: nextB.value,
      };
      expressions.tint = {
        r: nextR.expression,
        g: nextG.expression,
        b: nextB.expression,
      };
      shaderEnv.tint_r = nextR.value;
      shaderEnv.tint_g = nextG.value;
      shaderEnv.tint_b = nextB.value;
      return true;
    }
  }

  if (
    normalizedValue === '1.0-tex2d(sampler_main,uv).rgb' ||
    normalizedValue === '1-tex2d(sampler_main,uv).rgb'
  ) {
    const next = applyShaderControlValue(
      operator,
      controls.invertBoost,
      expressions.invertBoost,
      1,
      createLiteralExpression(1),
    );
    controls.invertBoost = next.value;
    expressions.invertBoost = next.expression;
    shaderEnv.invert = next.value;
    return true;
  }

  if (
    normalizedValue === 'abs(tex2d(sampler_main,uv).rgb-0.5)*1.5' ||
    normalizedValue === 'abs(tex2d(sampler_main,uv).rgb-vec3(0.5))*1.5'
  ) {
    const next = applyShaderControlValue(
      operator,
      controls.solarizeBoost,
      expressions.solarizeBoost,
      1,
      createLiteralExpression(1),
    );
    controls.solarizeBoost = next.value;
    expressions.solarizeBoost = next.expression;
    shaderEnv.solarize = next.value;
    return true;
  }

  return false;
}

function buildShaderProgramPayload({
  stage,
  statements,
  normalizedLines,
  requiresControlFallback,
  supportedBackends,
}: {
  stage: MilkdropShaderProgramStage;
  statements: MilkdropShaderStatement[];
  normalizedLines: string[];
  requiresControlFallback: boolean;
  supportedBackends: MilkdropRenderBackend[];
}): MilkdropShaderProgramPayload {
  return {
    stage,
    source: normalizedLines.join('; '),
    normalizedLines,
    statements,
    execution: {
      kind: 'direct-feedback-program',
      stage,
      entryTarget: stage === 'warp' ? 'uv' : 'ret',
      supportedBackends,
      requiresControlFallback,
      statementTargets: statements.map((statement) => statement.target),
    },
  };
}

function isUnsupportedParsedShaderStatement({
  statement,
  shaderEnv,
  shaderValueEnv,
  shaderExpressionEnv,
}: {
  statement: MilkdropShaderStatement;
  shaderEnv: Record<string, number>;
  shaderValueEnv: ShaderRuntimeEnv;
  shaderExpressionEnv: ShaderExpressionEnv;
}) {
  const key = statement.target.toLowerCase();
  const resolvedExpression = resolveShaderExpressionIdentifiers(
    statement.expression,
    shaderExpressionEnv,
  );

  if (key === 'texture_source' || key === 'warp_texture_source') {
    const source =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderSamplerName(resolvedExpression.name)
        : parseShaderSamplerSource(statement.rawValue);
    return !source || !isAuxShaderSamplerName(source);
  }

  if (key === 'texture_mode') {
    const mode =
      resolvedExpression.type === 'identifier'
        ? normalizeShaderTextureBlendMode(resolvedExpression.name)
        : parseShaderTextureBlendMode(statement.rawValue);
    return !mode;
  }

  if (key !== 'ret' && key !== 'shader_body') {
    return false;
  }

  const directSample = getShaderSampleInfo(resolvedExpression);
  if (
    directSample &&
    directSample.source !== 'main' &&
    directSample.source !== 'none' &&
    !isAuxShaderSamplerName(directSample.source)
  ) {
    return true;
  }

  if (
    resolvedExpression.type !== 'call' ||
    resolvedExpression.name.toLowerCase() !== 'mix' ||
    resolvedExpression.args.length < 3 ||
    !isShaderSampleRgbExpression(
      resolvedExpression.args[0] as MilkdropShaderExpressionNode,
    )
  ) {
    return false;
  }

  const baseSample = getShaderSampleInfo(
    resolvedExpression.args[0] as MilkdropShaderExpressionNode,
  );
  const amount = evaluateShaderScalarResult(
    resolvedExpression.args[2] as MilkdropShaderExpressionNode,
    shaderValueEnv,
    shaderEnv,
    shaderExpressionEnv,
  );
  if (!amount || baseSample?.source !== 'main') {
    return false;
  }

  const targetNode = resolvedExpression.args[1] as MilkdropShaderExpressionNode;
  const auxSample = getShaderSampleInfo(targetNode);
  if (
    auxSample &&
    auxSample.source !== 'main' &&
    auxSample.source !== 'none' &&
    !isAuxShaderSamplerName(auxSample.source)
  ) {
    return true;
  }

  const invertedSample = extractShaderInvertedSampleExpression(targetNode);
  return invertedSample !== null && invertedSample !== 'main';
}

function extractShaderControls(
  shaderText: string | null,
  env: Record<string, number> = DEFAULT_MILKDROP_STATE,
) {
  if (!shaderText) {
    return {
      controls: createDefaultShaderControls(),
      expressions: createDefaultShaderControlExpressions(),
      unsupportedLines: [],
      supported: false,
      statements: [],
      directProgramStatements: [],
      directProgramLines: [],
    };
  }

  const normalized = shaderText
    .split(/[\r\n;]+/u)
    .map((line) => line.replace(/\/\/.*$/u, '').trim())
    .filter(Boolean);
  const controls = createDefaultShaderControls();
  const expressions = createDefaultShaderControlExpressions();
  const shaderEnv: Record<string, number> = {
    ...env,
    ...controls.colorScale,
    tint_r: controls.tint.r,
    tint_g: controls.tint.g,
    tint_b: controls.tint.b,
  };
  const shaderValueEnv: ShaderRuntimeEnv = {
    uv: {
      kind: 'vec2',
      value: [0, 0],
    },
  };
  const shaderExpressionEnv: ShaderExpressionEnv = {};
  const unsupportedLines: string[] = [];
  const statements: MilkdropShaderStatement[] = [];
  const directProgramStatements: MilkdropShaderStatement[] = [];
  const directProgramLines: string[] = [];

  let supportedLineCount = 0;
  normalized.forEach((line) => {
    const parsedStatement = parseMilkdropShaderStatement(line);
    if (parsedStatement) {
      statements.push(parsedStatement);
      if (
        applyShaderAstStatement({
          statement: parsedStatement,
          controls,
          expressions,
          shaderEnv,
          shaderValueEnv,
          shaderExpressionEnv,
        })
      ) {
        supportedLineCount += 1;
        return;
      }
      if (
        applyShaderProgramHeuristicLine({
          key: parsedStatement.target.toLowerCase(),
          operator: parsedStatement.operator,
          rawValue: parsedStatement.rawValue,
          controls,
          expressions,
          shaderEnv,
        })
      ) {
        supportedLineCount += 1;
        return;
      }
      if (
        isUnsupportedParsedShaderStatement({
          statement: parsedStatement,
          shaderEnv,
          shaderValueEnv,
          shaderExpressionEnv,
        })
      ) {
        unsupportedLines.push(line);
        return;
      }
      supportedLineCount += 1;
      return;
    }

    const fallbackAssignment = line.match(
      /^(?:(?:const|float|vec2|vec3|float2|float3)\s+)?([a-z_][a-z0-9_]*)\s*(=|\+=|-=|\*=|\/=)\s*(.+)$/iu,
    );
    if (!fallbackAssignment) {
      unsupportedLines.push(line);
      return;
    }
    const key = fallbackAssignment[1]?.toLowerCase() ?? '';
    const operator =
      (fallbackAssignment[2] as '=' | '+=' | '-=' | '*=' | '/=') ?? '=';
    const rawValue = fallbackAssignment[3]?.trim() ?? '';

    if (
      applyShaderProgramHeuristicLine({
        key,
        operator,
        rawValue,
        controls,
        expressions,
        shaderEnv,
      })
    ) {
      supportedLineCount += 1;
      return;
    }
    const numeric = parseShaderScalar(rawValue, shaderEnv);
    if (
      !isKnownShaderScalarKey(key) &&
      !new Set([
        'tint',
        'texture_source',
        'texture_mode',
        'warp_texture_source',
      ]).has(key)
    ) {
      if (numeric !== null) {
        const currentValue = shaderEnv[key] ?? 0;
        const next = applyShaderExpressionOperator(
          operator,
          currentValue,
          null,
          numeric.value,
          numeric.expression,
        );
        shaderEnv[key] = next.value;
        supportedLineCount += 1;
        return;
      }
      if (parsedStatement) {
        directProgramStatements.push(parsedStatement);
        directProgramLines.push(line);
        return;
      }
      unsupportedLines.push(line);
      return;
    }
    switch (key) {
      case 'texture_source': {
        const source = parseShaderSamplerSource(rawValue);
        if (source && isAuxShaderSamplerName(source)) {
          controls.textureLayer.source = source;
          if (controls.textureLayer.mode === 'none') {
            controls.textureLayer.mode = 'mix';
          }
          supportedLineCount += 1;
          return;
        }
        break;
      }
      case 'texture_mode': {
        const mode = parseShaderTextureBlendMode(rawValue);
        if (mode) {
          controls.textureLayer.mode = mode;
          supportedLineCount += 1;
          return;
        }
        break;
      }
      case 'warp_texture_source': {
        const source = parseShaderSamplerSource(rawValue);
        if (source && isAuxShaderSamplerName(source)) {
          controls.warpTexture.source = source;
          supportedLineCount += 1;
          return;
        }
        break;
      }
      case 'warp':
      case 'warp_scale':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpScale,
            expressions.warpScale,
            numeric.value,
            numeric.expression,
          );
          controls.warpScale = next.value;
          expressions.warpScale = next.expression;
          shaderEnv.warp = next.value;
          shaderEnv.warp_scale = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'dx':
      case 'offset_x':
      case 'translate_x':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.offsetX,
            expressions.offsetX,
            numeric.value,
            numeric.expression,
          );
          controls.offsetX = next.value;
          expressions.offsetX = next.expression;
          shaderEnv.dx = next.value;
          shaderEnv.offset_x = next.value;
          shaderEnv.translate_x = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'dy':
      case 'offset_y':
      case 'translate_y':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.offsetY,
            expressions.offsetY,
            numeric.value,
            numeric.expression,
          );
          controls.offsetY = next.value;
          expressions.offsetY = next.expression;
          shaderEnv.dy = next.value;
          shaderEnv.offset_y = next.value;
          shaderEnv.translate_y = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'rot':
      case 'rotation':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.rotation,
            expressions.rotation,
            numeric.value,
            numeric.expression,
          );
          controls.rotation = next.value;
          expressions.rotation = next.expression;
          shaderEnv.rot = next.value;
          shaderEnv.rotation = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'zoom':
      case 'scale':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.zoom,
            expressions.zoom,
            numeric.value,
            numeric.expression,
          );
          controls.zoom = next.value;
          expressions.zoom = next.expression;
          shaderEnv.zoom = next.value;
          shaderEnv.scale = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'saturation':
      case 'sat':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.saturation,
            expressions.saturation,
            numeric.value,
            numeric.expression,
          );
          controls.saturation = next.value;
          expressions.saturation = next.expression;
          shaderEnv.saturation = next.value;
          shaderEnv.sat = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'contrast':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.contrast,
            expressions.contrast,
            numeric.value,
            numeric.expression,
          );
          controls.contrast = next.value;
          expressions.contrast = next.expression;
          shaderEnv.contrast = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'r':
      case 'red':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.colorScale.r,
            expressions.colorScale.r,
            numeric.value,
            numeric.expression,
          );
          controls.colorScale.r = next.value;
          expressions.colorScale.r = next.expression;
          shaderEnv.r = next.value;
          shaderEnv.red = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'g':
      case 'green':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.colorScale.g,
            expressions.colorScale.g,
            numeric.value,
            numeric.expression,
          );
          controls.colorScale.g = next.value;
          expressions.colorScale.g = next.expression;
          shaderEnv.g = next.value;
          shaderEnv.green = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'b':
      case 'blue':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.colorScale.b,
            expressions.colorScale.b,
            numeric.value,
            numeric.expression,
          );
          controls.colorScale.b = next.value;
          expressions.colorScale.b = next.expression;
          shaderEnv.b = next.value;
          shaderEnv.blue = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'hue':
      case 'hue_shift':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.hueShift,
            expressions.hueShift,
            numeric.value,
            numeric.expression,
          );
          controls.hueShift = next.value;
          expressions.hueShift = next.expression;
          shaderEnv.hue = next.value;
          shaderEnv.hue_shift = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'mix':
      case 'feedback':
      case 'feedback_alpha':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.mixAlpha,
            expressions.mixAlpha,
            numeric.value,
            numeric.expression,
          );
          controls.mixAlpha = next.value;
          expressions.mixAlpha = next.expression;
          shaderEnv.mix = next.value;
          shaderEnv.feedback = next.value;
          shaderEnv.feedback_alpha = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'brighten':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.brightenBoost,
            expressions.brightenBoost,
            numeric.value,
            numeric.expression,
          );
          controls.brightenBoost = next.value;
          expressions.brightenBoost = next.expression;
          shaderEnv.brighten = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'invert':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.invertBoost,
            expressions.invertBoost,
            numeric.value,
            numeric.expression,
          );
          controls.invertBoost = next.value;
          expressions.invertBoost = next.expression;
          shaderEnv.invert = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'solarize':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.solarizeBoost,
            expressions.solarizeBoost,
            numeric.value,
            numeric.expression,
          );
          controls.solarizeBoost = next.value;
          expressions.solarizeBoost = next.expression;
          shaderEnv.solarize = next.value;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'texture_amount':
      case 'texture_mix':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.textureLayer.amount,
            expressions.textureLayer.amount,
            numeric.value,
            numeric.expression,
          );
          controls.textureLayer.amount = next.value;
          expressions.textureLayer.amount = next.expression;
          if (controls.textureLayer.mode === 'none') {
            controls.textureLayer.mode = 'mix';
          }
          supportedLineCount += 1;
          return;
        }
        break;
      case 'texture_scale':
      case 'texture_scale_x':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.textureLayer.scaleX,
            expressions.textureLayer.scaleX,
            numeric.value,
            numeric.expression,
          );
          controls.textureLayer.scaleX = next.value;
          expressions.textureLayer.scaleX = next.expression;
          supportedLineCount += 1;
          if (key === 'texture_scale') {
            controls.textureLayer.scaleY = next.value;
            expressions.textureLayer.scaleY = next.expression;
          }
          return;
        }
        break;
      case 'texture_scale_y':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.textureLayer.scaleY,
            expressions.textureLayer.scaleY,
            numeric.value,
            numeric.expression,
          );
          controls.textureLayer.scaleY = next.value;
          expressions.textureLayer.scaleY = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'texture_offset_x':
      case 'texture_scroll_x':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.textureLayer.offsetX,
            expressions.textureLayer.offsetX,
            numeric.value,
            numeric.expression,
          );
          controls.textureLayer.offsetX = next.value;
          expressions.textureLayer.offsetX = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'texture_offset_y':
      case 'texture_scroll_y':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.textureLayer.offsetY,
            expressions.textureLayer.offsetY,
            numeric.value,
            numeric.expression,
          );
          controls.textureLayer.offsetY = next.value;
          expressions.textureLayer.offsetY = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'warp_texture_amount':
      case 'warp_texture_mix':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpTexture.amount,
            expressions.warpTexture.amount,
            numeric.value,
            numeric.expression,
          );
          controls.warpTexture.amount = next.value;
          expressions.warpTexture.amount = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'warp_texture_scale':
      case 'warp_texture_scale_x':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpTexture.scaleX,
            expressions.warpTexture.scaleX,
            numeric.value,
            numeric.expression,
          );
          controls.warpTexture.scaleX = next.value;
          expressions.warpTexture.scaleX = next.expression;
          supportedLineCount += 1;
          if (key === 'warp_texture_scale') {
            controls.warpTexture.scaleY = next.value;
            expressions.warpTexture.scaleY = next.expression;
          }
          return;
        }
        break;
      case 'warp_texture_scale_y':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpTexture.scaleY,
            expressions.warpTexture.scaleY,
            numeric.value,
            numeric.expression,
          );
          controls.warpTexture.scaleY = next.value;
          expressions.warpTexture.scaleY = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'warp_texture_offset_x':
      case 'warp_texture_scroll_x':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpTexture.offsetX,
            expressions.warpTexture.offsetX,
            numeric.value,
            numeric.expression,
          );
          controls.warpTexture.offsetX = next.value;
          expressions.warpTexture.offsetX = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'warp_texture_offset_y':
      case 'warp_texture_scroll_y':
        if (numeric !== null) {
          const next = applyShaderExpressionOperator(
            operator,
            controls.warpTexture.offsetY,
            expressions.warpTexture.offsetY,
            numeric.value,
            numeric.expression,
          );
          controls.warpTexture.offsetY = next.value;
          expressions.warpTexture.offsetY = next.expression;
          supportedLineCount += 1;
          return;
        }
        break;
      case 'tint': {
        const tint = parseShaderTintList(rawValue, shaderEnv);
        if (tint) {
          const nextR = applyShaderExpressionOperator(
            operator,
            controls.tint.r,
            expressions.tint.r,
            tint.value.r,
            tint.expressions.r,
          );
          const nextG = applyShaderExpressionOperator(
            operator,
            controls.tint.g,
            expressions.tint.g,
            tint.value.g,
            tint.expressions.g,
          );
          const nextB = applyShaderExpressionOperator(
            operator,
            controls.tint.b,
            expressions.tint.b,
            tint.value.b,
            tint.expressions.b,
          );
          controls.tint = {
            r: nextR.value,
            g: nextG.value,
            b: nextB.value,
          };
          expressions.tint = {
            r: nextR.expression,
            g: nextG.expression,
            b: nextB.expression,
          };
          shaderEnv.tint_r = nextR.value;
          shaderEnv.tint_g = nextG.value;
          shaderEnv.tint_b = nextB.value;
          supportedLineCount += 1;
          return;
        }
        break;
      }
    }
    if (parsedStatement) {
      directProgramStatements.push(parsedStatement);
      directProgramLines.push(line);
      return;
    }
    unsupportedLines.push(line);
  });

  return {
    controls,
    expressions,
    unsupportedLines,
    supported:
      supportedLineCount > 0 &&
      unsupportedLines.length === 0 &&
      directProgramStatements.length === 0,
    statements,
    directProgramStatements,
    directProgramLines,
  };
}

export function evaluateMilkdropShaderControlProgram({
  warp,
  comp,
  env,
}: {
  warp: string | null;
  comp: string | null;
  env: Record<string, number>;
}) {
  const warpAnalysis = extractShaderControls(warp, env);
  const compAnalysis = extractShaderControls(comp, env);
  return mergeShaderControlAnalysis(warpAnalysis, compAnalysis).controls;
}

export function evaluateMilkdropShaderControlExpressions({
  controls,
  expressions,
  env,
}: {
  controls: MilkdropShaderControls;
  expressions: MilkdropShaderControlExpressions;
  env: Record<string, number>;
}) {
  const next: MilkdropShaderControls = structuredClone(controls);
  const evaluateScalar = (
    expression: MilkdropExpressionNode | null,
    fallback: number,
  ) => {
    if (!expression) {
      return fallback;
    }
    return evaluateMilkdropExpression(expression, env);
  };

  next.warpScale = evaluateScalar(expressions.warpScale, next.warpScale);
  next.offsetX = evaluateScalar(expressions.offsetX, next.offsetX);
  next.offsetY = evaluateScalar(expressions.offsetY, next.offsetY);
  next.rotation = evaluateScalar(expressions.rotation, next.rotation);
  next.zoom = evaluateScalar(expressions.zoom, next.zoom);
  next.saturation = evaluateScalar(expressions.saturation, next.saturation);
  next.contrast = evaluateScalar(expressions.contrast, next.contrast);
  next.colorScale.r = evaluateScalar(
    expressions.colorScale.r,
    next.colorScale.r,
  );
  next.colorScale.g = evaluateScalar(
    expressions.colorScale.g,
    next.colorScale.g,
  );
  next.colorScale.b = evaluateScalar(
    expressions.colorScale.b,
    next.colorScale.b,
  );
  next.hueShift = evaluateScalar(expressions.hueShift, next.hueShift);
  next.mixAlpha = evaluateScalar(expressions.mixAlpha, next.mixAlpha);
  next.brightenBoost = evaluateScalar(
    expressions.brightenBoost,
    next.brightenBoost,
  );
  next.invertBoost = evaluateScalar(expressions.invertBoost, next.invertBoost);
  next.solarizeBoost = evaluateScalar(
    expressions.solarizeBoost,
    next.solarizeBoost,
  );
  next.tint.r = evaluateScalar(expressions.tint.r, next.tint.r);
  next.tint.g = evaluateScalar(expressions.tint.g, next.tint.g);
  next.tint.b = evaluateScalar(expressions.tint.b, next.tint.b);
  next.textureLayer.amount = evaluateScalar(
    expressions.textureLayer.amount,
    next.textureLayer.amount,
  );
  next.textureLayer.scaleX = evaluateScalar(
    expressions.textureLayer.scaleX,
    next.textureLayer.scaleX,
  );
  next.textureLayer.scaleY = evaluateScalar(
    expressions.textureLayer.scaleY,
    next.textureLayer.scaleY,
  );
  next.textureLayer.offsetX = evaluateScalar(
    expressions.textureLayer.offsetX,
    next.textureLayer.offsetX,
  );
  next.textureLayer.offsetY = evaluateScalar(
    expressions.textureLayer.offsetY,
    next.textureLayer.offsetY,
  );
  next.textureLayer.volumeSliceZ = expressions.textureLayer.volumeSliceZ
    ? evaluateMilkdropExpression(expressions.textureLayer.volumeSliceZ, env)
    : next.textureLayer.volumeSliceZ;
  next.warpTexture.amount = evaluateScalar(
    expressions.warpTexture.amount,
    next.warpTexture.amount,
  );
  next.warpTexture.scaleX = evaluateScalar(
    expressions.warpTexture.scaleX,
    next.warpTexture.scaleX,
  );
  next.warpTexture.scaleY = evaluateScalar(
    expressions.warpTexture.scaleY,
    next.warpTexture.scaleY,
  );
  next.warpTexture.offsetX = evaluateScalar(
    expressions.warpTexture.offsetX,
    next.warpTexture.offsetX,
  );
  next.warpTexture.offsetY = evaluateScalar(
    expressions.warpTexture.offsetY,
    next.warpTexture.offsetY,
  );
  next.warpTexture.volumeSliceZ = expressions.warpTexture.volumeSliceZ
    ? evaluateMilkdropExpression(expressions.warpTexture.volumeSliceZ, env)
    : next.warpTexture.volumeSliceZ;
  return next;
}

function pickShaderScalar(
  primaryValue: number,
  primaryExpression: MilkdropExpressionNode | null,
  secondaryValue: number,
  secondaryExpression: MilkdropExpressionNode | null,
  defaultValue: number,
) {
  if (primaryExpression || primaryValue !== defaultValue) {
    return { value: primaryValue, expression: primaryExpression };
  }
  return { value: secondaryValue, expression: secondaryExpression };
}

function mergeShaderControlAnalysis(
  warpAnalysis: ReturnType<typeof extractShaderControls>,
  compAnalysis: ReturnType<typeof extractShaderControls>,
) {
  const warpScale = pickShaderScalar(
    warpAnalysis.controls.warpScale,
    warpAnalysis.expressions.warpScale,
    compAnalysis.controls.warpScale,
    compAnalysis.expressions.warpScale,
    0,
  );
  const offsetX = pickShaderScalar(
    warpAnalysis.controls.offsetX,
    warpAnalysis.expressions.offsetX,
    compAnalysis.controls.offsetX,
    compAnalysis.expressions.offsetX,
    0,
  );
  const offsetY = pickShaderScalar(
    warpAnalysis.controls.offsetY,
    warpAnalysis.expressions.offsetY,
    compAnalysis.controls.offsetY,
    compAnalysis.expressions.offsetY,
    0,
  );
  const rotation = pickShaderScalar(
    warpAnalysis.controls.rotation,
    warpAnalysis.expressions.rotation,
    compAnalysis.controls.rotation,
    compAnalysis.expressions.rotation,
    0,
  );
  const zoom = pickShaderScalar(
    warpAnalysis.controls.zoom,
    warpAnalysis.expressions.zoom,
    compAnalysis.controls.zoom,
    compAnalysis.expressions.zoom,
    1,
  );
  const saturation = pickShaderScalar(
    compAnalysis.controls.saturation,
    compAnalysis.expressions.saturation,
    warpAnalysis.controls.saturation,
    warpAnalysis.expressions.saturation,
    1,
  );
  const contrast = pickShaderScalar(
    compAnalysis.controls.contrast,
    compAnalysis.expressions.contrast,
    warpAnalysis.controls.contrast,
    warpAnalysis.expressions.contrast,
    1,
  );
  const hueShift = pickShaderScalar(
    compAnalysis.controls.hueShift,
    compAnalysis.expressions.hueShift,
    warpAnalysis.controls.hueShift,
    warpAnalysis.expressions.hueShift,
    0,
  );
  const mixAlpha = pickShaderScalar(
    compAnalysis.controls.mixAlpha,
    compAnalysis.expressions.mixAlpha,
    warpAnalysis.controls.mixAlpha,
    warpAnalysis.expressions.mixAlpha,
    0,
  );
  const brightenBoost = pickShaderScalar(
    compAnalysis.controls.brightenBoost,
    compAnalysis.expressions.brightenBoost,
    warpAnalysis.controls.brightenBoost,
    warpAnalysis.expressions.brightenBoost,
    0,
  );
  const invertBoost = pickShaderScalar(
    compAnalysis.controls.invertBoost,
    compAnalysis.expressions.invertBoost,
    warpAnalysis.controls.invertBoost,
    warpAnalysis.expressions.invertBoost,
    0,
  );
  const solarizeBoost = pickShaderScalar(
    compAnalysis.controls.solarizeBoost,
    compAnalysis.expressions.solarizeBoost,
    warpAnalysis.controls.solarizeBoost,
    warpAnalysis.expressions.solarizeBoost,
    0,
  );
  const colorScale = {
    r: pickShaderScalar(
      compAnalysis.controls.colorScale.r,
      compAnalysis.expressions.colorScale.r,
      warpAnalysis.controls.colorScale.r,
      warpAnalysis.expressions.colorScale.r,
      1,
    ),
    g: pickShaderScalar(
      compAnalysis.controls.colorScale.g,
      compAnalysis.expressions.colorScale.g,
      warpAnalysis.controls.colorScale.g,
      warpAnalysis.expressions.colorScale.g,
      1,
    ),
    b: pickShaderScalar(
      compAnalysis.controls.colorScale.b,
      compAnalysis.expressions.colorScale.b,
      warpAnalysis.controls.colorScale.b,
      warpAnalysis.expressions.colorScale.b,
      1,
    ),
  };
  const tint = {
    r: pickShaderScalar(
      compAnalysis.controls.tint.r,
      compAnalysis.expressions.tint.r,
      warpAnalysis.controls.tint.r,
      warpAnalysis.expressions.tint.r,
      1,
    ),
    g: pickShaderScalar(
      compAnalysis.controls.tint.g,
      compAnalysis.expressions.tint.g,
      warpAnalysis.controls.tint.g,
      warpAnalysis.expressions.tint.g,
      1,
    ),
    b: pickShaderScalar(
      compAnalysis.controls.tint.b,
      compAnalysis.expressions.tint.b,
      warpAnalysis.controls.tint.b,
      warpAnalysis.expressions.tint.b,
      1,
    ),
  };
  const textureLayerAmount = pickShaderScalar(
    compAnalysis.controls.textureLayer.amount,
    compAnalysis.expressions.textureLayer.amount,
    warpAnalysis.controls.textureLayer.amount,
    warpAnalysis.expressions.textureLayer.amount,
    0,
  );
  const textureLayerScaleX = pickShaderScalar(
    compAnalysis.controls.textureLayer.scaleX,
    compAnalysis.expressions.textureLayer.scaleX,
    warpAnalysis.controls.textureLayer.scaleX,
    warpAnalysis.expressions.textureLayer.scaleX,
    1,
  );
  const textureLayerScaleY = pickShaderScalar(
    compAnalysis.controls.textureLayer.scaleY,
    compAnalysis.expressions.textureLayer.scaleY,
    warpAnalysis.controls.textureLayer.scaleY,
    warpAnalysis.expressions.textureLayer.scaleY,
    1,
  );
  const textureLayerOffsetX = pickShaderScalar(
    compAnalysis.controls.textureLayer.offsetX,
    compAnalysis.expressions.textureLayer.offsetX,
    warpAnalysis.controls.textureLayer.offsetX,
    warpAnalysis.expressions.textureLayer.offsetX,
    0,
  );
  const textureLayerOffsetY = pickShaderScalar(
    compAnalysis.controls.textureLayer.offsetY,
    compAnalysis.expressions.textureLayer.offsetY,
    warpAnalysis.controls.textureLayer.offsetY,
    warpAnalysis.expressions.textureLayer.offsetY,
    0,
  );
  const textureLayerSample =
    compAnalysis.controls.textureLayer.mode !== 'none'
      ? compAnalysis
      : warpAnalysis;
  const warpTextureAmount = pickShaderScalar(
    warpAnalysis.controls.warpTexture.amount,
    warpAnalysis.expressions.warpTexture.amount,
    compAnalysis.controls.warpTexture.amount,
    compAnalysis.expressions.warpTexture.amount,
    0,
  );
  const warpTextureScaleX = pickShaderScalar(
    warpAnalysis.controls.warpTexture.scaleX,
    warpAnalysis.expressions.warpTexture.scaleX,
    compAnalysis.controls.warpTexture.scaleX,
    compAnalysis.expressions.warpTexture.scaleX,
    1,
  );
  const warpTextureScaleY = pickShaderScalar(
    warpAnalysis.controls.warpTexture.scaleY,
    warpAnalysis.expressions.warpTexture.scaleY,
    compAnalysis.controls.warpTexture.scaleY,
    compAnalysis.expressions.warpTexture.scaleY,
    1,
  );
  const warpTextureOffsetX = pickShaderScalar(
    warpAnalysis.controls.warpTexture.offsetX,
    warpAnalysis.expressions.warpTexture.offsetX,
    compAnalysis.controls.warpTexture.offsetX,
    compAnalysis.expressions.warpTexture.offsetX,
    0,
  );
  const warpTextureOffsetY = pickShaderScalar(
    warpAnalysis.controls.warpTexture.offsetY,
    warpAnalysis.expressions.warpTexture.offsetY,
    compAnalysis.controls.warpTexture.offsetY,
    compAnalysis.expressions.warpTexture.offsetY,
    0,
  );
  const warpTextureSample =
    warpAnalysis.controls.warpTexture.source !== 'none'
      ? warpAnalysis
      : compAnalysis;

  return {
    controls: {
      warpScale: warpScale.value,
      offsetX: offsetX.value,
      offsetY: offsetY.value,
      rotation: rotation.value,
      zoom: zoom.value,
      saturation: saturation.value,
      contrast: contrast.value,
      colorScale: {
        r: colorScale.r.value,
        g: colorScale.g.value,
        b: colorScale.b.value,
      },
      hueShift: hueShift.value,
      mixAlpha: mixAlpha.value,
      brightenBoost: brightenBoost.value,
      invertBoost: invertBoost.value,
      solarizeBoost: solarizeBoost.value,
      tint: {
        r: tint.r.value,
        g: tint.g.value,
        b: tint.b.value,
      },
      textureLayer: {
        source:
          compAnalysis.controls.textureLayer.source !== 'none'
            ? compAnalysis.controls.textureLayer.source
            : warpAnalysis.controls.textureLayer.source,
        mode:
          compAnalysis.controls.textureLayer.mode !== 'none'
            ? compAnalysis.controls.textureLayer.mode
            : warpAnalysis.controls.textureLayer.mode,
        sampleDimension:
          textureLayerSample.controls.textureLayer.sampleDimension,
        amount: textureLayerAmount.value,
        scaleX: textureLayerScaleX.value,
        scaleY: textureLayerScaleY.value,
        offsetX: textureLayerOffsetX.value,
        offsetY: textureLayerOffsetY.value,
        volumeSliceZ: textureLayerSample.controls.textureLayer.volumeSliceZ,
      },
      warpTexture: {
        source:
          warpAnalysis.controls.warpTexture.source !== 'none'
            ? warpAnalysis.controls.warpTexture.source
            : compAnalysis.controls.warpTexture.source,
        sampleDimension: warpTextureSample.controls.warpTexture.sampleDimension,
        amount: warpTextureAmount.value,
        scaleX: warpTextureScaleX.value,
        scaleY: warpTextureScaleY.value,
        offsetX: warpTextureOffsetX.value,
        offsetY: warpTextureOffsetY.value,
        volumeSliceZ: warpTextureSample.controls.warpTexture.volumeSliceZ,
      },
    },
    expressions: {
      warpScale: warpScale.expression,
      offsetX: offsetX.expression,
      offsetY: offsetY.expression,
      rotation: rotation.expression,
      zoom: zoom.expression,
      saturation: saturation.expression,
      contrast: contrast.expression,
      colorScale: {
        r: colorScale.r.expression,
        g: colorScale.g.expression,
        b: colorScale.b.expression,
      },
      hueShift: hueShift.expression,
      mixAlpha: mixAlpha.expression,
      brightenBoost: brightenBoost.expression,
      invertBoost: invertBoost.expression,
      solarizeBoost: solarizeBoost.expression,
      tint: {
        r: tint.r.expression,
        g: tint.g.expression,
        b: tint.b.expression,
      },
      textureLayer: {
        sampleDimension:
          textureLayerSample.expressions.textureLayer.sampleDimension,
        amount: textureLayerAmount.expression,
        scaleX: textureLayerScaleX.expression,
        scaleY: textureLayerScaleY.expression,
        offsetX: textureLayerOffsetX.expression,
        offsetY: textureLayerOffsetY.expression,
        volumeSliceZ: textureLayerSample.expressions.textureLayer.volumeSliceZ,
      },
      warpTexture: {
        sampleDimension:
          warpTextureSample.expressions.warpTexture.sampleDimension,
        amount: warpTextureAmount.expression,
        scaleX: warpTextureScaleX.expression,
        scaleY: warpTextureScaleY.expression,
        offsetX: warpTextureOffsetX.expression,
        offsetY: warpTextureOffsetY.expression,
        volumeSliceZ: warpTextureSample.expressions.warpTexture.volumeSliceZ,
      },
    },
  };
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

function buildFeatureAnalysis({
  programs,
  customWaves,
  customShapes,
  numericFields,
  unsupportedShaderText,
  supportedShaderText,
  shaderTextExecution,
}: {
  programs: MilkdropPresetIR['programs'];
  customWaves: MilkdropWaveDefinition[];
  customShapes: MilkdropShapeDefinition[];
  numericFields: Record<string, number>;
  unsupportedShaderText: boolean;
  supportedShaderText: boolean;
  shaderTextExecution: MilkdropFeatureAnalysis['shaderTextExecution'];
}): MilkdropFeatureAnalysis {
  const features = new Set<MilkdropFeatureKey>(['base-globals']);
  const registerUsage = { q: 0, t: 0 };

  analyzeProgramRegisters(programs.init, registerUsage);
  analyzeProgramRegisters(programs.perFrame, registerUsage);
  analyzeProgramRegisters(programs.perPixel, registerUsage);

  if (hasProgramStatements(programs.perFrame)) {
    features.add('per-frame-equations');
  }
  if (hasProgramStatements(programs.perPixel)) {
    features.add('per-pixel-equations');
  }

  const customWaveFeatureUsed = customWaves.some((wave) => {
    analyzeProgramRegisters(wave.programs.init, registerUsage);
    analyzeProgramRegisters(wave.programs.perFrame, registerUsage);
    analyzeProgramRegisters(wave.programs.perPoint, registerUsage);
    return (
      Object.keys(wave.fields).length > 0 ||
      hasProgramStatements(wave.programs.init) ||
      hasProgramStatements(wave.programs.perFrame) ||
      hasProgramStatements(wave.programs.perPoint)
    );
  });
  if (customWaveFeatureUsed) {
    features.add('custom-waves');
  }

  const customShapeFeatureUsed = customShapes.some((shape) => {
    analyzeProgramRegisters(shape.programs.init, registerUsage);
    analyzeProgramRegisters(shape.programs.perFrame, registerUsage);
    return (
      Object.keys(shape.fields).length > 0 ||
      hasProgramStatements(shape.programs.init) ||
      hasProgramStatements(shape.programs.perFrame)
    );
  });
  if (customShapeFeatureUsed) {
    features.add('custom-shapes');
  }

  if ((numericFields.ob_size ?? 0) > 0 || (numericFields.ib_size ?? 0) > 0) {
    features.add('borders');
  }

  if (
    (numericFields.motion_vectors ?? 0) > 0.5 ||
    hasLegacyMotionVectorControls(numericFields, {
      init: programs.init,
      perFrame: programs.perFrame,
    })
  ) {
    features.add('motion-vectors');
  }

  if ((numericFields.video_echo_enabled ?? 0) > 0.5) {
    features.add('video-echo');
  }

  if (
    (numericFields.brighten ?? 0) > 0.5 ||
    (numericFields.darken ?? 0) > 0.5 ||
    (numericFields.solarize ?? 0) > 0.5 ||
    (numericFields.invert ?? 0) > 0.5 ||
    Math.abs((numericFields.gammaadj ?? 1) - 1) > 0.001
  ) {
    features.add('post-effects');
  }

  if (unsupportedShaderText) {
    features.add('unsupported-shader-text');
  }

  return {
    featuresUsed: FEATURE_ORDER.filter((feature) => features.has(feature)),
    unsupportedShaderText,
    supportedShaderText,
    shaderTextExecution,
    registerUsage,
  };
}

function buildBackendSupport({
  backend,
  featureAnalysis,
  sharedWarnings,
  softUnknownKeys,
  hardUnsupportedFields,
  unsupportedVolumeSamplerWarnings,
}: {
  backend: MilkdropRenderBackend;
  featureAnalysis: MilkdropFeatureAnalysis;
  sharedWarnings: string[];
  softUnknownKeys: string[];
  hardUnsupportedFields: HardUnsupportedFieldSpec[];
  unsupportedVolumeSamplerWarnings: string[];
}): MilkdropBackendSupport {
  const requiredFeatures = featureAnalysis.featuresUsed.filter(
    (feature) => feature !== 'unsupported-shader-text',
  );
  const evidence: MilkdropBackendSupportEvidence[] = [];
  const unsupportedFeatures: MilkdropCompatibilityFeatureKey[] = [];

  hardUnsupportedFields.forEach(({ key, feature, message }) => {
    evidence.push(
      createBackendEvidence({
        backend,
        scope: 'shared',
        status: 'unsupported',
        code: 'unsupported-hard-feature',
        message: `Unsupported feature "${feature}" from preset field "${key}": ${message}`,
        feature,
      }),
    );
    unsupportedFeatures.push(feature);
  });

  softUnknownKeys.forEach((key) => {
    evidence.push(
      createBackendEvidence({
        backend,
        scope: 'shared',
        status: 'partial',
        code: 'unknown-field',
        message: `Unknown preset field "${key}" was ignored.`,
      }),
    );
  });

  unsupportedVolumeSamplerWarnings.forEach((message) => {
    evidence.push(
      createBackendEvidence({
        backend,
        scope: 'backend',
        status: 'partial',
        code: 'volume-sampler-gap',
        message,
      }),
    );
  });

  if (featureAnalysis.shaderTextExecution[backend] === 'translated') {
    const shaderTextMessage = BACKEND_SHADER_TEXT_GAPS[backend].supportedSubset;
    if (shaderTextMessage) {
      evidence.push(
        createBackendEvidence({
          backend,
          scope: 'backend',
          status: 'partial',
          code: 'supported-shader-text-gap',
          message: shaderTextMessage,
        }),
      );
    }
  }

  if (featureAnalysis.shaderTextExecution[backend] === 'unsupported') {
    const unsupportedMessage =
      BACKEND_SHADER_TEXT_GAPS[backend].unsupportedSubset;
    if (unsupportedMessage) {
      evidence.push(
        createBackendEvidence({
          backend,
          scope: 'backend',
          status: backend === 'webgpu' ? 'unsupported' : 'partial',
          code: 'unsupported-shader-text-gap',
          message: unsupportedMessage,
          feature: 'unsupported-shader-text',
        }),
      );
    }
    unsupportedFeatures.push('unsupported-shader-text');
  }

  Object.entries(BACKEND_PARTIAL_FEATURE_GAPS[backend]).forEach(
    ([feature, message]) => {
      if (
        !message ||
        !featureAnalysis.featuresUsed.includes(feature as MilkdropFeatureKey)
      ) {
        return;
      }
      evidence.push(
        createBackendEvidence({
          backend,
          scope: 'backend',
          status: 'partial',
          code:
            feature === 'video-echo' ? 'video-echo-gap' : 'post-effects-gap',
          message,
          feature: feature as MilkdropFeatureKey,
        }),
      );
      unsupportedFeatures.push(feature as MilkdropFeatureKey);
    },
  );

  const uniqueEvidence = evidence.filter(
    (entry, index, entries) =>
      entries.findIndex(
        (candidate) =>
          candidate.backend === entry.backend &&
          candidate.scope === entry.scope &&
          candidate.status === entry.status &&
          candidate.code === entry.code &&
          candidate.feature === entry.feature &&
          candidate.message === entry.message,
      ) === index,
  );
  const uniqueReasons = [
    ...new Set([
      ...sharedWarnings,
      ...uniqueEvidence.map((entry) => entry.message),
    ]),
  ];
  const uniqueUnsupported = [...new Set(unsupportedFeatures)];

  if (uniqueEvidence.some((entry) => entry.status === 'unsupported')) {
    return {
      status: 'unsupported',
      reasons: uniqueReasons,
      evidence: uniqueEvidence,
      requiredFeatures,
      unsupportedFeatures: uniqueUnsupported,
      recommendedFallback: backend === 'webgpu' ? 'webgl' : undefined,
    };
  }

  if (uniqueReasons.length > 0 || uniqueUnsupported.length > 0) {
    return {
      status: 'partial',
      reasons: uniqueReasons,
      evidence: uniqueEvidence,
      requiredFeatures,
      unsupportedFeatures: uniqueUnsupported,
      recommendedFallback: backend === 'webgpu' ? 'webgl' : undefined,
    };
  }

  return {
    status: 'supported',
    reasons: [],
    evidence: [],
    requiredFeatures,
    unsupportedFeatures: [],
  };
}

function createPresetSource(
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

function createIR(
  ast: MilkdropPresetAST,
  diagnostics: MilkdropDiagnostic[],
  source: Partial<MilkdropPresetSource> = {},
) {
  const numericFields = { ...DEFAULT_MILKDROP_STATE };
  const stringFields: Record<string, string> = {};
  const parsedExpressions: MilkdropExpressionNode[] = [];
  const assignedTargets = new Set<string>();
  const programs = {
    init: createProgramBlock(),
    perFrame: createProgramBlock(),
    perPixel: createProgramBlock(),
  };
  const customWaveMap = new Map<number, MilkdropWaveDefinition>();
  const customShapeMap = new Map<number, MilkdropShapeDefinition>();
  const softUnknownKeys = new Set<string>();
  const hardUnsupportedFields = new Map<string, HardUnsupportedFieldSpec>();
  const pendingHardUnsupportedFields = new Map<
    string,
    PendingHardUnsupportedField
  >();
  const pendingProgramSources = new Map<
    MilkdropProgramBlock,
    { sourceLine: string; line: number }
  >();
  let unsupportedShaderText = false;
  let supportedShaderText = false;
  let warpShaderText: string | null = null;
  let compShaderText: string | null = null;

  ast.fields.forEach((field) => {
    if (
      compileProgramsFromField(
        field,
        programs,
        customWaveMap,
        customShapeMap,
        diagnostics,
        pendingProgramSources,
      )
    ) {
      return;
    }

    const normalizedKey = normalizeFieldKey(field);
    if (normalizedKey === null) {
      return;
    }

    const hardUnsupportedField = getHardUnsupportedField(normalizedKey);

    if (metadataKeys.has(normalizedKey)) {
      stringFields[normalizedKey] = normalizeString(field.rawValue);
      return;
    }

    if (shaderFieldPattern.test(normalizedKey)) {
      const rawValue = normalizeShaderFieldChunk(field.rawValue);
      if (!rawValue) {
        return;
      }
      if (
        normalizedKey === 'warp_shader' ||
        normalizedKey === 'warp_code' ||
        normalizedKey.startsWith('warp_')
      ) {
        warpShaderText = warpShaderText
          ? `${warpShaderText}; ${rawValue}`
          : rawValue;
      } else {
        compShaderText = compShaderText
          ? `${compShaderText}; ${rawValue}`
          : rawValue;
      }
      return;
    }

    const customWaveFieldMatch = normalizedKey.match(
      /^custom_wave_(\d+)_(.+)$/u,
    );
    if (customWaveFieldMatch) {
      const index = Number.parseInt(customWaveFieldMatch[1] ?? '0', 10);
      const suffix = customWaveFieldMatch[2] ?? '';
      if (index < 1 || index > MAX_CUSTOM_WAVES) {
        softUnknownKeys.add(normalizedKey);
        return;
      }
      const compiledScalar = compileScalarField(field, diagnostics);
      if (compiledScalar.value === null) {
        addDiagnostic(
          diagnostics,
          'error',
          'preset_invalid_scalar',
          `Could not parse a numeric value for "${normalizedKey}".`,
          {
            line: field.line,
            field: normalizedKey,
          },
        );
        return;
      }
      if (compiledScalar.expression) {
        parsedExpressions.push(compiledScalar.expression);
      }
      numericFields[normalizedKey] = compiledScalar.value;
      ensureWaveDefinition(customWaveMap, index).fields[suffix] =
        compiledScalar.value;
      return;
    }

    const customShapeFieldMatch = normalizedKey.match(/^shape_(\d+)_(.+)$/u);
    if (customShapeFieldMatch) {
      const index = Number.parseInt(customShapeFieldMatch[1] ?? '0', 10);
      const suffix = customShapeFieldMatch[2] ?? '';
      if (index < 1 || index > MAX_CUSTOM_SHAPES) {
        softUnknownKeys.add(normalizedKey);
        return;
      }
      if (!(normalizedKey in DEFAULT_MILKDROP_STATE)) {
        if (hardUnsupportedField) {
          pendingHardUnsupportedFields.set(normalizedKey, {
            key: normalizedKey,
            feature: hardUnsupportedField.feature,
            message: hardUnsupportedField.message,
            line: field.line,
          });
          return;
        }
        softUnknownKeys.add(normalizedKey);
        addDiagnostic(
          diagnostics,
          'warning',
          'preset_unknown_field',
          `Unknown preset field "${normalizedKey}" was ignored.`,
          {
            line: field.line,
            field: normalizedKey,
          },
        );
        return;
      }
      const compiledScalar = compileScalarField(field, diagnostics);
      if (compiledScalar.value === null) {
        addDiagnostic(
          diagnostics,
          'error',
          'preset_invalid_scalar',
          `Could not parse a numeric value for "${normalizedKey}".`,
          {
            line: field.line,
            field: normalizedKey,
          },
        );
        return;
      }
      if (compiledScalar.expression) {
        parsedExpressions.push(compiledScalar.expression);
      }
      numericFields[normalizedKey] = compiledScalar.value;
      ensureShapeDefinition(customShapeMap, index).fields[suffix] =
        compiledScalar.value;
      return;
    }

    if (!(normalizedKey in DEFAULT_MILKDROP_STATE)) {
      if (hardUnsupportedField) {
        pendingHardUnsupportedFields.set(normalizedKey, {
          key: normalizedKey,
          feature: hardUnsupportedField.feature,
          message: hardUnsupportedField.message,
          line: field.line,
        });
        return;
      }
      softUnknownKeys.add(normalizedKey);
      addDiagnostic(
        diagnostics,
        'warning',
        'preset_unknown_field',
        `Unknown preset field "${normalizedKey}" was ignored.`,
        {
          line: field.line,
          field: normalizedKey,
        },
      );
      return;
    }

    const compiledScalar = compileScalarField(field, diagnostics);
    if (compiledScalar.value === null) {
      addDiagnostic(
        diagnostics,
        'error',
        'preset_invalid_scalar',
        `Could not parse a numeric value for "${normalizedKey}".`,
        {
          line: field.line,
          field: normalizedKey,
        },
      );
      return;
    }
    if (compiledScalar.expression) {
      parsedExpressions.push(compiledScalar.expression);
    }
    numericFields[normalizedKey] =
      normalizedKey === 'video_echo_orientation'
        ? normalizeVideoEchoOrientation(compiledScalar.value)
        : compiledScalar.value;
  });

  pendingProgramSources.forEach(({ sourceLine, line }, block) => {
    pushProgramStatement(block, sourceLine, line, diagnostics);
  });

  const runtimeGlobals = resolveRuntimeGlobals({
    numericFields,
    programs,
  });

  pendingHardUnsupportedFields.forEach((pendingField, normalizedKey) => {
    if (!isHardUnsupportedFieldBlocking(pendingField, runtimeGlobals)) {
      return;
    }
    hardUnsupportedFields.set(normalizedKey, {
      key: normalizedKey,
      feature: pendingField.feature,
      message: pendingField.message,
    });
    addDiagnostic(
      diagnostics,
      'warning',
      'preset_unsupported_field',
      `Unsupported MilkDrop feature "${pendingField.feature}" uses preset field "${normalizedKey}". ${pendingField.message}`,
      {
        line: pendingField.line,
        field: normalizedKey,
      },
    );
  });

  const customWaves = [...customWaveMap.values()].sort(
    (left, right) => left.index - right.index,
  );
  const customShapes = [...customShapeMap.values()].sort(
    (left, right) => left.index - right.index,
  );
  const shaderWarpAnalysis = extractShaderControls(warpShaderText);
  const shaderCompAnalysis = extractShaderControls(compShaderText);
  const mergedShaderControls = mergeShaderControlAnalysis(
    shaderWarpAnalysis,
    shaderCompAnalysis,
  );
  const warpShaderProgram =
    shaderWarpAnalysis.directProgramStatements.length > 0
      ? buildShaderProgramPayload({
          stage: 'warp',
          statements: shaderWarpAnalysis.directProgramStatements,
          normalizedLines: shaderWarpAnalysis.directProgramLines,
          requiresControlFallback:
            shaderWarpAnalysis.directProgramStatements.length !==
            shaderWarpAnalysis.statements.length,
          supportedBackends:
            shaderWarpAnalysis.unsupportedLines.length === 0
              ? ['webgl', 'webgpu']
              : [],
        })
      : null;
  const compShaderProgram =
    shaderCompAnalysis.directProgramStatements.length > 0
      ? buildShaderProgramPayload({
          stage: 'comp',
          statements: shaderCompAnalysis.directProgramStatements,
          normalizedLines: shaderCompAnalysis.directProgramLines,
          requiresControlFallback:
            shaderCompAnalysis.directProgramStatements.length !==
            shaderCompAnalysis.statements.length,
          supportedBackends:
            shaderCompAnalysis.unsupportedLines.length === 0
              ? ['webgl', 'webgpu']
              : [],
        })
      : null;
  const ignoredFields = [
    ...new Set([...softUnknownKeys, ...hardUnsupportedFields.keys()]),
  ].sort();
  const approximatedShaderLines = [
    ...shaderWarpAnalysis.unsupportedLines,
    ...shaderCompAnalysis.unsupportedLines,
  ].map(normalizeBlockedConstructValue);
  const blockingConstructDetails = buildBlockingConstructDetails({
    sourceId: source.id,
    ignoredFields,
    hardUnsupportedFields,
    approximatedShaderLines,
  });
  collectExpressionsFromValue(
    mergedShaderControls.expressions,
    parsedExpressions,
  );
  for (const block of [
    programs.init,
    programs.perFrame,
    programs.perPixel,
    ...customWaves.flatMap((wave) => [
      wave.programs.init,
      wave.programs.perFrame,
      wave.programs.perPoint,
    ]),
    ...customShapes.flatMap((shape) => [
      shape.programs.init,
      shape.programs.perFrame,
    ]),
  ]) {
    for (const statement of block.statements) {
      assignedTargets.add(statement.target);
      parsedExpressions.push(statement.expression);
    }
  }
  const missingAliasesOrFunctions = collectExpressionCompatibilityGaps(
    parsedExpressions,
    assignedTargets,
  );
  const hasShaderText = Boolean(warpShaderText || compShaderText);
  const hasBlockingShaderApproximation = blockingConstructDetails.some(
    (construct) => construct.kind === 'shader' && !construct.allowlisted,
  );
  supportedShaderText =
    shaderWarpAnalysis.supported ||
    shaderCompAnalysis.supported ||
    (hasShaderText && !hasBlockingShaderApproximation);
  unsupportedShaderText = hasBlockingShaderApproximation;
  if (unsupportedShaderText) {
    addDiagnostic(
      diagnostics,
      'warning',
      'preset_unsupported_shader_text',
      'Shader-text sections include lines outside the supported subset.',
    );
  }
  const shaderTextExecution: MilkdropFeatureAnalysis['shaderTextExecution'] =
    hasShaderText
      ? unsupportedShaderText
        ? { webgl: 'unsupported', webgpu: 'unsupported' }
        : {
            webgl:
              warpShaderProgram || compShaderProgram ? 'direct' : 'translated',
            webgpu:
              (warpShaderProgram === null ||
                warpShaderProgram.execution.supportedBackends.includes(
                  'webgpu',
                )) &&
              (compShaderProgram === null ||
                compShaderProgram.execution.supportedBackends.includes(
                  'webgpu',
                ))
                ? warpShaderProgram || compShaderProgram
                  ? 'direct'
                  : 'translated'
                : 'translated',
          }
      : { webgl: 'none', webgpu: 'none' };
  const featureAnalysis = buildFeatureAnalysis({
    programs,
    customWaves,
    customShapes,
    numericFields: runtimeGlobals,
    unsupportedShaderText,
    supportedShaderText,
    shaderTextExecution,
  });
  const sharedWarnings = [
    ...[...softUnknownKeys].map(
      (key) => `Unknown preset field "${key}" was ignored.`,
    ),
    ...[...hardUnsupportedFields.values()].map(
      ({ key, feature, message }) =>
        `Unsupported feature "${feature}" from preset field "${key}": ${message}`,
    ),
  ];
  const unsupportedVolumeSamplerWarnings =
    buildUnsupportedVolumeSamplerWarnings(mergedShaderControls.controls);
  unsupportedVolumeSamplerWarnings.forEach((message) => {
    addDiagnostic(
      diagnostics,
      'warning',
      'preset_shader_volume_approximation',
      message,
    );
  });
  const backends = {
    webgl: buildBackendSupport({
      backend: 'webgl',
      featureAnalysis,
      sharedWarnings,
      softUnknownKeys: [...softUnknownKeys],
      hardUnsupportedFields: [...hardUnsupportedFields.values()],
      unsupportedVolumeSamplerWarnings,
    }),
    webgpu: buildBackendSupport({
      backend: 'webgpu',
      featureAnalysis,
      sharedWarnings,
      softUnknownKeys: [...softUnknownKeys],
      hardUnsupportedFields: [...hardUnsupportedFields.values()],
      unsupportedVolumeSamplerWarnings,
    }),
  };
  const blockedConstructs = [
    ...ignoredFields.map(toBlockedFieldConstruct),
    ...approximatedShaderLines.map(toBlockedShaderConstruct),
  ];
  const finalBackends = backends;
  const backendDivergence = buildBackendDivergence(finalBackends);
  const visualFallbacks = buildVisualFallbacks({
    approximatedShaderLines,
    webgl: finalBackends.webgl,
    webgpu: finalBackends.webgpu,
  });
  const degradationReasons = buildDegradationReasons({
    blockedConstructDetails: blockingConstructDetails,
    backendDivergence,
    visualFallbacks,
    webgl: finalBackends.webgl,
    webgpu: finalBackends.webgpu,
  });
  const visualEvidenceTier =
    blockedConstructs.length > 0
      ? 'compile'
      : backendDivergence.length > 0 || visualFallbacks.length > 0
        ? 'runtime'
        : 'visual';
  const evidence = buildCompatibilityEvidence({
    diagnostics,
    visualEvidenceTier,
  });
  const fidelityClass = classifyFidelity({
    blockedConstructDetails: blockingConstructDetails,
    degradationReasons,
    webgl: finalBackends.webgl,
    webgpu: finalBackends.webgpu,
    noBlockedConstructs: blockedConstructs.length === 0,
  });

  const parity: MilkdropParityReport = {
    ignoredFields,
    approximatedShaderLines,
    missingAliasesOrFunctions,
    backendDivergence,
    visualFallbacks,
    blockedConstructs,
    blockingConstructDetails,
    degradationReasons,
    fidelityClass,
    evidence,
    visualEvidenceTier,
  };

  const title = stringFields.title || 'MilkDrop Session';
  const author = stringFields.author;
  const description = stringFields.description;

  const compatibility = {
    backends: finalBackends,
    parity,
    featureAnalysis,
    warnings: [
      ...new Set([
        ...sharedWarnings,
        ...finalBackends.webgl.reasons,
        ...finalBackends.webgpu.reasons,
      ]),
    ],
    blockingReasons: [
      ...new Set(
        [
          ...finalBackends.webgl.reasons,
          ...finalBackends.webgpu.reasons,
        ].filter(Boolean),
      ),
    ],
    supportedFeatures: featureAnalysis.featuresUsed,
    unsupportedKeys: ignoredFields,
    softUnknownKeys: [...softUnknownKeys],
    hardUnsupportedKeys: [...hardUnsupportedFields.keys()],
    webgl: finalBackends.webgl.status === 'supported',
    webgpu: finalBackends.webgpu.status === 'supported',
  };

  const globals = Object.fromEntries(
    Object.entries(numericFields).filter(([key]) => {
      return (
        !key.startsWith('wave_') &&
        !key.startsWith('shape_') &&
        !key.startsWith('custom_wave_') &&
        !key.startsWith('ob_') &&
        !key.startsWith('ib_') &&
        key !== 'brighten' &&
        key !== 'darken' &&
        key !== 'solarize' &&
        key !== 'invert' &&
        key !== 'gammaadj' &&
        key !== 'video_echo_enabled' &&
        key !== 'video_echo_alpha' &&
        key !== 'video_echo_zoom' &&
        key !== 'video_echo_orientation'
      );
    }),
  );

  const mainWave = Object.fromEntries(
    Object.entries(numericFields).filter(([key]) => key.startsWith('wave_')),
  );

  return {
    title,
    author,
    description,
    numericFields,
    stringFields,
    programs,
    globals,
    mainWave,
    customWaves,
    customShapes,
    shaderText: {
      warp: warpShaderText,
      comp: compShaderText,
      warpAst: shaderWarpAnalysis.statements,
      compAst: shaderCompAnalysis.statements,
      warpProgram: warpShaderProgram,
      compProgram: compShaderProgram,
      supported: supportedShaderText && !unsupportedShaderText,
      unsupportedLines: approximatedShaderLines,
      controls: mergedShaderControls.controls,
      controlExpressions: mergedShaderControls.expressions,
    },
    borders: {
      outer: {
        size: numericFields.ob_size,
        r: numericFields.ob_r,
        g: numericFields.ob_g,
        b: numericFields.ob_b,
        a: numericFields.ob_a,
      },
      inner: {
        size: numericFields.ib_size,
        r: numericFields.ib_r,
        g: numericFields.ib_g,
        b: numericFields.ib_b,
        a: numericFields.ib_a,
      },
    },
    post: {
      brighten: (numericFields.brighten ?? 0) > 0.5,
      darken: (numericFields.darken ?? 0) > 0.5,
      solarize: (numericFields.solarize ?? 0) > 0.5,
      invert: (numericFields.invert ?? 0) > 0.5,
      shaderEnabled: (numericFields.shader ?? 1) > 0.5,
      textureWrap: (numericFields.texture_wrap ?? 0) > 0.5,
      feedbackTexture: (numericFields.feedback_texture ?? 0) > 0.5,
      outerBorderStyle: (numericFields.ob_border ?? 0) > 0.5,
      innerBorderStyle: (numericFields.ib_border ?? 0) > 0.5,
      shaderControls: mergedShaderControls.controls,
      shaderControlExpressions: mergedShaderControls.expressions,
      shaderPrograms: {
        warp: warpShaderProgram,
        comp: compShaderProgram,
      },
      gammaAdj: numericFields.gammaadj ?? 1,
      videoEchoEnabled: (numericFields.video_echo_enabled ?? 0) > 0.5,
      videoEchoAlpha: numericFields.video_echo_alpha ?? 0,
      videoEchoZoom: numericFields.video_echo_zoom ?? 1,
      videoEchoOrientation: normalizeVideoEchoOrientation(
        numericFields.video_echo_orientation ?? 0,
      ),
    },
    compatibility,
  } satisfies MilkdropPresetIR;
}

export function compileMilkdropPresetSource(
  raw: string,
  source: Partial<MilkdropPresetSource> = {},
  _options: MilkdropCompileOptions = {},
): MilkdropCompiledPreset {
  const parsed = parseMilkdropPreset(raw);
  const diagnostics = [...parsed.diagnostics];
  const ir = createIR(parsed.ast, diagnostics, source);
  const presetSource = createPresetSource(source, raw, ir.title, ir.author);

  const compiled: MilkdropCompiledPreset = {
    source: presetSource,
    ast: parsed.ast,
    ir,
    diagnostics,
    formattedSource: '',
    title: presetSource.title,
    author: presetSource.author,
  };

  compiled.formattedSource = formatMilkdropPreset(compiled);
  return compiled;
}
