import {
  getDeviceEnvironmentProfile,
  isSmartTvDevice,
} from '../utils/browser/device-detect';

export type DevicePerformanceProfile = {
  lowPower: boolean;
  reason: string | null;
  reducedMotion: boolean;
};

export type DeviceTier = 'low' | 'mid' | 'high' | 'ultra';

export function getDeviceTier(): DeviceTier {
  if (isSmartTvDevice()) {
    return 'mid';
  }

  const environment = getDeviceEnvironmentProfile();
  const hardwareConcurrency =
    typeof navigator !== 'undefined'
      ? (navigator.hardwareConcurrency ?? null)
      : null;

  // Mobile stays at 12+ cores: 8-core chips like the Snapdragon 8 Gen 1 (S22)
  // look capable by core count but have a fraction of the sustained GPU
  // throughput and thermal-throttle within seconds. Desktop uses 10+ so
  // sustained-clock parts like the 10-core M1 Pro qualify.
  const isUltra =
    (hardwareConcurrency !== null &&
      (environment.isMobile
        ? hardwareConcurrency >= 12
        : hardwareConcurrency >= 10)) ||
    readVerifiedWebGpuTier() === 'high-end';

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

/**
 * The MediaQueryList is cached, but `.matches` is still read live on every
 * call, so a user toggling reduced-motion mid-session is still respected.
 * Only the construction is hoisted: `window.matchMedia(...)` forces a style
 * resolution, and getDevicePerformanceProfile runs on every animation frame
 * via buildParticleFieldVisual.
 */
let reducedMotionQuery: MediaQueryList | null = null;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  if (reducedMotionQuery === null) {
    reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  }
  return reducedMotionQuery.matches;
}

/** Test seam: drops the cached MediaQueryList when a spec swaps matchMedia. */
export function resetDeviceProfileCache(): void {
  reducedMotionQuery = null;
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
  const reducedMotion = prefersReducedMotion();

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

  const isTv = isSmartTvDevice();

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
  if (isTv) {
    reasons.push('Smart TV limited processing envelope');
  }

  const isHardwareLowPower =
    limitedDeviceMemory ||
    limitedCpuCores ||
    constrainedHandheld ||
    inferredLimitedMemory ||
    isTv;

  return {
    lowPower: isHardwareLowPower,
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
 * user can raise by hand. The `ultra` preset is auto-selected only when the
 * WebGPU probe has verified the GPU as high-end (see
 * getRecommendedQualityPresetId); core count alone never selects it, since a
 * 12-core CPU says nothing about GPU throughput.
 */
export const DEVICE_TIER_QUALITY_PRESET_IDS: Record<DeviceTier, string> = {
  low: 'performance',
  mid: 'tv',
  high: 'balanced',
  ultra: 'hi-fi',
};

/**
 * The tier the WebGPU capability probe stamped for this tab, or null when the
 * probe has not run. Reads the window global first, then the sessionStorage
 * copy — the preset WebGL-fallback flow reloads the page, which wipes the
 * global mid-session.
 */
function readVerifiedWebGpuTier(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const fromWindow = (
    window as unknown as {
      __stims_webgpu_performance_tier?: string;
    }
  ).__stims_webgpu_performance_tier;
  if (typeof fromWindow === 'string') {
    return fromWindow;
  }
  try {
    return (
      window.sessionStorage?.getItem('stims:webgpu-performance-tier') ?? null
    );
  } catch {
    return null;
  }
}

/**
 * True only when the WebGPU capability probe ran and verified a high-end GPU.
 * Distinct from the ultra device tier, which core count alone can reach.
 */
function hasVerifiedHighEndGpu(): boolean {
  return readVerifiedWebGpuTier() === 'high-end';
}

/** Used whenever tier detection is unavailable or maps to an unknown preset. */
export const FALLBACK_QUALITY_PRESET_ID = 'balanced';

/**
 * Never throws: callers run this during module init and in DOM-less test/SSR
 * environments, where `navigator`/`window`/`matchMedia` may be missing.
 */
export function getRecommendedQualityPresetId(tier?: DeviceTier): string {
  try {
    const resolvedTier = tier ?? getDeviceTier();
    if (
      resolvedTier === 'ultra' &&
      hasVerifiedHighEndGpu() &&
      !getDeviceEnvironmentProfile().isMobile &&
      !getDevicePerformanceProfile().lowPower
    ) {
      return 'ultra';
    }
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

  // Prefer an observed cadence. Inferring 120Hz from core count was actively
  // harmful: a Galaxy S22 reports 8 cores and `(update: fast)`, so it was
  // budgeted at 8.33ms while Chrome presented it at 16.7ms. Every frame then
  // read as 2x over budget, which pins the adaptive quality controller under
  // permanent degradation pressure and makes its headroom test — and so any
  // recovery to a sharper render scale — unreachable.
  const observed = getObservedRefreshRate();
  if (observed !== null) {
    return observed;
  }

  // Unmeasured: assume 60. Guessing high is the dangerous direction, since it
  // manufactures frame pressure that never clears.
  return 60;
}

let observedRefreshRate: number | null = null;
let refreshRateSamplingStarted = false;

/** Rounded to the nearest common panel rate so jitter cannot land on 73Hz. */
function quantizeRefreshRate(hz: number): number {
  const candidates = [60, 90, 120, 144, 165, 240];
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - hz) < Math.abs(best - hz) ? candidate : best,
  );
}

export function getObservedRefreshRate(): number | null {
  return observedRefreshRate;
}

/**
 * Samples presentation cadence once, early, so `getDisplayRefreshRate` has a
 * real number before the adaptive quality controller is constructed. Safe to
 * call repeatedly; only the first call samples.
 */
export function startRefreshRateSampling() {
  if (
    refreshRateSamplingStarted ||
    typeof window === 'undefined' ||
    typeof window.requestAnimationFrame !== 'function'
  ) {
    return;
  }
  refreshRateSamplingStarted = true;

  const deltas: number[] = [];
  let last = 0;

  const sample = (now: number) => {
    if (last !== 0) {
      const delta = now - last;
      // Drop compositor hiccups; they would drag the estimate down.
      if (delta > 1 && delta < 100) {
        deltas.push(delta);
      }
    }
    last = now;

    if (deltas.length < 8) {
      window.requestAnimationFrame(sample);
      return;
    }

    // Median is robust to the startup jank that surrounds first paint.
    const sorted = [...deltas].sort((a, b) => a - b);
    const medianDelta = sorted[Math.floor(sorted.length / 2)] as number;
    if (medianDelta > 0) {
      observedRefreshRate = quantizeRefreshRate(1000 / medianDelta);
    }
  };

  window.requestAnimationFrame(sample);
}
