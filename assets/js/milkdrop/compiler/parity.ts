import type {
  MilkdropBackendSupport,
  MilkdropBackendSupportEvidence,
  MilkdropCompatibilityFeatureKey,
  MilkdropFeatureAnalysis,
  MilkdropFeatureKey,
  MilkdropPresetIR,
  MilkdropProgramBlock,
  MilkdropRenderBackend,
  MilkdropShapeDefinition,
  MilkdropWaveDefinition,
} from '../types';

export type HardUnsupportedFieldSpec = {
  key: string;
  feature: MilkdropCompatibilityFeatureKey;
  message: string;
  aliases?: readonly string[];
};

export function buildFeatureAnalysis({
  programs,
  customWaves,
  customShapes,
  numericFields,
  unsupportedShaderText,
  supportedShaderText,
  shaderTextExecution,
  featureOrder,
  analyzeProgramRegisters,
  hasProgramStatements,
  hasLegacyMotionVectorControls,
}: {
  programs: Pick<
    MilkdropPresetIR['programs'],
    'init' | 'perFrame' | 'perPixel'
  >;
  customWaves: MilkdropWaveDefinition[];
  customShapes: MilkdropShapeDefinition[];
  numericFields: Record<string, number>;
  unsupportedShaderText: boolean;
  supportedShaderText: boolean;
  shaderTextExecution: MilkdropFeatureAnalysis['shaderTextExecution'];
  featureOrder: MilkdropFeatureKey[];
  analyzeProgramRegisters: (
    block: MilkdropProgramBlock,
    usage: { q: number; t: number },
  ) => void;
  hasProgramStatements: (block: MilkdropProgramBlock) => boolean;
  hasLegacyMotionVectorControls: (
    numericFields: Record<string, number>,
    programs: Pick<MilkdropPresetIR['programs'], 'init' | 'perFrame'>,
  ) => boolean;
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
    (numericFields.darken_center ?? 0) > 0.5 ||
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
    featuresUsed: featureOrder.filter((feature) => features.has(feature)),
    unsupportedShaderText,
    supportedShaderText,
    shaderTextExecution,
    registerUsage,
  };
}

export function buildBackendSupport({
  backend,
  featureAnalysis,
  sharedWarnings,
  softUnknownKeys,
  hardUnsupportedFields,
  unsupportedVolumeSamplerWarnings,
  createBackendEvidence,
  backendPartialFeatureGaps,
  backendShaderTextGaps,
}: {
  backend: MilkdropRenderBackend;
  featureAnalysis: MilkdropFeatureAnalysis;
  sharedWarnings: string[];
  softUnknownKeys: string[];
  hardUnsupportedFields: HardUnsupportedFieldSpec[];
  unsupportedVolumeSamplerWarnings: string[];
  createBackendEvidence: (args: {
    backend: MilkdropRenderBackend;
    scope: 'shared' | 'backend';
    status: 'supported' | 'partial' | 'unsupported';
    code: string;
    message: string;
    feature?: MilkdropCompatibilityFeatureKey;
  }) => MilkdropBackendSupportEvidence;
  backendPartialFeatureGaps: Record<
    MilkdropRenderBackend,
    Partial<Record<MilkdropFeatureKey, string>>
  >;
  backendShaderTextGaps: Record<
    MilkdropRenderBackend,
    {
      supportedSubset?: string;
      unsupportedSubset?: string;
    }
  >;
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
    const shaderTextMessage = backendShaderTextGaps[backend].supportedSubset;
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
    const unsupportedMessage = backendShaderTextGaps[backend].unsupportedSubset;
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

  Object.entries(backendPartialFeatureGaps[backend]).forEach(
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
          feature: feature as MilkdropCompatibilityFeatureKey,
        }),
      );
      unsupportedFeatures.push(feature as MilkdropCompatibilityFeatureKey);
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
