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
    (hardwareConcurrency !== null &&
      (environment.isMobile
        ? hardwareConcurrency >= 8
        : hardwareConcurrency >= 12)) ||
    (typeof window !== 'undefined' &&
      (
        window as unknown as {
          __stims_webgpu_performance_tier?: string;
        }
      ).__stims_webgpu_performance_tier === 'high-end');

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
  const limitedDeviceMemory = deviceMemory !== null && deviceMemory <= 3;
  const limitedCpuCores =
    hardwareConcurrency !== null && hardwareConcurrency <= 3;
  const constrainedHandheld =
    environment.isMobile &&
    ((deviceMemory !== null && deviceMemory <= 3) ||
      (hardwareConcurrency !== null && hardwareConcurrency <= 3));

  // When deviceMemory is unavailable (Safari/Firefox), use core count as proxy
  const inferredLimitedMemory =
    deviceMemory === null &&
    environment.isMobile &&
    hardwareConcurrency !== null &&
    hardwareConcurrency <= 3;

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

/**
 * First-run quality preset per device tier.
 *
 * Deliberately conservative: a default that melts a handheld is far worse than
 * one that is slightly too soft, and every tier here is a starting point the
 * user can raise by hand. `ultra` (2.8x pixel ratio, 1.8x particles) is never
 * auto-selected — it stays opt-in.
 */
export const DEVICE_TIER_QUALITY_PRESET_IDS: Record<DeviceTier, string> = {
  low: 'performance',
  mid: 'tv',
  high: 'balanced',
  ultra: 'hi-fi',
};

/** Used whenever tier detection is unavailable or maps to an unknown preset. */
export const FALLBACK_QUALITY_PRESET_ID = 'balanced';

/**
 * Never throws: callers run this during module init and in DOM-less test/SSR
 * environments, where `navigator`/`window`/`matchMedia` may be missing.
 */
export function getRecommendedQualityPresetId(tier?: DeviceTier): string {
  try {
    const resolvedTier = tier ?? getDeviceTier();
    return (
      DEVICE_TIER_QUALITY_PRESET_IDS[resolvedTier] ?? FALLBACK_QUALITY_PRESET_ID
    );
  } catch {
    return FALLBACK_QUALITY_PRESET_ID;
  }
}

export function getDisplayRefreshRate(): number {
  if (typeof window === 'undefined') return 60;

  const profile = getDevicePerformanceProfile();
  const environment = getDeviceEnvironmentProfile();
  if (environment.isMobile && profile.lowPower) return 60;

  if (typeof screen !== 'undefined' && 'refreshRate' in screen) {
    const rate = (screen as unknown as { refreshRate: number }).refreshRate;
    if (rate > 0) return rate;
  }

  if (!window.matchMedia('(update: fast)').matches) return 60;

  try {
    const concurrency = navigator.hardwareConcurrency ?? 4;
    if (concurrency <= 3) return 60;
  } catch {}

  return 120;
}
