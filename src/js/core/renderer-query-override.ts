import { getBrowserSessionStorage } from './state/browser-storage.ts';
import { presetNeedsWebgl } from './state/preset-webgl-fallback.ts';
import { getRequestedRenderer, parseURLParams } from './url-params.ts';

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

  // Chrome: check minimum version
  // Chrome for Android ships WebGPU since Chrome 121. The MIN_CHROME_VERSION_WEBGPU
  // constant is 120+, so the version check covers both desktop and mobile.
  const chromeVersion = parseChromeMajorVersion(ua);
  if (chromeVersion !== null) {
    return chromeVersion >= MIN_CHROME_VERSION_WEBGPU;
  }

  // Unknown browser: conservatively disable WebGPU
  return false;
}

export function setWebGPUCompatibilityGapOverride(enabled: boolean) {
  const storage = getBrowserSessionStorage();
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
    getBrowserSessionStorage()?.getItem(WEBGPU_COMPATIBILITY_OVERRIDE_KEY) ===
    'true'
  );
}

/**
 * Determine whether the renderer should prefer WebGL over WebGPU.
 *
 * Priority order:
 * 1. The active preset already failed WebGPU descriptor routing this
 *    session — this must win over every other signal. The fallback flow
 *    (backend-fallback.ts) marks the preset and reloads the page expecting
 *    the reload to land on WebGL; if a renderer request could still force
 *    WebGPU past this point, that reload repeats forever without ever
 *    producing a frame, since the canvas's WebGPU context blocks WebGL
 *    from ever attaching to the same element.
 * 2. Explicit URL param `?renderer=webgl` or `?renderer=webgpu`
 * 3. Session-level WebGPU override (via `setWebGPUCompatibilityGapOverride`)
 * 4. Default: prefer WebGL only when this browser is not in the stable
 *    Chromium WebGPU set
 */
export function shouldPreferWebGLForKnownCompatibilityGaps() {
  if (presetNeedsWebgl(parseURLParams().routing.presetId)) {
    return true;
  }

  const requestedRenderer = getRequestedRenderer();

  if (requestedRenderer === 'webgl') {
    return true;
  }

  if (requestedRenderer === 'webgpu') {
    return false;
  }

  // Session-level gap override forces WebGPU
  if (hasWebGPUCompatibilityGapOverride()) {
    return false;
  }

  // Default: only prefer WebGL in browsers where WebGPU isn't stable
  return !isWebGPUStableInThisBrowser();
}

// Re-export for telemetry/diagnostics
export { isDesktopDevice, isWebGPUStableInThisBrowser };
