const WEBGPU_COMPATIBILITY_OVERRIDE_KEY = 'stims:webgpu-compat-override';

/**
 * Minimum Chrome major version that ships a stable WebGPU implementation.
 * Chrome 113 was the first to ship WebGPU; we require 120+ to ensure
 * the most critical bugs are resolved.
 */
const MIN_CHROME_VERSION_WEBGPU = 120;

/**
 * Minimum Edge major version for WebGPU (Edge 113+ uses the same
 * Chromium WebGPU implementation as Chrome).
 */
const MIN_EDGE_VERSION_WEBGPU = 120;

function getSessionStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch (_error) {
    return null;
  }
}

function getRequestedRenderer() {
  if (typeof window === 'undefined') {
    return null;
  }

  return (
    new URLSearchParams(window.location.search)
      .get('renderer')
      ?.trim()
      .toLowerCase() ?? null
  );
}

function isCertificationSession() {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    new URLSearchParams(window.location.search)
      .get('corpus')
      ?.trim()
      .toLowerCase() === 'certification'
  );
}

function parseChromeMajorVersion(userAgent: string): number | null {
  const match = userAgent.match(/Chrome\/(\d+)\./);
  if (!match?.[1]) return null;
  const version = Number.parseInt(match[1], 10);
  return Number.isFinite(version) ? version : null;
}

function parseEdgeMajorVersion(userAgent: string): number | null {
  const match = userAgent.match(/Edg\/(\d+)\./);
  if (!match?.[1]) return null;
  const version = Number.parseInt(match[1], 10);
  return Number.isFinite(version) ? version : null;
}

function isDesktopDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator as Navigator & { userAgent?: string }).userAgent ?? '';
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  return !isMobile;
}

function isWebGPUStableInThisBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;

  const ua = (navigator as Navigator & { userAgent?: string }).userAgent ?? '';
  const lowerUA = ua.toLowerCase();

  // Firefox: WebGPU is behind a flag until at least Firefox 130+
  // Safari: WebGPU is experimental; enable only via explicit override
  if (lowerUA.includes('firefox/') || lowerUA.includes('fxios/')) {
    return false;
  }
  if (
    lowerUA.includes('safari/') &&
    !lowerUA.includes('chrome/') &&
    !lowerUA.includes('crios/')
  ) {
    return false;
  }

  // Edge (Chromium-based): check minimum version
  const edgeVersion = parseEdgeMajorVersion(ua);
  if (edgeVersion !== null) {
    return edgeVersion >= MIN_EDGE_VERSION_WEBGPU;
  }

  // Chrome: check minimum version, desktop-only for now
  const chromeVersion = parseChromeMajorVersion(ua);
  if (chromeVersion !== null) {
    return chromeVersion >= MIN_CHROME_VERSION_WEBGPU && isDesktopDevice();
  }

  // Unknown browser: conservatively disable WebGPU
  return false;
}

export function setWebGPUCompatibilityGapOverride(enabled: boolean) {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  if (enabled) {
    storage.setItem(WEBGPU_COMPATIBILITY_OVERRIDE_KEY, 'true');
    return;
  }

  storage.removeItem(WEBGPU_COMPATIBILITY_OVERRIDE_KEY);
}

export function clearWebGPUCompatibilityGapOverride() {
  setWebGPUCompatibilityGapOverride(false);
}

export function hasWebGPUCompatibilityGapOverride() {
  return (
    getSessionStorage()?.getItem(WEBGPU_COMPATIBILITY_OVERRIDE_KEY) === 'true'
  );
}

/**
 * Determine whether the renderer should prefer WebGL over WebGPU.
 *
 * Priority order:
 * 1. Explicit URL param `?renderer=webgl` or `?renderer=webgpu`
 * 2. Certification corpus runs (`?corpus=certification&renderer=webgpu`) always use WebGPU
 * 3. Session-level gap override (via `setWebGPUCompatibilityGapOverride`)
 * 4. Browser capability check: WebGPU is enabled for Chrome 120+ desktop, Edge 120+
 * 5. Default: prefer WebGL (conservative fallback)
 */
export function shouldPreferWebGLForKnownCompatibilityGaps() {
  const requestedRenderer = getRequestedRenderer();

  if (requestedRenderer === 'webgl') {
    return true;
  }

  if (requestedRenderer === 'webgpu') {
    return !isCertificationSession();
  }

  // Session-level gap override forces WebGPU
  if (hasWebGPUCompatibilityGapOverride()) {
    return false;
  }

  // Platform-based enablement
  if (isWebGPUStableInThisBrowser()) {
    return false;
  }

  // Default: prefer WebGL for compatibility
  return true;
}

// Re-export for telemetry/diagnostics
export { isDesktopDevice, isWebGPUStableInThisBrowser };
