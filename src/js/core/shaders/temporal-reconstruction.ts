/**
 * Temporal History Neighborhood Clamping & Sub-pixel Reconstruction.
 *
 * Provides shader utilities for temporal accumulation (TSR / TAAU) across consecutive
 * render frames. Uses a 3x3 color bounding box (AABB) clamping kernel to eliminate
 * ghosting and smearing on fast camera movements while reconstructing sub-pixel edge details
 * from downscaled buffers.
 */

/**
 * GLSL snippet implementing 3x3 neighborhood AABB color clamping for temporal feedback.
 * Clamps history sample `historyColor` to the min/max color envelope of the current frame's 3x3 neighborhood.
 */
export const TEMPORAL_CLAMPING_GLSL_SNIPPET = /* glsl */ `
vec3 sampleNeighborhoodMinMaxClamp(
  sampler2D currentFrameTex,
  vec2 uv,
  vec2 resolution,
  vec3 historyColor
) {
  vec2 step = 1.0 / max(resolution, vec2(1.0));

  // Sample 3x3 neighborhood around current UV
  vec3 m0 = texture2D(currentFrameTex, uv + vec2(-step.x, -step.y)).rgb;
  vec3 m1 = texture2D(currentFrameTex, uv + vec2(0.0, -step.y)).rgb;
  vec3 m2 = texture2D(currentFrameTex, uv + vec2(step.x, -step.y)).rgb;
  vec3 m3 = texture2D(currentFrameTex, uv + vec2(-step.x, 0.0)).rgb;
  vec3 m4 = texture2D(currentFrameTex, uv).rgb; // Center
  vec3 m5 = texture2D(currentFrameTex, uv + vec2(step.x, 0.0)).rgb;
  vec3 m6 = texture2D(currentFrameTex, uv + vec2(-step.x, step.y)).rgb;
  vec3 m7 = texture2D(currentFrameTex, uv + vec2(0.0, step.y)).rgb;
  vec3 m8 = texture2D(currentFrameTex, uv + vec2(step.x, step.y)).rgb;

  // Calculate local AABB (Axis-Aligned Bounding Box) min and max bounds
  vec3 minColor = min(m0, min(m1, min(m2, min(m3, min(m4, min(m5, min(m6, min(m7, m8))))))));
  vec3 maxColor = max(m0, max(m1, max(m2, max(m3, max(m4, max(m5, max(m6, max(m7, m8))))))));

  // Clamp historical color to the current frame's neighborhood bounds to prevent ghosting
  return clamp(historyColor, minColor, maxColor);
}
`;

/**
 * WGSL snippet implementing 3x3 neighborhood AABB color clamping for temporal reconstruction.
 */
export const TEMPORAL_CLAMPING_WGSL_SNIPPET = /* wgsl */ `
fn sampleNeighborhoodMinMaxClamp(
  currentTex: texture_2d<f32>,
  smp: sampler,
  uv: vec2<f32>,
  resolution: vec2<f32>,
  historyColor: vec3<f32>
) -> vec3<f32> {
  let step = 1.0 / max(resolution, vec2<f32>(1.0, 1.0));

  let m0 = textureSample(currentTex, smp, uv + vec2<f32>(-step.x, -step.y)).rgb;
  let m1 = textureSample(currentTex, smp, uv + vec2<f32>(0.0, -step.y)).rgb;
  let m2 = textureSample(currentTex, smp, uv + vec2<f32>(step.x, -step.y)).rgb;
  let m3 = textureSample(currentTex, smp, uv + vec2<f32>(-step.x, 0.0)).rgb;
  let m4 = textureSample(currentTex, smp, uv).rgb;
  let m5 = textureSample(currentTex, smp, uv + vec2<f32>(step.x, 0.0)).rgb;
  let m6 = textureSample(currentTex, smp, uv + vec2<f32>(-step.x, step.y)).rgb;
  let m7 = textureSample(currentTex, smp, uv + vec2<f32>(0.0, step.y)).rgb;
  let m8 = textureSample(currentTex, smp, uv + vec2<f32>(step.x, step.y)).rgb;

  let minColor = min(m0, min(m1, min(m2, min(m3, min(m4, min(m5, min(m6, min(m7, m8))))))));
  let maxColor = max(m0, max(m1, max(m2, max(m3, max(m4, max(m5, max(m6, max(m7, m8))))))));

  return clamp(historyColor, minColor, maxColor);
}
`;

/**
 * Calculates optimal temporal blend weight (alpha) for current vs history frames.
 * Fast motion increases weight on the current frame to prevent smearing;
 * steady scenes blend more history (e.g. 85% history / 15% current) for higher resolution.
 */
export function calculateTemporalBlendWeight(motionMagnitude: number): number {
  if (!Number.isFinite(motionMagnitude) || motionMagnitude <= 0) {
    return 0.12; // 88% history / 12% current for crisp steady accumulation
  }
  // Clamp blend weight between 0.12 (static) and 0.85 (rapid motion)
  return Math.max(0.12, Math.min(0.85, 0.12 + motionMagnitude * 1.5));
}
