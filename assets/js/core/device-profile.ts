import { isMobileDevice } from '../utils/device-detect';

export type DevicePerformanceProfile = {
  lowPower: boolean;
  reason: string | null;
  reducedMotion: boolean;
};

const isMobileUserAgent = isMobileDevice();

export function getDevicePerformanceProfile(): DevicePerformanceProfile {
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
