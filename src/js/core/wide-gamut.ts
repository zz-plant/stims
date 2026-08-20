/**
 * Display-P3 output.
 *
 * Output has always been pinned to sRGB, which clips the saturated neon that
 * most MilkDrop presets are built out of. Practically every Mac, iPhone, and
 * current monitor is Display-P3, so the wider gamut is available on hardware
 * people already own — the pixels just never asked for it.
 *
 * three r185 registers only sRGB and linear-sRGB, so P3 has to be defined
 * against ColorManagement explicitly. The matrices below are the standard
 * Display-P3 (D65) primaries; `drawingBufferColorSpace` is the hook that
 * actually widens the canvas.
 *
 * DEFAULT OFF. Turning this on changes every rendered colour, and interacts
 * with the WebGL/WebGPU brightness-parity path (which deliberately pins the
 * WebGPU present pass to linear-sRGB to match WebGL). Enabling it should be
 * checked by eye on a real P3 display and re-measured on both backends —
 * a headless capture cannot show it, because the screenshot is encoded back
 * to sRGB on the way out.
 */

import {
  ColorManagement,
  LinearSRGBColorSpace,
  LinearTransfer,
  Matrix3,
  SRGBColorSpace,
  SRGBTransfer,
} from 'three';

/** three's own id string for the space this module registers. */
export const DISPLAY_P3_COLOR_SPACE = 'display-p3';
export const LINEAR_DISPLAY_P3_COLOR_SPACE = 'display-p3-linear';

const STORAGE_KEY = 'stims:wide-gamut';

/** Display-P3 primaries and D65 white point (SMPTE EG 432-1). */
const P3_PRIMARIES: [number, number, number, number, number, number] = [
  0.68, 0.32, 0.265, 0.69, 0.15, 0.06,
];
const D65: [number, number] = [0.3127, 0.329];

// Linear-P3 <-> XYZ, and the two matrices that move colour between linear-P3
// and the linear-sRGB working space three renders in.
// three takes these as Matrix3 in row-major order, matching how it builds its
// own REC709 pair.
const LINEAR_DISPLAY_P3_TO_XYZ = /* @__PURE__ */ new Matrix3().set(
  0.4865709,
  0.2656677,
  0.1982173,
  0.2289746,
  0.6917385,
  0.0792869,
  0.0,
  0.0451134,
  1.0439444,
);
const XYZ_TO_LINEAR_DISPLAY_P3 = /* @__PURE__ */ new Matrix3().set(
  2.4934969,
  -0.9313836,
  -0.4027108,
  -0.8294889,
  1.7626641,
  0.0236247,
  0.0358458,
  -0.0761724,
  0.9568845,
);
const P3_LUMINANCE_COEFFICIENTS: [number, number, number] = [
  0.2289, 0.6917, 0.0793,
];

let registered = false;

/**
 * Registers Display-P3 with three's ColorManagement. Idempotent, and safe to
 * call even when the feature stays off — registering a space costs nothing
 * until something selects it.
 */
export function registerWideGamutColorSpaces(): void {
  if (registered) return;
  registered = true;
  ColorManagement.define({
    [LINEAR_DISPLAY_P3_COLOR_SPACE]: {
      primaries: P3_PRIMARIES,
      whitePoint: D65,
      transfer: LinearTransfer,
      toXYZ: LINEAR_DISPLAY_P3_TO_XYZ,
      fromXYZ: XYZ_TO_LINEAR_DISPLAY_P3,
      luminanceCoefficients: P3_LUMINANCE_COEFFICIENTS,
      outputColorSpaceConfig: { drawingBufferColorSpace: 'display-p3' },
    },
    [DISPLAY_P3_COLOR_SPACE]: {
      primaries: P3_PRIMARIES,
      whitePoint: D65,
      transfer: SRGBTransfer,
      toXYZ: LINEAR_DISPLAY_P3_TO_XYZ,
      fromXYZ: XYZ_TO_LINEAR_DISPLAY_P3,
      luminanceCoefficients: P3_LUMINANCE_COEFFICIENTS,
      outputColorSpaceConfig: { drawingBufferColorSpace: 'display-p3' },
    },
  });
}

/** True when the display itself can show more than sRGB. */
export function isWideGamutDisplay(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(color-gamut: p3)').matches;
  } catch {
    return false;
  }
}

/** True when the canvas can be asked for a P3 drawing buffer. */
export function isWideGamutCanvasSupported(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') as
      | (WebGL2RenderingContext & { drawingBufferColorSpace?: string })
      | null;
    return context !== null && 'drawingBufferColorSpace' in context;
  } catch {
    return false;
  }
}

export function isWideGamutAvailable(): boolean {
  return isWideGamutDisplay() && isWideGamutCanvasSupported();
}

/** User preference. Off unless explicitly enabled — see the module note. */
export function isWideGamutEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setWideGamutEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Private-mode storage failure just means the choice is session-only.
  }
}

/**
 * The output color space the renderer should use: P3 only when the user asked
 * for it AND the hardware can show it, otherwise the sRGB the app has always
 * produced.
 */
export function resolveOutputColorSpace(): string {
  if (!isWideGamutEnabled() || !isWideGamutAvailable()) {
    return SRGBColorSpace;
  }
  registerWideGamutColorSpaces();
  return DISPLAY_P3_COLOR_SPACE;
}

/** Linear counterpart, for the passes that bypass the sRGB encode. */
export function resolveLinearOutputColorSpace(): string {
  if (!isWideGamutEnabled() || !isWideGamutAvailable()) {
    return LinearSRGBColorSpace;
  }
  registerWideGamutColorSpaces();
  return LINEAR_DISPLAY_P3_COLOR_SPACE;
}
