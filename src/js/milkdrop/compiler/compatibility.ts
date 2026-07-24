import { isMilkdropParityConstructAllowlisted } from '../parity-allowlist';
import type {
  MilkdropBackendSupport,
  MilkdropBlockingConstruct,
  MilkdropCompatibilityEvidence,
  MilkdropDegradationReason,
  MilkdropDiagnostic,
  MilkdropFidelityClass,
  MilkdropParityReport,
} from '../types';
import type { HardUnsupportedFieldSpec } from './parity';

function normalizeBlockedConstructValue(value: string) {
  return value.trim().replace(/\s+/gu, ' ');
}

function toBlockedFieldConstruct(key: string) {
  return `field:${normalizeBlockedConstructValue(key)}`;
}

function toBlockedShaderConstruct(line: string) {
  return `shader:${normalizeBlockedConstructValue(line)}`;
}

export function buildBackendDivergence({
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

export function buildVisualFallbacks({
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

export function buildBlockingConstructDetails({
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

export function buildDegradationReasons({
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

export function classifyFidelity({
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

export function buildCompatibilityEvidence({
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
