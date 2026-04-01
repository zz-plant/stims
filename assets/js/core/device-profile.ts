import { getDeviceEnvironmentProfile } from '../utils/device-detect';

export type DevicePerformanceProfile = {
  lowPower: boolean;
  reason: string | null;
  reducedMotion: boolean;
};

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

  return {
    lowPower:
      reducedMotion ||
      limitedDeviceMemory ||
      limitedCpuCores ||
      constrainedHandheld,
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
