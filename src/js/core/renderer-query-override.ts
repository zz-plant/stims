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

/**
 * Minimum Safari major version for WebGPU. Safari 26.0 (macOS 15.2+ / iOS 26)
 * shipped WebGPU on by default; earlier versions either lacked it or kept it
 * behind a flag.
 */
const MIN_SAFARI_VERSION_WEBGPU = 26;

/**
 * Minimum Chromium-based Opera major version for WebGPU. Opera moved to
 * Chromium's WebGPU implementation at 99.
 */
const MIN_OPERA_VERSION_WEBGPU = 99;

/**
 * Minimum Samsung Internet major version for WebGPU. Samsung Internet 24
 * switched to a Chromium version that ships WebGPU.
 */
const MIN_SAMSUNG_VERSION_WEBGPU = 24;

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

function parseSafariMajorVersion(userAgent: string): number | null {
  // Safari reports its product version as `Version/<major>.<minor>` (e.g.
  // `Version/26.0`). Chrome/Edge/Opera/Samsung UAs also carry `Safari/` but
  // never `Version/`, so a `Version/` match identifies a real WebKit build.
  const match = userAgent.match(/Version\/(\d+)\./);
  if (!match?.[1]) return null;
  const version = Number.parseInt(match[1], 10);
  return Number.isFinite(version) ? version : null;
}

function parseOperaMajorVersion(userAgent: string): number | null {
  const match = userAgent.match(/\bOPR\/(\d+)\./);
  if (!match?.[1]) return null;
  const version = Number.parseInt(match[1], 10);
  return Number.isFinite(version) ? version : null;
}

function parseSamsungMajorVersion(userAgent: string): number | null {
  const match = userAgent.match(/SamsungBrowser\/(\d+)\./);
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

  // Firefox keeps WebGPU disabled by default (no production rollout), so its
  // users stay on the WebGL path regardless of version.
  if (lowerUA.includes('firefox/') || lowerUA.includes('fxios/')) {
    return false;
  }

  // Pure WebKit Safari (excludes Chrome/Edge/Opera/Samsung, which all embed a
  // Chromium token and carry `Chrome/`). Safari 26+ ships WebGPU by default;
  // earlier versions had it experimental or absent.
  if (
    lowerUA.includes('safari/') &&
    !lowerUA.includes('chrome/') &&
    !lowerUA.includes('crios/')
  ) {
    const safariVersion = parseSafariMajorVersion(ua);
    return safariVersion !== null && safariVersion >= MIN_SAFARI_VERSION_WEBGPU;
  }

  // Edge (Chromium-based): check minimum version
  const edgeVersion = parseEdgeMajorVersion(ua);
  if (edgeVersion !== null) {
    return edgeVersion >= MIN_EDGE_VERSION_WEBGPU;
  }

  // Chromium-based Opera: check minimum version before the Chrome fallback,
  // since Opera UAs embed a Chromium `Chrome/<version>` token too.
  const operaVersion = parseOperaMajorVersion(ua);
  if (operaVersion !== null) {
    return operaVersion >= MIN_OPERA_VERSION_WEBGPU;
  }

  // Samsung Internet: same Chromium-UA situation, check before Chrome.
  const samsungVersion = parseSamsungMajorVersion(ua);
  if (samsungVersion !== null) {
    return samsungVersion >= MIN_SAMSUNG_VERSION_WEBGPU;
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

/**
 * Whether the user agent belongs to a browser family this app recognizes and
 * has made a stability decision about (Chrome, Edge, Safari, Firefox, Opera,
 * Samsung Internet, and their iOS WebKit wrappers). Unrecognized engines are
 * treated as unknown: WebGPU availability is left to feature detection rather
 * than a brand guess.
 */
export function isRecognizedWebGPUBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator as Navigator & { userAgent?: string }).userAgent ?? '';
  const lowerUA = ua.toLowerCase();
  if (
    /chrome\/|crios\/|edg\/|edgios\/|firefox\/|fxios\/|opr\/|opera\/|samsungbrowser\//.test(
      lowerUA,
    )
  ) {
    return true;
  }
  // Pure WebKit Safari (excludes Chromium engines, which embed a `Chrome/`
  // token). Matches the Safari branch of isWebGPUStableInThisBrowser.
  return (
    lowerUA.includes('safari/') &&
    !lowerUA.includes('chrome/') &&
    !lowerUA.includes('crios/')
  );
}

/** Whether the user agent is Firefox (desktop or iOS). */
export function isFirefoxUA(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator as Navigator & { userAgent?: string }).userAgent ?? '';
  const lowerUA = ua.toLowerCase();
  return lowerUA.includes('firefox/') || lowerUA.includes('fxios/');
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
