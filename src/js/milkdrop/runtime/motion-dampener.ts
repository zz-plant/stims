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

import { translatePredictability } from '../../core/services/sensory-translation.ts';
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

/**
 * A read-only view of the frame's variable bag in which `read` decides what
 * each name returns. Enumeration still lists the bag's own keys.
 *
 * The view's target is an empty object, never the bag. After a Proxy's get
 * trap returns, the engine asks the target for its own descriptor of that
 * key, to enforce the Proxy invariants. When the target is the VM's
 * variables proxy, that question runs its `getOwnPropertyDescriptor` trap,
 * which builds the whole frame snapshot (state, registers and every wave and
 * shape local) once a frame and a descriptor object on every read. The
 * predictability dial wraps every frame at its default setting, and the
 * feedback pass reads q1–q32, zoom, rot, dx and dy through it, so that cost
 * landed on every frame for every visitor.
 */
function overlayFrameVariables(
  variables: Record<string, number>,
  read: (prop: string) => unknown,
): Record<string, number> {
  return new Proxy({} as Record<string, number>, {
    get(_target, prop) {
      return typeof prop === 'string'
        ? read(prop)
        : Reflect.get(variables, prop);
    },
    has(_target, prop) {
      return Reflect.has(variables, prop);
    },
    ownKeys() {
      return Reflect.ownKeys(variables);
    },
    getOwnPropertyDescriptor(_target, prop) {
      const descriptor = Reflect.getOwnPropertyDescriptor(variables, prop);
      if (!descriptor) {
        return undefined;
      }
      if (typeof prop === 'string' && 'value' in descriptor) {
        descriptor.value = read(prop);
      }
      // The empty target has no such key, and a Proxy may only report a
      // configurable property the target lacks.
      descriptor.configurable = true;
      return descriptor;
    },
  });
}

function overlayWarpVariables(
  variables: Record<string, number>,
  scale: number,
): Record<string, number> {
  return overlayFrameVariables(variables, (prop) => {
    const value = variables[prop];
    if (
      prop in WARP_VARIABLE_IDENTITY &&
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      return toward(WARP_VARIABLE_IDENTITY[prop] ?? 0, value, scale);
    }
    return value;
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
/**
 * Apply a slow breathing expansion to the frame's zoom, driven by the
 * sensory mood dial's breathing cadence LFO. The factor is small (±0.02)
 * and multiplies the existing zoom so it composes with motion dampening
 * and the preset's own zoom.
 */
export function applyBreathingExpansion(
  frameState: MilkdropFrameState,
  expansionFactor: number,
): MilkdropFrameState {
  if (!Number.isFinite(expansionFactor) || Math.abs(expansionFactor) < 1e-6) {
    return frameState;
  }
  const factor = 1 + expansionFactor;

  const { gpuGeometry, post } = frameState;
  if (gpuGeometry.meshField) {
    gpuGeometry.meshField.zoom = (gpuGeometry.meshField.zoom ?? 1) * factor;
  }
  if (gpuGeometry.motionVectorField) {
    gpuGeometry.motionVectorField.zoom =
      (gpuGeometry.motionVectorField.zoom ?? 1) * factor;
  }

  // The feedback pass uses `shaderControls.zoom` when it is not the default 1,
  // and the preset's variable `zoom` otherwise. Scale whichever one the
  // renderer will actually read, so breathing composes with the preset's own
  // zoom instead of masking it.
  const controlsZoom = post.shaderControls.zoom;
  if (controlsZoom === undefined || controlsZoom === 1) {
    const variables = frameState.variables as Record<string, number> | null;
    if (variables && typeof variables === 'object') {
      frameState.variables = overlayFrameVariables(variables, (prop) => {
        const value = variables[prop];
        if (
          prop === 'zoom' &&
          typeof value === 'number' &&
          Number.isFinite(value)
        ) {
          return value * factor;
        }
        return value;
      }) as typeof frameState.variables;
    }
  } else {
    post.shaderControls.zoom = controlsZoom * factor;
  }
  return frameState;
}

/** The preset's per-frame q variables, the range the smoothing filter owns. */
const Q_VARIABLE_COUNT = 32;

const predictabilityPrevious = new WeakMap<object, Record<string, number>>();

/**
 * Smooth sudden jumps in the preset's q-variables according to the
 * predictability dial. A low-pass filter blends each q value toward its
 * new target instead of stepping instantly, favouring steady rhythmic
 * motion over random flicker. Composes with motion dampening (which
 * overlays warp transforms) by wrapping the variables object in its own
 * proxy, leaving the underlying VM state untouched.
 */
export function applyPredictabilitySmoothing(
  frameState: MilkdropFrameState,
  predictability: number,
): MilkdropFrameState {
  const { smoothingAlpha } = translatePredictability(predictability);
  // alpha === 1.0 means no smoothing (instant response); skip the proxy.
  if (smoothingAlpha >= 0.999) {
    return frameState;
  }

  const variables = frameState.variables as Record<string, number> | null;
  if (!variables || typeof variables !== 'object') {
    return frameState;
  }

  // Key the history on the underlying variables object. This runs before
  // motion dampening, so the key is the stable VM proxy, not the per-frame
  // dampening proxy — otherwise the history would reset every frame.
  let previous = predictabilityPrevious.get(variables);
  if (!previous) {
    previous = {};
    predictabilityPrevious.set(variables, previous);
  }

  // Snapshot once per frame: the feedback pass reads the same q variables for
  // composite and warp uniforms, and advancing the filter per read would make
  // those passes disagree.
  const snapshot: Record<string, number> = {};
  for (let index = 1; index <= Q_VARIABLE_COUNT; index += 1) {
    const key = `q${index}`;
    const value = (variables as Record<string, number>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const prevValue = Number.isFinite(previous[key]) ? previous[key] : value;
    const smoothed = prevValue + smoothingAlpha * (value - prevValue);
    previous[key] = smoothed;
    snapshot[key] = smoothed;
  }

  frameState.variables = overlayFrameVariables(variables, (prop) =>
    prop in snapshot ? snapshot[prop] : variables[prop],
  ) as typeof frameState.variables;

  return frameState;
}

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
    const { positions, uvs, sampleUvs } = warpField;
    const count = Math.min(positions.length, uvs.length);
    for (let index = 0; index < count; index += 1) {
      // uvs are the lattice in [0,1]; positions are its transform in [-1,1].
      const lattice = (uvs[index] ?? 0) * 2 - 1;
      positions[index] = toward(lattice, positions[index] ?? lattice, scale);
      // The gather form a warp shader samples through: same pull, [0,1].
      if (sampleUvs) {
        const latticeUv = uvs[index] ?? 0;
        sampleUvs[index] = toward(
          latticeUv,
          sampleUvs[index] ?? latticeUv,
          scale,
        );
      }
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
