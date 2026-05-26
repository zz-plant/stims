import { getDeviceEnvironmentProfile } from '../utils/device-detect';

export type DevicePerformanceProfile = {
  lowPower: boolean;
  reason: string | null;
  reducedMotion: boolean;
};

export type DeviceTier = 'low' | 'mid' | 'high' | 'ultra';

export function getDeviceTier(): DeviceTier {
  const environment = getDeviceEnvironmentProfile();
  const hardwareConcurrency =
    typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency ?? null)
      : null;

  const isUltra =
    !environment.isMobile &&
    ((hardwareConcurrency !== null && hardwareConcurrency >= 12) ||
      (typeof window !== 'undefined' &&
        (
          window as unknown as {
            __stims_webgpu_performance_tier?: string;
          }
        ).__stims_webgpu_performance_tier === 'high-end'));

  if (isUltra) return 'ultra';

  const profile = getDevicePerformanceProfile();
  if (!profile.lowPower) return 'high';

  const deviceMemory =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ??
        null)
      : null;

  const veryConstrained =
    (deviceMemory !== null && deviceMemory <= 2) ||
    (hardwareConcurrency !== null && hardwareConcurrency <= 2) ||
    (deviceMemory !== null &&
      deviceMemory <= 3 &&
      hardwareConcurrency !== null &&
      hardwareConcurrency <= 3);

  return veryConstrained ? 'low' : 'mid';
}

export function applyDeviceTierToDocument() {
  if (typeof document === 'undefined') return;
  const tier = getDeviceTier();
  document.documentElement.dataset.deviceTier = tier;
}

export function getDevicePerformanceProfile(): DevicePerformanceProfile {
  const environment = getDeviceEnvironmentProfile();
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
  const limitedDeviceMemory = deviceMemory !== null && deviceMemory <= 4;
  const limitedCpuCores =
    hardwareConcurrency !== null && hardwareConcurrency <= 4;
  const constrainedHandheld =
    environment.isMobile &&
    ((deviceMemory !== null && deviceMemory <= 3) ||
      (hardwareConcurrency !== null && hardwareConcurrency <= 3));

  // When deviceMemory is unavailable (Safari/Firefox), use core count as proxy
  const inferredLimitedMemory =
    deviceMemory === null &&
    environment.isMobile &&
    hardwareConcurrency !== null &&
    hardwareConcurrency <= 4;

  if (reducedMotion) {
    reasons.push('reduced motion preference');
  }
  if (limitedDeviceMemory) {
    reasons.push('limited device memory');
  }
  if (limitedCpuCores) {
    reasons.push('limited CPU cores');
  }
  if (constrainedHandheld) {
    reasons.push('handheld thermal envelope');
  }
  if (inferredLimitedMemory) {
    reasons.push('inferred memory constraint (Safari/Firefox mobile)');
  }

  return {
    lowPower:
      reducedMotion ||
      limitedDeviceMemory ||
      limitedCpuCores ||
      constrainedHandheld ||
      inferredLimitedMemory,
    reason: reasons.length > 0 ? reasons.join(', ') : null,
    reducedMotion,
  };
}

export function getAdaptiveMaxPixelRatio(maxPixelRatio: number) {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return maxPixelRatio;
  }

  const profile = getDevicePerformanceProfile();
  if (!profile.lowPower) {
    return maxPixelRatio;
  }

  return Math.min(maxPixelRatio, 1.25);
}

export function getRecommendedQualityPresetId(tier?: DeviceTier): string {
  const resolvedTier = tier ?? getDeviceTier();
  switch (resolvedTier) {
    case 'low':
      return 'performance';
    case 'mid':
      return 'balanced';
    case 'high':
      return 'hi-fi';
    case 'ultra':
      return 'ultra';
    default:
      return 'balanced';
  }
}
