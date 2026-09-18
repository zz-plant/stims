/**
 * Motion dampener — scales a frame's camera and warp transforms toward
 * identity for viewers with vestibular sensitivity, leaving audio-reactive
 * waveforms, shapes and colour untouched.
 *
 * Runs on the frame state after the VM step and the interaction response,
 * so it sees the transform every renderer will read. Motion reaches the
 * feedback pass through four different seams depending on backend and
 * preset class, and all four are scaled here:
 *
 *   - `warpField` (WebGL, presets with per-pixel code): the CPU mesh, a
 *     scatter whose positions carry the whole transform and whose uvs are
 *     the untouched lattice. Pulling positions back toward the lattice is
 *     exact — at scale 0 every vertex samples itself.
 *   - `gpuGeometry.meshField` / `motionVectorField` (WebGPU procedural
 *     mesh, motion vectors on both backends): the transform descriptor.
 *   - `post.shaderControls` (uniform-driven warp when no mesh is built, and
 *     WebGPU 'controls' execution): zoom/rotation/offset/warpScale.
 *   - `variables` (feedback-composite's classic-preset zoom/rot/dx/dy, and
 *     the per-frame base a lowered per-pixel program starts from): a
 *     read-only VM proxy, so it is overlaid rather than written.
 *
 * Not covered: a preset whose warp *shader* owns the transform on either
 * backend, and the per-pixel part of a lowered WebGPU program (its
 * per-frame base is dampened, its per-pixel offsets are not). Both need a
 * uniform inside the feedback pass itself.
 */
import type { MilkdropFrameState } from '../renderer-types.ts';

/** Above this the dampener is a no-op and the frame passes through untouched. */
const PASSTHROUGH_THRESHOLD = 0.999;

function clampScale(motionScale: number): number {
  if (!Number.isFinite(motionScale)) return 1;
  return Math.min(1, Math.max(0, motionScale));
}

/** Scale a value's distance from its identity. `identity + (-x * 0)` is +0. */
function toward(identity: number, value: number, scale: number): number {
  return identity + (value - identity) * scale;
}

/**
 * The per-frame warp variables the feedback pass reads by name, with the
 * identity each one rests at. `cx`/`cy` are centres, not motion: left alone.
 */
const WARP_VARIABLE_IDENTITY: Readonly<Record<string, number>> = {
  zoom: 1,
  zoomexp: 1,
  rot: 0,
  warp: 0,
  dx: 0,
  dy: 0,
  sx: 1,
  sy: 1,
};

function overlayWarpVariables(
  variables: Record<string, number>,
  scale: number,
): Record<string, number> {
  return new Proxy(variables, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (
        typeof prop === 'string' &&
        prop in WARP_VARIABLE_IDENTITY &&
        typeof value === 'number' &&
        Number.isFinite(value)
      ) {
        return toward(WARP_VARIABLE_IDENTITY[prop] ?? 0, value, scale);
      }
      return value;
    },
  });
}

function dampenFieldTransform(
  field: {
    zoom: number;
    zoomExponent: number;
    rotation: number;
    warp: number;
    scaleX: number;
    scaleY: number;
    translateX: number;
    translateY: number;
  },
  scale: number,
) {
  field.zoom = toward(1, field.zoom, scale);
  field.zoomExponent = toward(1, field.zoomExponent, scale);
  field.rotation = toward(0, field.rotation, scale);
  field.warp = toward(0, field.warp, scale);
  field.scaleX = toward(1, field.scaleX, scale);
  field.scaleY = toward(1, field.scaleY, scale);
  field.translateX = toward(0, field.translateX, scale);
  field.translateY = toward(0, field.translateY, scale);
}

/**
 * Scale the frame's motion toward rest. Mutates the per-frame objects in
 * place, as the interaction response before it does; returns the same
 * frame state so it composes at the call site.
 */
export function applyMotionDampening(
  frameState: MilkdropFrameState,
  motionScale: number,
): MilkdropFrameState {
  const scale = clampScale(motionScale);
  if (scale >= PASSTHROUGH_THRESHOLD) {
    return frameState;
  }

  const { warpField, gpuGeometry, post } = frameState;

  if (warpField) {
    const { positions, uvs } = warpField;
    const count = Math.min(positions.length, uvs.length);
    for (let index = 0; index < count; index += 1) {
      // uvs are the lattice in [0,1]; positions are its transform in [-1,1].
      const lattice = (uvs[index] ?? 0) * 2 - 1;
      positions[index] = toward(lattice, positions[index] ?? lattice, scale);
    }
  }

  if (gpuGeometry.meshField) {
    dampenFieldTransform(gpuGeometry.meshField, scale);
  }
  if (gpuGeometry.motionVectorField) {
    dampenFieldTransform(gpuGeometry.motionVectorField, scale);
  }

  post.warp = toward(0, post.warp, scale);
  const controls = post.shaderControls;
  controls.zoom = toward(1, controls.zoom, scale);
  controls.rotation = toward(0, controls.rotation, scale);
  controls.offsetX = toward(0, controls.offsetX, scale);
  controls.offsetY = toward(0, controls.offsetY, scale);
  controls.warpScale = toward(0, controls.warpScale, scale);

  frameState.variables = overlayWarpVariables(frameState.variables, scale);

  return frameState;
}
