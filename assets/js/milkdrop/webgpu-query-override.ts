/**
 * WebGPU safe-path query override module.
 *
 * Controls whether the MilkDrop WebGPU renderer should use the "safe" path
 * (reduced feature set) vs the full-capability path. The safe path is used
 * in the live visualizer by default; the full path is used during
 * certification corpus runs and can be opted into via URL parameter or
 * localStorage toggle.
 */

const STORAGE_KEY = 'stims:experiments:milkdrop-webgpu-safe-path';
const STORAGE_KEY_FORCE_MODE = 'stims:experiments:milkdrop-webgpu-force-mode';
const URL_PARAM_RENDERER = 'renderer';
const URL_PARAM_CORPUS = 'corpus';

/** Valid modes for the force-mode override. */
export type WebGpuForceMode = 'auto' | 'safe' | 'full';

/**
 * Persist a manual safe-path override to localStorage.
 * Use `null` to clear the override and return to auto-detection.
 */
export function setWebGpuSafePathOverride(value: boolean | null): void {
  if (value === null) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable
    }
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // localStorage unavailable
  }
}

/**
 * Get the current safe-path override from localStorage.
 * Returns `null` if no override is stored.
 */
export function getWebGpuSafePathOverride(): boolean | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // localStorage unavailable
  }
  return null;
}

/**
 * Persist a force-mode preference to localStorage.
 * - 'auto': use default detection logic
 * - 'safe': always use safe path
 * - 'full': always use full path
 */
export function setWebGpuForceMode(mode: WebGpuForceMode): void {
  try {
    localStorage.setItem(STORAGE_KEY_FORCE_MODE, mode);
  } catch {
    // localStorage unavailable
  }
}

/**
 * Get the current force-mode preference from localStorage.
 * Returns 'auto' if nothing is stored.
 */
export function getWebGpuForceMode(): WebGpuForceMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FORCE_MODE);
    if (raw === 'safe') return 'safe';
    if (raw === 'full') return 'full';
  } catch {
    // localStorage unavailable
  }
  return 'auto';
}

/**
 * Determine whether the safe (reduced-feature) WebGPU path should be used
 * for the MilkDrop visualizer engine.
 *
 * Priority order:
 * 1. Force-mode localStorage override ('safe' → true, 'full' → false)
 * 2. Safe-path localStorage override (boolean)
 * 3. URL query parameters:
 *    - `?renderer=webgpu&corpus=certification` → full path
 *    - `?renderer=webgpu` (without certification corpus) → safe path
 * 4. Default: safe path for the live visualizer
 */
export function shouldUseSafeMilkdropWebGpuPath(
  location: Pick<Location, 'search'> | null | undefined = globalThis.location,
): boolean {
  // 1. Force-mode localStorage override
  const forceMode = getWebGpuForceMode();
  if (forceMode === 'full') return false;
  if (forceMode === 'safe') return true;

  // 2. Safe-path localStorage override
  const storageOverride = getWebGpuSafePathOverride();
  if (storageOverride !== null) {
    return storageOverride;
  }

  // 3. URL query parameter detection
  if (location?.search) {
    const searchParams = new URLSearchParams(location.search);
    const renderer = searchParams.get(URL_PARAM_RENDERER)?.trim().toLowerCase();
    const corpus = searchParams.get(URL_PARAM_CORPUS)?.trim().toLowerCase();

    if (renderer === 'webgpu') {
      // Certification corpus runs use the full WebGPU path
      return corpus !== 'certification';
    }
  }

  // 4. Default: safe path for live visualizer
  return false;
}

/**
 * Convenience: check if the full (non-safe) WebGPU path is active.
 */
export function shouldUseFullMilkdropWebGpuPath(
  location?: Pick<Location, 'search'> | null,
): boolean {
  return !shouldUseSafeMilkdropWebGpuPath(location);
}

/**
 * Get a human-readable description of the current WebGPU path mode
 * for diagnostic/UI display.
 */
export function getWebGpuPathDescription(
  location?: Pick<Location, 'search'> | null,
): {
  mode: 'safe' | 'full';
  source: 'force-mode' | 'storage' | 'url' | 'default';
} {
  const forceMode = getWebGpuForceMode();
  if (forceMode === 'full') return { mode: 'full', source: 'force-mode' };
  if (forceMode === 'safe') return { mode: 'safe', source: 'force-mode' };

  const storageOverride = getWebGpuSafePathOverride();
  if (storageOverride !== null) {
    return {
      mode: storageOverride ? 'safe' : 'full',
      source: 'storage',
    };
  }

  if (location?.search) {
    const searchParams = new URLSearchParams(location.search);
    const renderer = searchParams.get(URL_PARAM_RENDERER)?.trim().toLowerCase();
    if (renderer === 'webgpu') {
      const corpus = searchParams.get(URL_PARAM_CORPUS)?.trim().toLowerCase();
      return {
        mode: corpus !== 'certification' ? 'safe' : 'full',
        source: 'url',
      };
    }
  }

  return { mode: 'safe', source: 'default' };
}
