import type {
  MilkdropBackendSupport,
  MilkdropBackendSupportEvidence,
  MilkdropCompatibilityFeatureKey,
  MilkdropFeatureAnalysis,
  MilkdropFeedbackPostEffectDescriptorPlan,
  MilkdropGpuDescriptorUnsupportedMarker,
  MilkdropPresetIR,
  MilkdropProceduralMeshDescriptorPlan,
  MilkdropProceduralMotionVectorDescriptorPlan,
  MilkdropProceduralWaveDescriptorPlan,
  MilkdropWaveDefinition,
  MilkdropWebGpuDescriptorPlan,
} from '../types';

export function buildWebGpuDescriptorPlan({
  featureAnalysis,
  webgpu,
  programs,
  customWaves,
  post,
  lowerGpuFieldProgram,
}: {
  featureAnalysis: MilkdropFeatureAnalysis;
  webgpu: MilkdropBackendSupport;
  programs: Pick<
    MilkdropPresetIR['programs'],
    'init' | 'perFrame' | 'perPixel'
  >;
  customWaves: MilkdropWaveDefinition[];
  post: Pick<
    MilkdropPresetIR['post'],
    | 'feedbackTexture'
    | 'videoEchoEnabled'
    | 'brighten'
    | 'darken'
    | 'solarize'
    | 'invert'
    | 'shaderControls'
    | 'shaderPrograms'
  >;
  lowerGpuFieldProgram: (
    program: MilkdropPresetIR['programs']['perPixel'],
    options?: {
      additionalStateIdentifiers?: Iterable<string>;
      additionalAllowedIdentifiers?: Iterable<string>;
    },
  ) => MilkdropProceduralMeshDescriptorPlan['fieldProgram'];
}): MilkdropWebGpuDescriptorPlan {
  const unsupported = webgpu.evidence
    .filter(
      (
        entry,
      ): entry is MilkdropBackendSupportEvidence & {
        feature: MilkdropCompatibilityFeatureKey;
      } => entry.status === 'unsupported' && Boolean(entry.feature),
    )
    .map(
      (entry) =>
        ({
          kind: 'unsupported-feature',
          feature: entry.feature,
          reason: entry.message,
          recommendedFallback: 'webgl',
        }) satisfies MilkdropGpuDescriptorUnsupportedMarker,
    )
    .filter(
      (entry, index, entries) =>
        entries.findIndex(
          (candidate) =>
            candidate.feature === entry.feature &&
            candidate.reason === entry.reason,
        ) === index,
    );

  if (unsupported.length > 0) {
    return {
      routing: 'fallback-webgl',
      proceduralWaves: [],
      proceduralMesh: null,
      proceduralMotionVectors: null,
      feedback: null,
      unsupported,
    };
  }

  const proceduralWaves: MilkdropProceduralWaveDescriptorPlan[] = [
    {
      kind: 'procedural-wave',
      target: 'main-wave',
      slotIndex: null,
      sampleSource: 'waveform',
      fieldProgram: null,
    },
    {
      kind: 'procedural-wave',
      target: 'trail-waves',
      slotIndex: null,
      sampleSource: 'waveform',
      fieldProgram: null,
    },
    ...customWaves
      .map<MilkdropProceduralWaveDescriptorPlan | null>((wave) => {
        const loweredPerPointProgram =
          wave.programs.perPoint.statements.length > 0
            ? lowerGpuFieldProgram(wave.programs.perPoint, {
                additionalStateIdentifiers: [
                  'sample',
                  'value',
                  'value1',
                  'value2',
                ],
                additionalAllowedIdentifiers: [
                  'samples',
                  'spectrum',
                  'scaling',
                  'mystery',
                ],
              })
            : null;
        if (
          wave.programs.perPoint.statements.length > 0 &&
          loweredPerPointProgram === null
        ) {
          return null;
        }
        return {
          kind: 'procedural-wave',
          target: 'custom-wave',
          slotIndex: wave.index,
          sampleSource:
            (wave.fields.spectrum ?? 0) >= 0.5 ? 'spectrum' : 'waveform',
          fieldProgram: loweredPerPointProgram,
        } satisfies MilkdropProceduralWaveDescriptorPlan;
      })
      .filter((wave): wave is Exclude<typeof wave, null> => wave !== null),
  ];

  const loweredPerPixelProgram = lowerGpuFieldProgram(programs.perPixel);
  const supportsProceduralFieldEvaluation =
    programs.perPixel.statements.length === 0 ||
    loweredPerPixelProgram !== null;
  const proceduralMesh: MilkdropProceduralMeshDescriptorPlan | null =
    supportsProceduralFieldEvaluation
      ? {
          kind: 'procedural-mesh',
          requiresPerPixelProgram: programs.perPixel.statements.length > 0,
          fieldProgram: loweredPerPixelProgram,
        }
      : null;
  const proceduralMotionVectors: MilkdropProceduralMotionVectorDescriptorPlan | null =
    featureAnalysis.featuresUsed.includes('motion-vectors') &&
    supportsProceduralFieldEvaluation
      ? {
          kind: 'procedural-motion-vectors',
          requiresPerPixelProgram: programs.perPixel.statements.length > 0,
          fieldProgram: loweredPerPixelProgram,
        }
      : null;

  const feedbackUsesShaderPrograms =
    post.shaderPrograms.warp !== null || post.shaderPrograms.comp !== null;
  const feedbackUsesPostEffects =
    post.brighten || post.darken || post.solarize || post.invert;
  const feedbackUsesOverlayTexture =
    post.shaderControls.textureLayer.source !== 'none' &&
    (post.shaderControls.textureLayer.mode === 'replace' ||
      Math.abs(post.shaderControls.textureLayer.amount) > 0.0001);
  const feedbackUsesWarpTexture =
    post.shaderControls.warpTexture.source !== 'none' &&
    Math.abs(post.shaderControls.warpTexture.amount) > 0.0001;
  const feedbackUsesShaderTextures =
    feedbackUsesOverlayTexture || feedbackUsesWarpTexture;
  const shaderExecution =
    featureAnalysis.shaderTextExecution.webgpu === 'direct'
      ? 'direct'
      : featureAnalysis.shaderTextExecution.webgpu === 'none'
        ? 'none'
        : 'controls';
  const feedback: MilkdropFeedbackPostEffectDescriptorPlan | null =
    post.videoEchoEnabled ||
    post.feedbackTexture ||
    feedbackUsesShaderPrograms ||
    feedbackUsesShaderTextures ||
    feedbackUsesPostEffects
      ? {
          kind: 'feedback-post-effect',
          shaderExecution,
          usesFeedbackTexture: post.feedbackTexture,
          usesVideoEcho: post.videoEchoEnabled,
          usesPostEffects: feedbackUsesPostEffects,
          targetResolution:
            shaderExecution === 'direct' ||
            post.videoEchoEnabled ||
            post.feedbackTexture ||
            feedbackUsesShaderTextures ||
            feedbackUsesPostEffects
              ? 'scene'
              : 'adaptive',
          fallbackToLegacyFeedback: webgpu.evidence.some(
            (entry) =>
              entry.code === 'video-echo-gap' ||
              entry.code === 'post-effects-gap',
          ),
        }
      : null;

  return {
    routing:
      proceduralWaves.length > 0 ||
      proceduralMesh ||
      proceduralMotionVectors ||
      feedback
        ? 'descriptor-plan'
        : 'generic-frame-payload',
    proceduralWaves,
    proceduralMesh,
    proceduralMotionVectors,
    feedback,
    unsupported: [],
  };
}
