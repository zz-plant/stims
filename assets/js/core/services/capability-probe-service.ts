import {
  type DevicePerformanceProfile,
  getDevicePerformanceProfile,
} from '../device-profile.ts';
import { getRenderingSupport } from '../renderer-capabilities.ts';
import { getRendererPlan, type RendererPlan } from '../renderer-plan.ts';
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
  };
  blockingIssues: string[];
  warnings: string[];
  canProceed: boolean;
};

type CapabilityProbeInputs = {
  renderingSupport: { hasWebGL: boolean };
  rendererPlan: RendererPlan;
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

export function buildCapabilityPreflightResult({
  renderingSupport,
  rendererPlan,
  microphone,
  environment,
  performanceProfile,
}: CapabilityProbeInputs): CapabilityPreflightResult {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];

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
      recommendedMaxPixelRatio: 1.25,
      recommendedRenderScale: 0.9,
    },
    blockingIssues,
    warnings,
    canProceed: blockingIssues.length === 0,
  };
}

export async function runCapabilityProbe(): Promise<CapabilityPreflightResult> {
  const [rendererPlanResult, microphone] = await Promise.all([
    getRendererPlan().catch((error) => {
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
