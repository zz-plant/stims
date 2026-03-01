import { isMobileDevice } from '../../utils/device-detect';
import {
  getRendererCapabilities,
  getRenderingSupport,
  type RendererCapabilities,
} from '../renderer-capabilities.ts';
import {
  type MicrophoneCapability,
  probeMicrophoneCapability,
} from './microphone-permission-service.ts';

export type CapabilityPreflightResult = {
  rendering: {
    hasWebGL: boolean;
    rendererBackend: 'webgl' | 'webgpu' | null;
    webgpuFallbackReason: string | null;
    triedWebGPU: boolean;
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

type PerformanceProfile = {
  lowPower: boolean;
  reason: string | null;
  reducedMotion: boolean;
};

type CapabilityProbeInputs = {
  renderingSupport: { hasWebGL: boolean };
  rendererCapabilities: Pick<
    RendererCapabilities,
    'preferredBackend' | 'fallbackReason' | 'triedWebGPU' | 'shouldRetryWebGPU'
  > | null;
  microphone: MicrophoneCapability;
  environment: {
    secureContext: boolean;
    hardwareConcurrency: number | null;
  };
  performanceProfile: PerformanceProfile;
};

const isMobileUserAgent = isMobileDevice();

export function getPerformanceProfile(): PerformanceProfile {
  const deviceMemory =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ??
        null)
      : null;
  const hardwareConcurrency =
    typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency ?? null)
      : null;
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  const reasons: string[] = [];
  if (isMobileUserAgent) reasons.push('mobile device detected');
  if (reducedMotion) reasons.push('reduced motion preference');
  if (deviceMemory !== null && deviceMemory <= 4) {
    reasons.push('limited device memory');
  }
  if (hardwareConcurrency !== null && hardwareConcurrency <= 4) {
    reasons.push('limited CPU cores');
  }

  return {
    lowPower: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join(', ') : null,
    reducedMotion,
  };
}

export function buildCapabilityPreflightResult({
  renderingSupport,
  rendererCapabilities,
  microphone,
  environment,
  performanceProfile,
}: CapabilityProbeInputs): CapabilityPreflightResult {
  const renderingBackend =
    rendererCapabilities?.preferredBackend ??
    (renderingSupport.hasWebGL ? 'webgl' : null);
  const webgpuFallbackReason = rendererCapabilities?.fallbackReason ?? null;

  const blockingIssues: string[] = [];
  const warnings: string[] = [];

  if (!renderingBackend) {
    blockingIssues.push('Graphics acceleration is unavailable (WebGL/WebGPU).');
  } else if (renderingBackend === 'webgl' && webgpuFallbackReason) {
    warnings.push(webgpuFallbackReason);
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
      rendererBackend: renderingBackend,
      webgpuFallbackReason,
      triedWebGPU: rendererCapabilities?.triedWebGPU ?? false,
      shouldRetryWebGPU: rendererCapabilities?.shouldRetryWebGPU ?? false,
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
  const [rendererCapabilities, microphone] = await Promise.all([
    getRendererCapabilities().catch((error) => {
      console.warn('Renderer capability probe failed', error);
      return null;
    }),
    probeMicrophoneCapability(),
  ]);

  return buildCapabilityPreflightResult({
    renderingSupport: getRenderingSupport(),
    rendererCapabilities,
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
