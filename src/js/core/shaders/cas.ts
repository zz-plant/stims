/**
 * AMD FidelityFX Contrast-Adaptive Sharpening (CAS) shader utilities.
 *
 * CAS provides single-pass edge-aware image sharpening that restores high-frequency
 * contrast and edge details on downscaled render targets without introducing ringing
 * artifacts, haloing, or amplifying flat background noise.
 */

/**
 * GLSL fragment snippet implementing Contrast-Adaptive Sharpening.
 * Expects `sampler2D tex`, `vec2 uv`, and `vec2 resolution`.
 */
export const CAS_GLSL_SNIPPET = /* glsl */ `
vec3 applyContrastAdaptiveSharpening(sampler2D tex, vec2 uv, vec2 resolution, float sharpness) {
  if (sharpness <= 0.0) {
    return texture2D(tex, uv).rgb;
  }

  vec2 step = 1.0 / max(resolution, vec2(1.0));

  // Fetch cross neighborhood (center, top, bottom, left, right)
  vec3 c = texture2D(tex, uv).rgb;
  vec3 a = texture2D(tex, uv + vec2(0.0, -step.y)).rgb;
  vec3 b = texture2D(tex, uv + vec2(-step.x, 0.0)).rgb;
  vec3 d = texture2D(tex, uv + vec2(step.x, 0.0)).rgb;
  vec3 e = texture2D(tex, uv + vec2(0.0, step.y)).rgb;

  // Compute local min and max luminance/color bounds to clamp overshoot
  vec3 minColor = min(c, min(min(a, b), min(d, e)));
  vec3 maxColor = max(c, max(max(a, b), max(d, e)));

  // Calculate local contrast ratio and adaptive weight
  // Sharpening is stronger on soft transitions and suppressed on extreme edges
  vec3 amp = clamp(min(minColor, 2.0 - maxColor) / max(maxColor, vec3(0.001)), 0.0, 1.0);
  vec3 w = -sqrt(amp) * (sharpness * 0.2);

  // Apply CAS filter kernel: (w*(a + b + d + e) + c) / (1 + 4*w)
  vec3 sharpened = (w * (a + b + d + e) + c) / (1.0 + 4.0 * w);

  // Clamp to local bounds to guarantee zero ringing
  return clamp(sharpened, minColor, maxColor);
}
`;

/**
 * WGSL compute / fragment snippet implementing Contrast-Adaptive Sharpening.
 */
export const CAS_WGSL_SNIPPET = /* wgsl */ `
fn applyContrastAdaptiveSharpening(
  tex: texture_2d<f32>,
  smp: sampler,
  uv: vec2<f32>,
  resolution: vec2<f32>,
  sharpness: f32
) -> vec3<f32> {
  if (sharpness <= 0.0) {
    return textureSample(tex, smp, uv).rgb;
  }

  let step = 1.0 / max(resolution, vec2<f32>(1.0, 1.0));

  let c = textureSample(tex, smp, uv).rgb;
  let a = textureSample(tex, smp, uv + vec2<f32>(0.0, -step.y)).rgb;
  let b = textureSample(tex, smp, uv + vec2<f32>(-step.x, 0.0)).rgb;
  let d = textureSample(tex, smp, uv + vec2<f32>(step.x, 0.0)).rgb;
  let e = textureSample(tex, smp, uv + vec2<f32>(0.0, step.y)).rgb;

  let minColor = min(c, min(min(a, b), min(d, e)));
  let maxColor = max(c, max(max(a, b), max(d, e)));

  let amp = clamp(min(minColor, vec3<f32>(2.0) - maxColor) / max(maxColor, vec3<f32>(0.001)), vec3<f32>(0.0), vec3<f32>(1.0));
  let w = -sqrt(amp) * (sharpness * 0.2);

  let sharpened = (w * (a + b + d + e) + c) / (vec3<f32>(1.0) + vec3<f32>(4.0) * w);

  return clamp(sharpened, minColor, maxColor);
}
`;

/**
 * Calculates adaptive CAS sharpness weight based on render scale.
 * When rendering at native 1.0x, sharpness is subtle (0.15); as resolution
 * drops (e.g. 0.75x), sharpness scales up (to 0.75) to restore edge contrast.
 */
export function getAdaptiveCasSharpness(renderScale: number): number {
  if (!Number.isFinite(renderScale) || renderScale >= 1.0) {
    return 0.15;
  }
  // Linear ramp between 1.0 (0.15) and 0.6 (0.85)
  const normalizedDrop = Math.max(0, Math.min(1, (1.0 - renderScale) / 0.4));
  return 0.15 + normalizedDrop * 0.7;
}
