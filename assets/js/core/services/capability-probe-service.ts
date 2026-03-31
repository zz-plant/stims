import {
  type DevicePerformanceProfile,
  getDevicePerformanceProfile,
} from '../device-profile.ts';
import {
  getRenderingSupport,
  type RendererCapabilities,
} from '../renderer-capabilities.ts';
import { getRendererPlan, type RendererPlan } from '../renderer-plan.ts';
import { shouldPreferWebGLForKnownCompatibilityGaps } from '../renderer-query-override.ts';
import {
  type MicrophoneCapability,
  probeMicrophoneCapability,
} from './microphone-permission-service.ts';

export type CapabilityPreflightResult = {
  rendering: {
    hasWebGL: boolean;
    rendererBackend: 'webgl' | 'webgpu' | null;
    webgpuFallbackReason: string | null;
    shouldRetryWebGPU: boolean;
    webgpuCapabilities: RendererCapabilities['webgpu'];
  };
  microphone: MicrophoneCapability;
  environment: {
    secureContext: boolean;
    reducedMotion: boolean;
    hardwareConcurrency: number | null;
  };
  performance: {
    lowPower: boolean;
    reason: string | null;
    recommendedMaxPixelRatio: number;
    recommendedRenderScale: number;
    recommendedQualityPresetId: 'performance' | 'balanced' | 'hi-fi';
  };
  blockingIssues: string[];
  warnings: string[];
  canProceed: boolean;
};

type CapabilityProbeInputs = {
  renderingSupport: { hasWebGL: boolean };
  rendererPlan: RendererPlan;
  rendererCapabilities?: Pick<RendererCapabilities, 'webgpu'> | null;
  microphone: MicrophoneCapability;
  environment: {
    secureContext: boolean;
    hardwareConcurrency: number | null;
  };
  performanceProfile: DevicePerformanceProfile;
};

export function getPerformanceProfile(): DevicePerformanceProfile {
  return getDevicePerformanceProfile();
}

function getRecommendedQualityPresetId({
  rendererPlan,
  rendererCapabilities,
  performanceProfile,
}: Pick<
  CapabilityProbeInputs,
  'rendererPlan' | 'rendererCapabilities' | 'performanceProfile'
>): 'performance' | 'balanced' | 'hi-fi' {
  if (performanceProfile.lowPower) {
    return 'performance';
  }

  if (
    rendererPlan.backend === 'webgpu' &&
    rendererCapabilities?.webgpu?.recommendedQualityPreset === 'hi-fi'
  ) {
    return 'hi-fi';
  }

  return 'balanced';
}

function getRecommendedRenderTuning(
  recommendedQualityPresetId: 'performance' | 'balanced' | 'hi-fi',
) {
  if (recommendedQualityPresetId === 'performance') {
    return {
      recommendedMaxPixelRatio: 1.25,
      recommendedRenderScale: 0.9,
    };
  }

  if (recommendedQualityPresetId === 'hi-fi') {
    return {
      recommendedMaxPixelRatio: 2.5,
      recommendedRenderScale: 1,
    };
  }

  return {
    recommendedMaxPixelRatio: 2,
    recommendedRenderScale: 1,
  };
}

export function buildCapabilityPreflightResult({
  renderingSupport,
  rendererPlan,
  rendererCapabilities,
  microphone,
  environment,
  performanceProfile,
}: CapabilityProbeInputs): CapabilityPreflightResult {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  const recommendedQualityPresetId = getRecommendedQualityPresetId({
    rendererPlan,
    rendererCapabilities,
    performanceProfile,
  });
  const recommendedRenderTuning = getRecommendedRenderTuning(
    recommendedQualityPresetId,
  );

  if (!rendererPlan.backend) {
    blockingIssues.push('Graphics acceleration is unavailable (WebGL/WebGPU).');
  } else if (rendererPlan.backend === 'webgl' && rendererPlan.reasonMessage) {
    warnings.push(rendererPlan.reasonMessage);
  }

  if (!microphone.supported) {
    warnings.push('Microphone APIs are unavailable in this browser.');
  } else if (microphone.state === 'denied') {
    warnings.push(
      'Microphone access is blocked; visuals will fall back to demo audio.',
    );
  }

  if (performanceProfile.lowPower) {
    warnings.push(
      'Performance mode recommended for smoother visuals on this device.',
    );
  }

  return {
    rendering: {
      hasWebGL: renderingSupport.hasWebGL,
      rendererBackend: rendererPlan.backend,
      webgpuFallbackReason: rendererPlan.reasonMessage,
      shouldRetryWebGPU: rendererPlan.canRetryWebGPU,
      webgpuCapabilities: rendererCapabilities?.webgpu ?? null,
    },
    microphone,
    environment: {
      secureContext: environment.secureContext,
      reducedMotion: performanceProfile.reducedMotion,
      hardwareConcurrency: environment.hardwareConcurrency,
    },
    performance: {
      lowPower: performanceProfile.lowPower,
      reason: performanceProfile.reason,
      ...recommendedRenderTuning,
      recommendedQualityPresetId,
    },
    blockingIssues,
    warnings,
    canProceed: blockingIssues.length === 0,
  };
}

export async function runCapabilityProbe(): Promise<CapabilityPreflightResult> {
  const [rendererPlanResult, microphone] = await Promise.all([
    getRendererPlan({
      preferWebGLForKnownCompatibilityGaps:
        shouldPreferWebGLForKnownCompatibilityGaps(),
    }).catch((error) => {
      console.warn('Renderer capability probe failed', error);
      return {
        capabilities: null,
        plan: {
          backend: null,
          reasonCode: null,
          reasonMessage: 'Renderer capability probe failed.',
          canRetryWebGPU: true,
        } as RendererPlan,
      };
    }),
    probeMicrophoneCapability(),
  ]);

  return buildCapabilityPreflightResult({
    renderingSupport: getRenderingSupport(),
    rendererPlan: rendererPlanResult.plan,
    rendererCapabilities: rendererPlanResult.capabilities,
    microphone,
    environment: {
      secureContext:
        typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false,
      hardwareConcurrency:
        typeof navigator !== 'undefined'
          ? (navigator.hardwareConcurrency ?? null)
          : null,
    },
    performanceProfile: getPerformanceProfile(),
  });
}
