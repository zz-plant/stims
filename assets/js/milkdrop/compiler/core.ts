import type {
  MilkdropBackendSupportEvidence,
  MilkdropCompatibilityFeatureKey,
  MilkdropFeatureKey,
  MilkdropPresetAST,
  MilkdropPresetSource,
  MilkdropRenderBackend,
} from '../types.ts';
import {
  buildBackendDivergence,
  buildBlockingConstructDetails,
  buildCompatibilityEvidence,
  buildDegradationReasons,
  buildVisualFallbacks,
  classifyFidelity,
} from './compatibility.ts';
import {
  DEFAULT_MILKDROP_STATE,
  MAX_CUSTOM_SHAPES,
  MAX_CUSTOM_WAVES,
} from './default-state.ts';
import { buildWebGpuDescriptorPlan } from './gpu-descriptor-plan.ts';
import { lowerGpuFieldProgram } from './gpu-field-planner.ts';
import { createMilkdropIr } from './ir.ts';
import {
  buildBackendSupport,
  buildFeatureAnalysis,
  type HardUnsupportedFieldSpec,
} from './parity.ts';
import {
  addDiagnostic,
  createProgramBlock,
  defaultSourceId,
  ensureShapeDefinition,
  ensureWaveDefinition,
  normalizeBlockedConstructValue,
  normalizeFieldKey,
  normalizeShaderFieldChunk,
  normalizeString,
  normalizeVideoEchoOrientation,
  toBlockedFieldConstruct,
  toBlockedShaderConstruct,
} from './preset-normalization.ts';
import {
  analyzeProgramRegisters,
  collectExpressionCompatibilityGaps,
  collectExpressionsFromValue,
  compileProgramsFromField,
  compileScalarField,
  hasLegacyMotionVectorControls,
  hasProgramStatements,
  pushProgramStatement,
  resolveRuntimeGlobals,
} from './program-assembly.ts';
import {
  buildShaderProgramPayload,
  buildUnsupportedVolumeSamplerWarnings,
  extractShaderControls,
  mergeShaderControlAnalysis,
} from './shader-analysis.ts';

const FEATURE_ORDER: MilkdropFeatureKey[] = [
  'base-globals',
  'per-frame-equations',
  'per-pixel-equations',
  'custom-waves',
  'custom-shapes',
  'shape-texture-controls',
  'borders',
  'motion-vectors',
  'video-echo',
  'post-effects',
  'unsupported-shader-text',
];

const metadataKeys = new Set(['title', 'author', 'description']);
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
  webgl: {
    'shape-texture-controls':
      'Custom shape texture controls (textured, tex_zoom, tex_ang) are parsed but not rendered yet.',
  },
  webgpu: {
    'shape-texture-controls':
      'Custom shape texture controls (textured, tex_zoom, tex_ang) are parsed but not rendered yet.',
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
      'WebGPU now translates the supported shader-text subset into its direct feedback execution plan while preserving control-based fallbacks for the remaining composite state.',
    unsupportedSubset:
      'WebGPU cannot safely approximate unsupported shader-text lines and must fall back to WebGL.',
  },
};

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
  diagnostics: import('../types.ts').MilkdropDiagnostic[],
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
      getHardUnsupportedField,
      normalizeString,
      normalizeShaderFieldChunk,
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
      buildShaderProgramPayload,
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
