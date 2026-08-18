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
import {
  PER_FRAME_FIELD_REGISTER_INPUTS,
  PER_PIXEL_VIEWPORT_BUILTIN_INPUTS,
} from './gpu-field-planner.ts';

const POST_PASS_EPSILON = 0.0001;
const DEFAULT_PROJECTM_GAMMA_ADJ = 2;

const EXCLUDED_ASSIGNMENT_TARGET_PATTERN = /^(?:[qt]\d+|megabuf|gmegabuf)$/u;

/** Lowercased names the given programs assign, control-flow bodies included.
 * q/t registers and the memory buffers are excluded — q registers are already
 * canonical inputs and the others never land in VM state. */
function collectProgramAssignmentTargets(
  blocks: ReadonlyArray<{
    statements: ReadonlyArray<{
      target: string;
      control?: { body: unknown[] } | null;
    }>;
  }>,
): string[] {
  const targets = new Set<string>();
  const visitStatements = (
    statements: ReadonlyArray<{
      target: string;
      control?: { body: unknown[] } | null;
    }>,
  ) => {
    for (const statement of statements) {
      const normalized = statement.target.toLowerCase();
      if (!EXCLUDED_ASSIGNMENT_TARGET_PATTERN.test(normalized)) {
        targets.add(normalized);
      }
      if (statement.control?.body) {
        visitStatements(
          statement.control.body as ReadonlyArray<{
            target: string;
            control?: { body: unknown[] } | null;
          }>,
        );
      }
    }
  };
  for (const block of blocks) {
    visitStatements(block.statements);
  }
  return [...targets].sort();
}

export function buildWebGpuDescriptorPlan({
  featureAnalysis,
  webgpu,
  programs,
  customWaves,
  post,
  lowerGpuFieldProgram,
  perFrameFieldRegisterInputs = PER_FRAME_FIELD_REGISTER_INPUTS,
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
    | 'darkenCenter'
    | 'solarize'
    | 'invert'
    | 'gammaAdj'
    | 'shaderControls'
    | 'shaderPrograms'
  >;
  lowerGpuFieldProgram: (
    program: MilkdropPresetIR['programs']['perPixel'],
    options?: {
      additionalStateIdentifiers?: Iterable<string>;
      additionalAllowedIdentifiers?: Iterable<string>;
      registerInputs?: Iterable<string>;
    },
  ) => MilkdropProceduralMeshDescriptorPlan['fieldProgram'];
  perFrameFieldRegisterInputs?: Iterable<string>;
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

  // Any scalar the init/per-frame programs assign is a frame constant by the
  // time the per-pixel program runs — the compiled program stores non-q/t
  // targets straight into VM state, where the frame producer already copies
  // register inputs by name. Exposing them alongside q1..q32 lets per-pixel
  // reads of per-frame user variables (mx, xpos, w, dir …) lower instead of
  // bailing (the dominant remaining blocker in the 2026-08-18 census).
  const perFrameAssignedInputs = collectProgramAssignmentTargets([
    programs.init,
    programs.perFrame,
  ]);
  const loweredPerPixelProgram = lowerGpuFieldProgram(programs.perPixel, {
    registerInputs: [...perFrameFieldRegisterInputs, ...perFrameAssignedInputs],
    additionalAllowedIdentifiers: PER_PIXEL_VIEWPORT_BUILTIN_INPUTS,
  });
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
    post.brighten ||
    post.darken ||
    post.darkenCenter ||
    post.solarize ||
    post.invert ||
    Math.abs(post.gammaAdj - DEFAULT_PROJECTM_GAMMA_ADJ) > POST_PASS_EPSILON;
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
  const feedbackNeedsCompatibilityFallback =
    post.videoEchoEnabled ||
    post.feedbackTexture ||
    feedbackUsesShaderPrograms ||
    feedbackUsesShaderTextures ||
    feedbackUsesPostEffects;
  const feedback: MilkdropFeedbackPostEffectDescriptorPlan | null =
    feedbackNeedsCompatibilityFallback
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
          fallbackToLegacyFeedback: feedbackNeedsCompatibilityFallback,
        }
      : null;

  return {
    routing: feedbackNeedsCompatibilityFallback
      ? 'fallback-webgl'
      : proceduralWaves.length > 0 ||
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
