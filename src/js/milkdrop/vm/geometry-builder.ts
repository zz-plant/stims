/**
 * Turns per-frame VM state into the vertex data a frame actually draws.
 *
 * Builds the warp mesh, motion vectors and particle fields: choosing mesh
 * density for the device, evaluating the per-vertex program across mesh points,
 * and packing the results into typed arrays for the renderer adapter.
 *
 * This is the hottest CPU work in a frame — the per-vertex program runs once
 * per mesh point, so mesh density is the single biggest lever on frame cost and
 * is deliberately device-dependent (`getMeshDensity`). Allocation discipline
 * matters here more than elsewhere; buffers are reused across frames because
 * per-frame allocation at this size shows up directly as GC pauses.
 *
 * Profile changes with `bun run profile:frame` rather than reasoning about
 * them; intuition about which loop dominates is usually wrong.
 */
import { getDevicePerformanceProfile } from '../../core/device-profile.ts';
import { isMobileDevice } from '../../utils/browser/device-detect';
import { normalizeProgramAssignmentTarget } from '../field-normalization.ts';
import type {
  MilkdropCompiledPreset,
  MilkdropGpuFieldSignalInputs,
  MilkdropGpuGeometryHints,
  MilkdropMeshVisual,
  MilkdropMotionVectorVisual,
  MilkdropParticleFieldVisual,
  MilkdropProceduralMeshDescriptorPlan,
  MilkdropProceduralMeshFieldVisual,
  MilkdropProceduralMotionVectorDescriptorPlan,
  MilkdropProceduralMotionVectorFieldVisual,
  MilkdropRuntimeSignals,
  MilkdropWarpFieldVisual,
} from '../types';
import {
  clamp,
  color,
  type GeometryBuilderState,
  hashSeed,
  MAX_MOTION_VECTOR_COLUMNS,
  MAX_MOTION_VECTOR_ROWS,
  type MeshField,
  type MeshFieldPoint,
  type MotionVectorDescriptorContext,
  type MotionVectorHistoryPoint,
  type MutableState,
  normalizeTransformCenter,
  normalizeTransformCenterY,
  type StaticMeshLattice,
} from './shared';

type ParticleFieldDeviceProfile = {
  isMobile: boolean;
  lowPower: boolean;
};

type ParticleFieldSource = {
  state: MutableState;
  meshField: MeshField;
  signals: MilkdropRuntimeSignals;
  detailScale: number;
  deviceProfile?: Partial<ParticleFieldDeviceProfile>;
};

export function shouldEnableParticleField({
  meshDensity,
  pointCount,
  detailScale,
  isMobile,
  lowPower,
}: {
  meshDensity: number;
  pointCount: number;
  detailScale: number;
  isMobile: boolean;
  lowPower: boolean;
}) {
  return (
    !isMobile &&
    !lowPower &&
    meshDensity >= 12 &&
    pointCount >= 64 &&
    detailScale >= 0.85
  );
}

function resolveParticleFieldDeviceProfile(
  overrides: Partial<ParticleFieldDeviceProfile> = {},
): ParticleFieldDeviceProfile {
  return {
    isMobile: overrides.isMobile ?? isMobileDevice(),
    lowPower:
      overrides.lowPower ?? getDevicePerformanceProfile().lowPower ?? false,
  };
}

function getParticleFieldInstanceCount({
  meshDensity,
  detailScale,
  pointCount,
}: {
  meshDensity: number;
  detailScale: number;
  pointCount: number;
}) {
  const densityInfluence = clamp(detailScale, 0.5, 2.4);
  const rawCount = Math.round(
    Math.sqrt(pointCount) * (4.5 + meshDensity * 0.22) * densityInfluence,
  );
  return clamp(rawCount, 24, 2400);
}

const STATIC_DISABLED_PARTICLE_FIELD: MilkdropParticleFieldVisual = {
  enabled: false,
  instanceCount: 0,
  size: 0,
  alpha: 0,
  motionScale: 0,
  seed: 0,
  anchorSource: 'mesh-field',
};

export function buildParticleFieldVisual({
  state,
  meshField,
  signals,
  detailScale,
  deviceProfile,
}: ParticleFieldSource): MilkdropParticleFieldVisual {
  const resolvedDeviceProfile = resolveParticleFieldDeviceProfile(
    deviceProfile ?? {},
  );
  const pointCount = meshField.points.length;
  const enabled = shouldEnableParticleField({
    meshDensity: meshField.density,
    pointCount,
    detailScale,
    ...resolvedDeviceProfile,
  });

  if (!enabled) {
    return STATIC_DISABLED_PARTICLE_FIELD;
  }

  const instanceCount = getParticleFieldInstanceCount({
    meshDensity: meshField.density,
    detailScale,
    pointCount,
  });
  const size = clamp(
    0.012 +
      Math.max(0, 24 - meshField.density) * 0.00025 +
      clamp(state.wave_scale ?? 1, 0.5, 2.5) * 0.0025,
    0.012,
    0.042,
  );
  const alpha = clamp(
    0.07 +
      (state.wave_a ?? 0.4) * 0.22 +
      signals.beatPulse * 0.08 +
      signals.music * 0.03,
    0.06,
    0.48,
  );
  const motionScale = clamp(
    0.006 +
      signals.bassAtt * 0.011 +
      signals.midAtt * 0.008 +
      signals.trebleAtt * 0.01 +
      clamp(state.warp ?? 0, 0, 1) * 0.004,
    0.004,
    0.03,
  );
  const seed = hashSeed(
    `${meshField.density}:${Math.round(state.mesh_density ?? 0)}:${Math.round(state.wave_mode ?? 0)}`,
  );

  return {
    enabled: true,
    instanceCount,
    size,
    alpha,
    motionScale,
    seed,
    anchorSource: 'mesh-field',
  };
}

type MilkdropProgramBlock = MilkdropCompiledPreset['ir']['programs']['init'];

type RunProgramFn = (
  block: MilkdropProgramBlock,
  env: MutableState,
  locals?: MutableState | null,
) => void;

type CreateEnvFn = (
  signals: MilkdropRuntimeSignals,
  extra?: Record<string, number>,
  options?: {
    reuseExtraAsEnv?: boolean;
  },
) => MutableState;

/**
 * Everything a mesh-point transform needs that is CONSTANT for every vertex in
 * a frame. Built once per pass by createMeshTransformFrame, then reused by
 * transformMeshPoint for each of the ~1.7k vertices.
 *
 * WHY this exists (do not fold it back into the per-vertex path): a CPU profile
 * (CDP, 200 stepped frames) put transformMeshPoint at 2.5ms of a 4.0ms frame —
 * 44% — even on a preset with ZERO equations, and frame cost was flat across a
 * 746x range of preset complexity. The cost was not the geometry math, it was
 * per-vertex environment wiring:
 *   - Object.setPrototypeOf(scratch, signalEnv) on every vertex (createEnv with
 *     reuseExtraAsEnv), which deoptimises every later property access;
 *   - a 32-iteration loop that built `q${i}` strings and did prototype-chain
 *     `in` checks — 56,448 `in` checks per frame on a 42x42 mesh;
 *   - a memoised compileMilkdropProgram WeakMap lookup per vertex which, for a
 *     preset with no per-pixel code, resolved to NO_OP.
 *
 * The q1..q32 seeding loop was additionally DEAD code: `scratch`'s prototype
 * chain reaches the VM register bank, which always defines q1..q32 (vm.ts seeds
 * them in setPreset before any frame runs), so `key in local` was always true
 * and the loop body never executed. Removing it is behaviour-preserving.
 */
type MeshTransformFrame = {
  signals: MilkdropRuntimeSignals;
  state: MutableState;
  runProgram: RunProgramFn;
  scratch: MutableState;
  /**
   * `scratch` with its prototype already wired to the VM signal env (what
   * createEnv(..., { reuseExtraAsEnv: true }) returns — it returns the very
   * object it was handed). Built ONCE per pass: Object.setPrototypeOf on the
   * same object with the same prototype is semantically a no-op after the
   * first call, but V8 treats prototype mutation as a deopt trigger, so doing
   * it per vertex (~1764x/frame) poisoned every later property access. Null
   * when the preset has no per-pixel program (scratch is never used then).
   */
  perPixelEnv: MutableState | null;
  aspectX: number;
  aspectY: number;
  /** null when the preset ships no per-pixel code (compiles to NO_OP). */
  perPixelProgram: MilkdropProgramBlock | null;
  /** signals.time * (0.35 + warpanimspeed); per-frame constant. */
  rippleTime: number;
  // Fast-path per-frame transform constants. Only valid (and only read) when
  // perPixelProgram is null — with per-pixel code every one of these may be
  // rewritten per vertex, so that path re-reads them from the scratch locals.
  zoom: number;
  zoomExponent: number;
  cosRot: number;
  sinRot: number;
  warp: number;
  centerX: number;
  centerY: number;
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
  isIdentity: boolean;
  // Per-frame BASE values of the built-in per-pixel variables, read raw off
  // `state` once per pass. Only used by the per-pixel path, which must reset
  // every one of them on EVERY vertex (per-pixel code may overwrite them and
  // the next vertex has to start from the frame base, not the neighbour's
  // leftovers). Hoisting removes only the repeated prototype-chain lookup and
  // nullish check, not the reset.
  baseZoom: number;
  baseZoomExp: number;
  baseRot: number;
  baseWarp: number;
  baseCx: number;
  baseCy: number;
  baseSx: number;
  baseSy: number;
  baseDx: number;
  baseDy: number;
  /**
   * Per-cell constants for the mesh lattice (gridX/gridY/milkdropX/milkdropY/rad),
   * rebuilt only when density or aspect changes. Precomputed once so the hot
   * per-vertex loop no longer pays a sqrt (and the [0,1]-space round trip)
   * for every mesh vertex of every frame.
   */
  lattice: StaticMeshLattice | null;
};

function createMeshTransformFrame({
  signals,
  state,
  preset,
  geometryState,
  runProgram,
  createEnv,
  aspectX,
  aspectY,
}: {
  signals: MilkdropRuntimeSignals;
  state: MutableState;
  preset: MilkdropCompiledPreset;
  geometryState: GeometryBuilderState;
  runProgram: RunProgramFn;
  createEnv: CreateEnvFn;
  aspectX?: number;
  aspectY?: number;
}): MeshTransformFrame {
  const aspectRatio = signals.aspect ?? 1;
  // MilkDrop shrinks the minor axis (values <= 1); mirrors the shader-uniform
  // convention in feedback-manager-shared.ts's syncMilkdropShaderBuiltinUniforms.
  const resolvedAspectX = aspectX ?? (aspectRatio < 1 ? aspectRatio : 1);
  const resolvedAspectY = aspectY ?? (aspectRatio > 1 ? 1 / aspectRatio : 1);
  const perPixel = preset.ir.programs.perPixel;
  const hasPerPixel = perPixel.statements.length > 0;
  const warpAnimSpeed = clamp(state.warpanimspeed ?? 1, 0, 4);
  const rot = state.rot ?? 0;
  const scratch = geometryState.pointScratch;
  // Wire the scratch prototype (and refresh the VM signal env, which
  // prepareSignalEnv memoises per signals/frame/time) exactly once per pass.
  const perPixelEnv = hasPerPixel
    ? createEnv(signals, scratch, { reuseExtraAsEnv: true })
    : null;
  const zoom = Math.max(state.zoom ?? 1, 0);
  const zoomExponent = Math.max(state.zoomexp ?? 1, 0.0001);
  const warp = state.warp ?? 0;
  const centerX = normalizeTransformCenter(state.cx ?? 0.5);
  const centerY = normalizeTransformCenterY(state.cy ?? 0.5);
  const scaleX = state.sx ?? 1;
  const scaleY = state.sy ?? 1;
  const translateX = state.dx ?? 0;
  const translateY = state.dy ?? 0;
  const isIdentity =
    !hasPerPixel &&
    zoom === 1 &&
    zoomExponent === 1 &&
    rot === 0 &&
    warp === 0 &&
    scaleX === 1 &&
    scaleY === 1 &&
    translateX === 0 &&
    translateY === 0 &&
    centerX === 0 &&
    centerY === 0;

  return {
    signals,
    state,
    runProgram,
    scratch,
    perPixelEnv,
    aspectX: resolvedAspectX,
    aspectY: resolvedAspectY,
    perPixelProgram: hasPerPixel ? perPixel : null,
    rippleTime: signals.time * (0.35 + warpAnimSpeed),
    zoom,
    zoomExponent,
    cosRot: Math.cos(rot),
    sinRot: Math.sin(rot),
    warp,
    centerX,
    centerY,
    scaleX,
    scaleY,
    translateX,
    translateY,
    isIdentity,
    baseZoom: state.zoom ?? 1,
    baseZoomExp: state.zoomexp ?? 1,
    baseRot: rot,
    baseWarp: state.warp ?? 0,
    baseCx: state.cx ?? 0.5,
    baseCy: state.cy ?? 0.5,
    baseSx: state.sx ?? 1,
    baseSy: state.sy ?? 1,
    baseDx: state.dx ?? 0,
    baseDy: state.dy ?? 0,
    lattice: geometryState.lattice ?? null,
  };
}

// Every transform is recomputed; callers copy x/y out before the next call.
const transientTransformResult = { x: 0, y: 0 };
/** Companion to {@link transientTransformResult}: the warp sampling point. */
const transientGatherResult = { x: 0, y: 0 };

/**
 * Precomputed lattice constants handed to transformMeshPoint by buildMeshField:
 * the MilkDrop [0,1]-space coordinates and the center-independent radius for
 * one mesh cell. These are invariant across frames (they depend only on the
 * grid position and aspect), so the per-vertex loop reads them instead of
 * recomputing the sqrt (and the round trip) for every vertex of every frame.
 */
type LatticeSample = {
  milkdropX: number;
  milkdropY: number;
  rad: number;
};

const transientLatticeSample: LatticeSample = {
  milkdropX: 0,
  milkdropY: 0,
  rad: 0,
};

function transformMeshPoint(
  frame: MeshTransformFrame,
  gridX: number,
  gridY: number,
  latticeSample: LatticeSample | null = null,
): { x: number; y: number } {
  if (frame.isIdentity) {
    transientTransformResult.x = gridX;
    transientTransformResult.y = gridY;
    transientGatherResult.x = gridX;
    transientGatherResult.y = gridY;
    return transientTransformResult;
  }
  const aspectX = frame.aspectX;
  const aspectY = frame.aspectY;
  const perPixel = frame.perPixelProgram;

  let rendererX: number;
  let rendererY: number;
  let rad: number;
  let warp: number;
  let centerX: number;
  let centerY: number;
  let scaleX: number;
  let scaleY: number;
  let translateX: number;
  let translateY: number;
  let cosRot: number;
  let sinRot: number;
  let zoomExponent: number;
  let zoom: number;

  if (perPixel) {
    const local = frame.scratch;

    // Convert from renderer space [-1,1] to MilkDrop space [0,1]
    // x = 0 is left, x = 1 is right (with aspect correction)
    // y = 0 is top, y = 1 is bottom (with y-flip and aspect correction)
    local.x = latticeSample
      ? latticeSample.milkdropX
      : gridX * 0.5 * aspectX + 0.5;
    local.y = latticeSample
      ? latticeSample.milkdropY
      : -gridY * 0.5 * aspectY + 0.5;
    const dxFromCenter = (local.x - frame.baseCx) * aspectX;
    const dyFromCenter = (local.y - frame.baseCy) * aspectY;
    local.rad =
      Math.sqrt(dxFromCenter * dxFromCenter + dyFromCenter * dyFromCenter) * 2;
    local.ang = Math.atan2(dyFromCenter, dxFromCenter);
    // Reset every built-in per-pixel variable from the frame bases: per-pixel
    // code may have overwritten them on the previous vertex.
    local.zoom = frame.baseZoom;
    local.zoomexp = frame.baseZoomExp;
    local.rot = frame.baseRot;
    local.warp = frame.baseWarp;
    local.cx = frame.baseCx;
    local.cy = frame.baseCy;
    local.sx = frame.baseSx;
    local.sy = frame.baseSy;
    local.dx = frame.baseDx;
    local.dy = frame.baseDy;

    // frame.perPixelEnv is `local` itself, prototype already wired at pass
    // setup, so no per-vertex createEnv / setPrototypeOf.
    frame.runProgram(perPixel, frame.perPixelEnv ?? local, local);

    // Per-pixel code reads (and may write) x/y in MilkDrop [0,1] space; the
    // transform math below runs in renderer [-1,1] space, so invert the mapping.
    rendererX = (((local.x ?? 0.5) - 0.5) * 2) / aspectX;
    rendererY = -((((local.y ?? 0.5) - 0.5) * 2) / aspectY);
    rad = local.rad;
    warp = local.warp;
    centerX = normalizeTransformCenter(local.cx ?? 0.5);
    centerY = normalizeTransformCenterY(local.cy ?? 0.5);
    scaleX = local.sx ?? 1;
    scaleY = local.sy ?? 1;
    translateX = local.dx ?? 0;
    translateY = local.dy ?? 0;
    cosRot = Math.cos(local.rot);
    sinRot = Math.sin(local.rot);
    zoomExponent = Math.max(local.zoomexp ?? 1, 0.0001);
    zoom = Math.max(local.zoom ?? 1, 0);
  } else {
    // No per-pixel program: nothing can rewrite x/y/rad/zoom/rot/... per vertex,
    // so skip the env wiring and the NO_OP program call entirely. The geometric
    // transform below still runs unchanged. The round trip through MilkDrop
    // [0,1] space is reproduced literally rather than simplified to `gridX`,
    // because (gridX * 0.5 * aspectX) * 2 / aspectX is not bit-identical to
    // gridX when aspectX is not a power of two.
    let localX: number;
    let localY: number;
    if (latticeSample) {
      localX = latticeSample.milkdropX;
      localY = latticeSample.milkdropY;
      rad = latticeSample.rad;
    } else {
      localX = gridX * 0.5 * aspectX + 0.5;
      localY = -gridY * 0.5 * aspectY + 0.5;
      const aspectGridX = gridX * aspectX;
      const aspectGridY = gridY * aspectY;
      rad = Math.sqrt(aspectGridX * aspectGridX + aspectGridY * aspectGridY);
    }
    rendererX = ((localX - 0.5) * 2) / aspectX;
    rendererY = -(((localY - 0.5) * 2) / aspectY);
    warp = frame.warp;
    centerX = frame.centerX;
    centerY = frame.centerY;
    scaleX = frame.scaleX;
    scaleY = frame.scaleY;
    translateX = frame.translateX;
    translateY = frame.translateY;
    cosRot = frame.cosRot;
    sinRot = frame.sinRot;
    zoomExponent = frame.zoomExponent;
    zoom = frame.zoom;
  }

  const relX = rendererX - centerX;
  const relY = rendererY - centerY;
  const rx = relX * cosRot - relY * sinRot + centerX;
  const ry = relX * sinRot + relY * cosRot + centerY;

  // Zoom. Skipped when it cannot change the vertex: zoomExponent === 1 folds
  // the exponent to `zoom ** 1 === zoom` (exact in IEEE), and zoom === 1 folds
  // `1 ** finite === 1` (exact). Both skip the hypot, the radius-normalization
  // and the pow — the single most expensive call in this loop.
  let zx: number;
  let zy: number;
  if (zoomExponent === 1) {
    const zoomScale = clamp(zoom, 0.02, 50);
    zx = centerX + (rx - centerX) * zoomScale;
    zy = centerY + (ry - centerY) * zoomScale;
  } else if (zoom === 1) {
    zx = centerX + (rx - centerX);
    zy = centerY + (ry - centerY);
  } else {
    const zoomRadius = Math.hypot(rx - centerX, ry - centerY);
    const radiusNormalized = clamp(zoomRadius / Math.SQRT2, 0, 1);
    // Authored presets legitimately use extreme pairs (orbasonic ships
    // zoom=100 with zoomexp=100); unclamped, zoom^(zoomexp^(2r-1)) overflows
    // float32 at the edges and NaN-poisons the warp into a black frame.
    // MilkDrop's own math saturates instead of exploding, so bound the scale.
    const zoomScale = clamp(
      zoom === 0 ? 0 : zoom ** (zoomExponent ** (radiusNormalized * 2 - 1)),
      0.02,
      50,
    );
    zx = centerX + (rx - centerX) * zoomScale;
    zy = centerY + (ry - centerY) * zoomScale;
  }

  // Ripple. warp === 0 makes the whole ripple exactly zero, so skip the trig
  // outright. Otherwise the displacement direction is (zx,zy) relative to the
  // center — a unit vector that needs no atan2: atan2's cosine/sine ARE the
  // normalized components. Mathematically identical, avoids 3 transcendentals.
  let wx: number;
  let wy: number;
  if (warp === 0) {
    wx = zx;
    wy = zy;
  } else {
    const ripple = Math.sin(rad * 8.0 + frame.rippleTime) * warp * 0.1;
    const offsetX = zx - centerX;
    const offsetY = zy - centerY;
    if (offsetX === 0 && offsetY === 0) {
      // atan2(0, 0) === 0, so cos = 1 / sin = 0.
      wx = zx + ripple;
      wy = zy;
    } else {
      const directionLength = Math.hypot(offsetX, offsetY);
      wx = zx + (offsetX / directionLength) * ripple;
      wy = zy + (offsetY / directionLength) * ripple;
    }
  }

  const tx = wx + translateX;
  const ty = wy + translateY;

  const transformed = transientTransformResult;
  transformed.x = (tx - centerX) * scaleX + centerX;
  transformed.y = (ty - centerY) * scaleY + centerY;

  // Sampling coordinate for the warp pass: MilkDrop *gathers* — a vertex sits
  // at its lattice position and reads the previous frame from where the
  // transform came from — so the same per-vertex zoom/rot/dx/dy assemble the
  // inverse of the scatter above. Drawing the scatter instead folds the grid
  // and loses coverage wherever it leaves the screen, which cost presets that
  // the uniform path already rendered correctly.
  const gatherRelX = rendererX - centerX;
  const gatherRelY = rendererY - centerY;
  const gatherZoom = zoomExponent === 1 ? zoom : zoom ** zoomExponent;
  const gatherScale = 1 / clamp(gatherZoom, 0.02, 50);
  const unrotX = gatherRelX * cosRot + gatherRelY * sinRot;
  const unrotY = -gatherRelX * sinRot + gatherRelY * cosRot;
  transientGatherResult.x =
    centerX + (unrotX * gatherScale) / (scaleX || 1) - translateX;
  transientGatherResult.y =
    centerY + (unrotY * gatherScale) / (scaleY || 1) - translateY;
  return transformed;
}

export function getMeshDensity(state: MutableState, detailScale: number) {
  // 96 caps the per-frame CPU warp at ~9.2k vertices; only reachable when the
  // detail scale (gated on backend + quality tier) climbs past ~3x. Mobile
  // caps at 48 (~2.3k vertices): the transform loop runs on one phone core
  // and every vertex costs the same regardless of preset complexity.
  const ceiling = isMobileDevice() ? 48 : 96;
  return clamp(
    Math.round((state.mesh_density ?? 24) * detailScale),
    8,
    ceiling,
  );
}

/**
 * Builds the per-cell constants for a mesh lattice. Every value depends only
 * on the grid position, the density and the aspect — none of them on the
 * frame — so a single build per density/aspect change replaces a per-vertex
 * sqrt (and the renderer-space round trip) in every frame of the preset's run.
 * The `rad` values match transformMeshPoint's non-per-pixel formula exactly;
 * `ang` is populated for parity with the declared StaticMeshLattice contract.
 */
function buildStaticMeshLattice(
  density: number,
  aspectX: number,
  aspectY: number,
): StaticMeshLattice {
  const count = density * density;
  const gridX = new Float32Array(count);
  const gridY = new Float32Array(count);
  const milkdropX = new Float32Array(count);
  const milkdropY = new Float32Array(count);
  const rad = new Float32Array(count);
  const ang = new Float32Array(count);
  const gridStep = Math.max(1, density - 1);
  for (let row = 0; row < density; row += 1) {
    const y = (row / gridStep) * 2 - 1;
    const rowBase = row * density;
    const milkdropYValue = -y * 0.5 * aspectY + 0.5;
    const aspectGridY = y * aspectY;
    for (let col = 0; col < density; col += 1) {
      const index = rowBase + col;
      const x = (col / gridStep) * 2 - 1;
      const aspectGridX = x * aspectX;
      gridX[index] = x;
      gridY[index] = y;
      milkdropX[index] = x * 0.5 * aspectX + 0.5;
      milkdropY[index] = milkdropYValue;
      rad[index] = Math.sqrt(
        aspectGridX * aspectGridX + aspectGridY * aspectGridY,
      );
      ang[index] = Math.atan2(aspectGridY, aspectGridX);
    }
  }
  return {
    density,
    aspectX,
    aspectY,
    gridX,
    gridY,
    milkdropX,
    milkdropY,
    rad,
    ang,
  };
}

const legacyMotionVectorControlsCache = new WeakMap<object, boolean>();

export function getMotionVectorDescriptorContext({
  state,
  preset,
}: {
  state: MutableState;
  preset: MilkdropCompiledPreset;
}): MotionVectorDescriptorContext | null {
  // "Legacy" means the preset steers motion vectors through the mv_* fields
  // instead of the modern `motion_vectors` toggle. That has to be decided from
  // what the preset DECLARED, not from runtime values: mv_l defaults to 0.9
  // and mv_r/g/b to 1 (MilkDrop's real defaults), so a value-based test reads
  // every preset as legacy.
  // ast.fields keys are raw preset text (`fMotionVectorsL`), so normalize
  // before comparing — MilkDrop-authored files never spell them `mv_l`.
  // Pure function of the preset, but this context is requested up to twice
  // per frame — cache so the full AST/program sweep runs once per preset.
  let legacyControls = legacyMotionVectorControlsCache.get(preset);
  if (legacyControls === undefined) {
    legacyControls =
      preset.ast.fields.some((field) => {
        const key = normalizeProgramAssignmentTarget(field.key);
        return key === 'mv_dx' || key === 'mv_dy' || key === 'mv_l';
      }) ||
      preset.ir.programs.init.statements.some(
        (statement) =>
          statement.target === 'motion_vectors_x' ||
          statement.target === 'motion_vectors_y',
      ) ||
      preset.ir.programs.perFrame.statements.some(
        (statement) =>
          statement.target === 'motion_vectors_x' ||
          statement.target === 'motion_vectors_y',
      );
    legacyMotionVectorControlsCache.set(preset, legacyControls);
  }

  if ((state.motion_vectors ?? 0) < 0.5 && !legacyControls) {
    return null;
  }

  return {
    legacyControls,
    countX: clamp(
      Math.round(state.motion_vectors_x ?? 16),
      1,
      MAX_MOTION_VECTOR_COLUMNS,
    ),
    countY: clamp(
      Math.round(state.motion_vectors_y ?? 12),
      1,
      MAX_MOTION_VECTOR_ROWS,
    ),
  };
}

const reusableFieldTransform = {
  zoom: 1,
  zoomExponent: 1,
  rotation: 0,
  warp: 0,
  warpAnimSpeed: 1,
  centerX: 0,
  centerY: 0,
  scaleX: 1,
  scaleY: 1,
  translateX: 0,
  translateY: 0,
};

export function buildProceduralFieldTransform(state: MutableState) {
  reusableFieldTransform.zoom = Math.max(state.zoom ?? 1, 0.0001);
  reusableFieldTransform.zoomExponent = Math.max(state.zoomexp ?? 1, 0.0001);
  reusableFieldTransform.rotation = state.rot ?? 0;
  reusableFieldTransform.warp = state.warp ?? 0;
  reusableFieldTransform.warpAnimSpeed = clamp(state.warpanimspeed ?? 1, 0, 4);
  reusableFieldTransform.centerX = normalizeTransformCenter(state.cx ?? 0.5);
  reusableFieldTransform.centerY = normalizeTransformCenterY(state.cy ?? 0.5);
  reusableFieldTransform.scaleX = state.sx ?? 1;
  reusableFieldTransform.scaleY = state.sy ?? 1;
  reusableFieldTransform.translateX = state.dx ?? 0;
  reusableFieldTransform.translateY = state.dy ?? 0;
  return reusableFieldTransform;
}

const reusableFieldSignals: MilkdropGpuFieldSignalInputs = {
  time: 0,
  frame: 0,
  fps: 60,
  aspect: 1,
  bass: 0,
  mid: 0,
  mids: 0,
  treble: 0,
  bassAtt: 0,
  midAtt: 0,
  midsAtt: 0,
  trebleAtt: 0,
  beat: 0,
  beatPulse: 0,
  rms: 0,
  vol: 0,
  music: 0,
  weightedEnergy: 0,
  pixelsx: undefined,
  pixelsy: undefined,
};

export function buildProceduralFieldSignals(
  signals: MilkdropRuntimeSignals,
): MilkdropGpuFieldSignalInputs {
  reusableFieldSignals.time = signals.time;
  reusableFieldSignals.frame = signals.frame;
  reusableFieldSignals.fps = signals.fps;
  reusableFieldSignals.aspect = signals.aspect ?? 1;
  reusableFieldSignals.bass = signals.bass;
  reusableFieldSignals.mid = signals.mid;
  reusableFieldSignals.mids = signals.mids;
  reusableFieldSignals.treble = signals.treble;
  reusableFieldSignals.bassAtt = signals.bassAtt;
  reusableFieldSignals.midAtt = signals.mid_att;
  reusableFieldSignals.midsAtt = signals.midsAtt;
  reusableFieldSignals.trebleAtt = signals.trebleAtt;
  reusableFieldSignals.beat = signals.beat;
  reusableFieldSignals.beatPulse = signals.beatPulse;
  reusableFieldSignals.rms = signals.rms;
  reusableFieldSignals.vol = signals.vol;
  reusableFieldSignals.music = signals.music;
  reusableFieldSignals.weightedEnergy = signals.weightedEnergy;
  reusableFieldSignals.pixelsx = signals.pixelsx;
  reusableFieldSignals.pixelsy = signals.pixelsy;
  return reusableFieldSignals;
}

export function buildMeshField({
  state,
  preset,
  signals,
  detailScale,
  geometryState,
  runProgram,
  createEnv,
  proceduralMeshPlan,
}: {
  state: MutableState;
  preset: MilkdropCompiledPreset;
  signals: MilkdropRuntimeSignals;
  detailScale: number;
  geometryState: GeometryBuilderState;
  runProgram: (
    block: MilkdropCompiledPreset['ir']['programs']['init'],
    env: MutableState,
    locals?: MutableState | null,
  ) => void;
  createEnv: (
    signals: MilkdropRuntimeSignals,
    extra?: Record<string, number>,
    options?: {
      reuseExtraAsEnv?: boolean;
    },
  ) => MutableState;
  proceduralMeshPlan: MilkdropProceduralMeshDescriptorPlan | null;
}): MeshField {
  const density = getMeshDensity(state, detailScale);

  // Clear per-pixel scratch each frame to prevent accumulation across frames.
  //
  // A fresh object rather than `delete`-ing every key: `delete` transitions the
  // object to V8 dictionary mode, and it never transitions back. `pointScratch`
  // IS `frame.scratch` — transformMeshPoint writes ~14 properties to it on every
  // one of the ~1.7k vertices, so a dictionary-mode scratch turns ~25k
  // inline-cached property writes per frame into hash lookups. Same reasoning as
  // the per-vertex setPrototypeOf note on MeshTransformFrame above; this was its
  // surviving sibling. createMeshTransformFrame re-reads pointScratch and
  // re-wires its prototype immediately below, so swapping the object is safe.
  geometryState.pointScratch = {};

  if (proceduralMeshPlan) {
    geometryState.meshPoints.length = 0;
    return {
      density,
      points: geometryState.meshPoints,
      program: proceduralMeshPlan.fieldProgram,
      signals: buildProceduralFieldSignals(signals),
    };
  }

  const points = geometryState.meshPoints;
  points.length = density * density;

  const aspectRatio = signals.aspect ?? 1;
  const aspectX = aspectRatio < 1 ? aspectRatio : 1;
  const aspectY = aspectRatio > 1 ? 1 / aspectRatio : 1;

  const lattice = geometryState.lattice;
  if (
    !lattice ||
    lattice.density !== density ||
    lattice.aspectX !== aspectX ||
    lattice.aspectY !== aspectY
  ) {
    geometryState.lattice = buildStaticMeshLattice(density, aspectX, aspectY);
  }

  const transformFrame = createMeshTransformFrame({
    signals,
    state,
    preset,
    geometryState,
    runProgram,
    createEnv,
    aspectX,
    aspectY,
  });

  const latticeCache = geometryState.lattice as StaticMeshLattice;
  for (let row = 0; row < density; row += 1) {
    for (let col = 0; col < density; col += 1) {
      const x = (col / Math.max(1, density - 1)) * 2 - 1;
      const y = (row / Math.max(1, density - 1)) * 2 - 1;
      const pointIndex = row * density + col;
      transientLatticeSample.milkdropX =
        latticeCache.milkdropX[pointIndex] ?? 0;
      transientLatticeSample.milkdropY =
        latticeCache.milkdropY[pointIndex] ?? 0;
      transientLatticeSample.rad = latticeCache.rad[pointIndex] ?? 0;
      const point = transformMeshPoint(
        transformFrame,
        x,
        y,
        transientLatticeSample,
      );
      const pointEntry: MeshFieldPoint = points[pointIndex] ?? {
        sourceX: 0,
        sourceY: 0,
        x: 0,
        y: 0,
        warpU: 0,
        warpV: 0,
      };
      pointEntry.sourceX = x;
      pointEntry.sourceY = y;
      pointEntry.x = point.x;
      pointEntry.y = point.y;
      pointEntry.warpU = transientGatherResult.x;
      pointEntry.warpV = transientGatherResult.y;
      points[pointIndex] = pointEntry;
    }
  }

  return { density, points, program: null, signals: null };
}

export function buildMesh({
  state,
  meshField,
  geometryState,
}: {
  state: MutableState;
  meshField: MeshField;
  geometryState?: GeometryBuilderState;
}): MilkdropMeshVisual {
  const colorValue = color(
    state.mesh_r ?? 0.4,
    state.mesh_g ?? 0.6,
    state.mesh_b ?? 1,
    state.mesh_alpha ?? 0.2,
  );
  const alpha = clamp(state.mesh_alpha ?? 0.2, 0, 0.9);

  if (meshField.points.length === 0) {
    return {
      positions: [],
      color: colorValue,
      alpha,
    };
  }

  const capacity = meshField.density * Math.max(0, meshField.density - 1) * 12;
  let positions = geometryState?.meshPositions;
  if (!positions || positions.length !== capacity) {
    positions = new Float32Array(capacity);
    if (geometryState) {
      geometryState.meshPositions = positions;
    }
  }
  let writeIndex = 0;

  for (let row = 0; row < meshField.density; row += 1) {
    for (let col = 0; col < meshField.density; col += 1) {
      const index = row * meshField.density + col;
      const point = meshField.points[index];
      if (!point) {
        continue;
      }

      if (col + 1 < meshField.density) {
        const next = meshField.points[index + 1];
        if (next) {
          positions[writeIndex] = point.x;
          positions[writeIndex + 1] = point.y;
          positions[writeIndex + 2] = -0.25;
          positions[writeIndex + 3] = next.x;
          positions[writeIndex + 4] = next.y;
          positions[writeIndex + 5] = -0.25;
          writeIndex += 6;
        }
      }

      if (row + 1 < meshField.density) {
        const next = meshField.points[index + meshField.density];
        if (next) {
          positions[writeIndex] = point.x;
          positions[writeIndex + 1] = point.y;
          positions[writeIndex + 2] = -0.25;
          positions[writeIndex + 3] = next.x;
          positions[writeIndex + 4] = next.y;
          positions[writeIndex + 5] = -0.25;
          writeIndex += 6;
        }
      }
    }
  }

  return {
    positions:
      writeIndex === capacity ? positions : positions.subarray(0, writeIndex),
    color: colorValue,
    alpha,
  };
}

function getProceduralMeshFieldVisual({
  state,
  meshField,
}: {
  state: MutableState;
  meshField: MeshField;
}): MilkdropProceduralMeshFieldVisual | null {
  if (!meshField.signals) {
    return null;
  }

  return {
    density: meshField.density,
    program: meshField.program,
    signals: meshField.signals,
    registers: collectPerFrameFieldRegisters(state, meshField.program),
    ...buildProceduralFieldTransform(state),
  };
}

/** Copies only the frame-constant registers the lowered program reads
 * (`registerInputs`), keeping this per-frame path free of a fixed 32-key
 * copy for programs that read few or none. */
function collectPerFrameFieldRegisters(
  state: MutableState,
  program: { registerInputs?: readonly string[] } | null | undefined,
): MilkdropProceduralMeshFieldVisual['registers'] {
  const inputs = program?.registerInputs;
  if (!inputs || inputs.length === 0) {
    return undefined;
  }
  const registers: Record<string, number> = {};
  for (const name of inputs) {
    registers[name] = state[name] ?? 0;
  }
  return registers;
}

function getProceduralMotionVectorFieldVisual({
  state,
  preset,
  meshField,
  proceduralMotionVectorPlan,
}: {
  state: MutableState;
  preset: MilkdropCompiledPreset;
  meshField: MeshField;
  proceduralMotionVectorPlan: MilkdropProceduralMotionVectorDescriptorPlan | null;
}): MilkdropProceduralMotionVectorFieldVisual | null {
  if (!meshField.signals || !proceduralMotionVectorPlan) {
    return null;
  }

  const motionVectorContext = getMotionVectorDescriptorContext({
    state,
    preset,
  });
  if (!motionVectorContext) {
    return null;
  }

  const legacyLength = Math.max(0, state.mv_l ?? 0);
  const legacyCellScale =
    Math.min(
      2 / Math.max(motionVectorContext.countX, 1),
      2 / Math.max(motionVectorContext.countY, 1),
    ) * 0.625;

  return {
    countX: motionVectorContext.countX,
    countY: motionVectorContext.countY,
    sourceOffsetX: motionVectorContext.legacyControls
      ? clamp(state.mv_dx ?? 0, -1, 1)
      : 0,
    sourceOffsetY: motionVectorContext.legacyControls
      ? clamp(state.mv_dy ?? 0, -1, 1)
      : 0,
    explicitLength:
      legacyLength <= 1 ? legacyLength : legacyLength * legacyCellScale,
    legacyControls: motionVectorContext.legacyControls,
    program: proceduralMotionVectorPlan.fieldProgram,
    signals: meshField.signals,
    registers: collectPerFrameFieldRegisters(
      state,
      proceduralMotionVectorPlan.fieldProgram,
    ),
    density: meshField.density,
    tint: color(
      state.mv_r ?? 1,
      state.mv_g ?? 1,
      state.mv_b ?? 1,
      state.mv_a ?? 0.35,
    ),
    alpha: clamp(
      state.mv_a ?? 0.35,
      motionVectorContext.legacyControls ? 0 : 0.02,
      1,
    ),
    ...buildProceduralFieldTransform(state),
  };
}

export function buildGpuGeometryHints({
  state,
  preset,
  meshField,
  trailWaves,
  signals,
  detailScale,
  proceduralMotionVectorPlan,
}: {
  state: MutableState;
  preset: MilkdropCompiledPreset;
  meshField: MeshField;
  trailWaves: import('../types').MilkdropProceduralWaveVisual[];
  signals: MilkdropRuntimeSignals;
  detailScale: number;
  proceduralMotionVectorPlan: MilkdropProceduralMotionVectorDescriptorPlan | null;
}): MilkdropGpuGeometryHints & {
  particleField: MilkdropParticleFieldVisual;
} {
  return {
    mainWave: null,
    trailWaves,
    customWaves: [],
    meshField: getProceduralMeshFieldVisual({ state, meshField }),
    particleField: buildParticleFieldVisual({
      state,
      meshField,
      signals,
      detailScale,
    }),
    motionVectorField: getProceduralMotionVectorFieldVisual({
      state,
      preset,
      meshField,
      proceduralMotionVectorPlan,
    }),
  };
}

// Above this cell count, motion vectors sample the per-pixel program on a
// coarse grid and bilinear-interpolate the rest. The warp mapping is smooth
// (zoom/rot/warp fields), so interpolation is visually indistinguishable for
// indicator vectors, while a dense authored grid (64x48 = 3072 cells) drops
// to at most 17x13 = 221 program runs per frame.
const MOTION_VECTOR_INTERPOLATION_THRESHOLD = 288;
const MOTION_VECTOR_EVAL_COLUMNS = 17;
const MOTION_VECTOR_EVAL_ROWS = 13;
// Reused across frames; the VM is single-threaded and buildMotionVectors is
// not reentrant. Layout: [x0, y0, x1, y1, ...] row-major over the eval grid.
let motionVectorEvalScratch = new Float32Array(0);

/**
 * The warp mesh, in the form the feedback pass draws it.
 *
 * MilkDrop warps the previous frame by drawing it onto this grid: each vertex
 * sits at its *transformed* position and carries the *lattice* position as its
 * texture coordinate, so the image is stretched by whatever the per-frame and
 * per-pixel equations did. The alternative — a fullscreen quad that recomputes
 * the transform from uniforms — can only express what fits in those uniforms,
 * which is why per-pixel warps had no effect on WebGL at all.
 *
 * Buffers are reused across frames; only their contents change.
 */
const PER_PIXEL_WARP_TARGETS = new Set([
  'dx',
  'dy',
  'zoom',
  'zoomexp',
  'rot',
  'warp',
  'sx',
  'sy',
  'cx',
  'cy',
]);

/**
 * True when a preset's per-pixel code writes a warp variable — the only case
 * the uniform-driven warp cannot express, since it has one value per frame for
 * the whole screen.
 *
 * Everything else keeps the uniform path deliberately: it is what the passing
 * projectM references were measured against, and swapping a mesh under them
 * moved presets that already matched (glowsticks 0.43% -> 3.4%).
 */
export function presetNeedsWarpMesh(preset: MilkdropCompiledPreset): boolean {
  const statements = preset.ir.perPixelStatements;
  if (!statements || statements.length === 0) {
    return false;
  }
  return statements.some((statement) =>
    PER_PIXEL_WARP_TARGETS.has(statement.target.toLowerCase()),
  );
}

export function buildWarpField(
  meshField: MeshField,
  geometryState: GeometryBuilderState,
): MilkdropWarpFieldVisual | null {
  const density = meshField.density;
  if (density < 2 || meshField.points.length < density * density) {
    return null;
  }

  const vertexCount = density * density;
  let positions = geometryState.warpFieldPositions;
  let uvs = geometryState.warpFieldUvs;
  if (!positions || positions.length !== vertexCount * 2) {
    positions = new Float32Array(vertexCount * 2);
    uvs = new Float32Array(vertexCount * 2);
    geometryState.warpFieldPositions = positions;
    geometryState.warpFieldUvs = uvs;
    geometryState.warpFieldIndices = undefined;
  }
  const uvBuffer = uvs ?? new Float32Array(vertexCount * 2);

  for (let index = 0; index < vertexCount; index += 1) {
    const point = meshField.points[index];
    if (!point) {
      return null;
    }
    positions[index * 2] = point.x;
    positions[index * 2 + 1] = point.y;
    // Renderer space is [-1,1] with y up; texture space is [0,1] with v up,
    // matching how the feedback targets are sampled elsewhere.
    //
    // Vertices carry the transformed position and read from the lattice — a
    // scatter. MilkDrop gathers instead, and the gather variant was written
    // and measured here: it came out worse on the one preset class this path
    // serves (87.0% vs 82.9% against the projectM reference), so the scatter
    // stands until the gather's sign and aspect conventions are pinned down.
    uvBuffer[index * 2] = (point.sourceX + 1) * 0.5;
    uvBuffer[index * 2 + 1] = (point.sourceY + 1) * 0.5;
  }

  let indices = geometryState.warpFieldIndices;
  if (!indices) {
    const quadCount = (density - 1) * (density - 1);
    indices = new Uint32Array(quadCount * 6);
    let write = 0;
    for (let row = 0; row + 1 < density; row += 1) {
      for (let col = 0; col + 1 < density; col += 1) {
        const topLeft = row * density + col;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + density;
        const bottomRight = bottomLeft + 1;
        indices[write] = topLeft;
        indices[write + 1] = bottomLeft;
        indices[write + 2] = topRight;
        indices[write + 3] = topRight;
        indices[write + 4] = bottomLeft;
        indices[write + 5] = bottomRight;
        write += 6;
      }
    }
    geometryState.warpFieldIndices = indices;
  }

  return { density, positions, uvs: uvBuffer, indices };
}

export function buildMotionVectors({
  state,
  preset,
  signals,
  meshField,
  geometryState,
  runProgram,
  createEnv,
  proceduralMotionVectorPlan,
}: {
  state: MutableState;
  preset: MilkdropCompiledPreset;
  signals: MilkdropRuntimeSignals;
  meshField: MeshField;
  geometryState: GeometryBuilderState;
  runProgram: (
    block: MilkdropCompiledPreset['ir']['programs']['init'],
    env: MutableState,
    locals?: MutableState | null,
  ) => void;
  createEnv: (
    signals: MilkdropRuntimeSignals,
    extra?: Record<string, number>,
    options?: {
      reuseExtraAsEnv?: boolean;
    },
  ) => MutableState;
  proceduralMotionVectorPlan: MilkdropProceduralMotionVectorDescriptorPlan | null;
}): MilkdropMotionVectorVisual[] {
  const motionVectorContext = getMotionVectorDescriptorContext({
    state,
    preset,
  });
  if (!motionVectorContext) {
    geometryState.lastMotionVectorField = null;
    return [];
  }

  const historyBuffers = geometryState.motionVectorHistoryBuffers;
  if (proceduralMotionVectorPlan && meshField.signals) {
    geometryState.lastMotionVectorField = null;
    return [];
  }

  const {
    legacyControls: hasLegacyMotionVectorControls,
    countX,
    countY,
  } = motionVectorContext;
  const colorValue = color(
    state.mv_r ?? 1,
    state.mv_g ?? 1,
    state.mv_b ?? 1,
    state.mv_a ?? 0.35,
  );
  const alpha = clamp(
    state.mv_a ?? 0.35,
    hasLegacyMotionVectorControls ? 0 : 0.02,
    1,
  );
  // Classic presets park a dense grid (mv_x=64;mv_y=48) with mv_a=0 to hide
  // motion vectors; every cell still costs a per-pixel program run. Fully
  // transparent vectors can never be seen, so skip the whole grid. mv_a is a
  // frame variable — if a preset later raises it, vectors resume next frame
  // (history restarts, matching the from-scratch case).
  if (alpha <= 0.003) {
    geometryState.lastMotionVectorField = null;
    return [];
  }
  const nextVisualFrameIndex = (geometryState.motionVectorFrameIndex ^ 1) as
    | 0
    | 1;
  const vectors = geometryState.motionVectorVisualFrames[nextVisualFrameIndex];
  const nextBufferIndex = (geometryState.motionVectorHistoryBufferIndex ^ 1) as
    | 0
    | 1;
  const nextHistoryPoints = historyBuffers[nextBufferIndex];
  nextHistoryPoints.length = countX * countY;
  const previousField = geometryState.lastMotionVectorField;
  const hasPerPixelPrograms = preset.ir.programs.perPixel.statements.length > 0;
  const legacyOffsetX = clamp(state.mv_dx ?? 0, -1, 1);
  const legacyOffsetY = clamp(state.mv_dy ?? 0, -1, 1);
  const legacyLength = Math.max(0, state.mv_l ?? 0);
  const legacyCellScale =
    Math.min(2 / Math.max(countX, 1), 2 / Math.max(countY, 1)) * 0.625;
  const explicitLegacyMagnitude =
    legacyLength <= 1 ? legacyLength : legacyLength * legacyCellScale;
  let vectorCount = 0;

  const aspectRatio = signals.aspect ?? 1;
  const aspectX = aspectRatio < 1 ? aspectRatio : 1;
  const aspectY = aspectRatio > 1 ? 1 / aspectRatio : 1;

  // Motion-vector sample points CAN repeat (legacy mv_dx/mv_dy offsets clamp
  // several columns onto +/-1) and can coincide with mesh-lattice points. They
  // are still recomputed each time, matching MilkDrop, which evaluates every
  // vector independently. A memo keyed on quantised coordinates used to sit
  // here; it returned a NEIGHBOUR's transform for points closer together than
  // the quantisation step (~4.9e-4), misplacing ~4 vectors per frame for a
  // 0.35% hit rate.
  const transformFrame = createMeshTransformFrame({
    signals,
    state,
    preset,
    geometryState,
    runProgram,
    createEnv,
    aspectX,
    aspectY,
  });

  const interpolated = countX * countY > MOTION_VECTOR_INTERPOLATION_THRESHOLD;
  const evalColumns = interpolated
    ? Math.min(countX, MOTION_VECTOR_EVAL_COLUMNS)
    : 0;
  const evalRows = interpolated ? Math.min(countY, MOTION_VECTOR_EVAL_ROWS) : 0;
  if (interpolated) {
    if (motionVectorEvalScratch.length < evalColumns * evalRows * 2) {
      motionVectorEvalScratch = new Float32Array(evalColumns * evalRows * 2);
    }
    for (let row = 0; row < evalRows; row += 1) {
      for (let col = 0; col < evalColumns; col += 1) {
        const point = transformMeshPoint(
          transformFrame,
          (col / (evalColumns - 1)) * 2 - 1,
          (row / (evalRows - 1)) * 2 - 1,
        );
        const offset = (row * evalColumns + col) * 2;
        motionVectorEvalScratch[offset] = point.x;
        motionVectorEvalScratch[offset + 1] = point.y;
      }
    }
  }

  let currentPointX = 0;
  let currentPointY = 0;
  for (let row = 0; row < countY; row += 1) {
    for (let col = 0; col < countX; col += 1) {
      const sourceBaseX = countX === 1 ? 0 : (col / (countX - 1)) * 2 - 1;
      const sourceBaseY = countY === 1 ? 0 : (row / (countY - 1)) * 2 - 1;
      const sourceX = hasLegacyMotionVectorControls
        ? clamp(sourceBaseX + legacyOffsetX, -1, 1)
        : sourceBaseX;
      const sourceY = hasLegacyMotionVectorControls
        ? clamp(sourceBaseY + legacyOffsetY, -1, 1)
        : sourceBaseY;
      const index = row * countX + col;
      if (interpolated) {
        // Bilinear sample of the coarse transformed grid at (sourceX, sourceY).
        const u = clamp(
          ((sourceX + 1) / 2) * (evalColumns - 1),
          0,
          evalColumns - 1,
        );
        const v = clamp(((sourceY + 1) / 2) * (evalRows - 1), 0, evalRows - 1);
        const col0 = Math.min(Math.floor(u), evalColumns - 2);
        const row0 = Math.min(Math.floor(v), evalRows - 2);
        const fu = u - col0;
        const fv = v - row0;
        const i00 = (row0 * evalColumns + col0) * 2;
        const i10 = i00 + 2;
        const i01 = i00 + evalColumns * 2;
        const i11 = i01 + 2;
        const top =
          motionVectorEvalScratch[i00] * (1 - fu) +
          motionVectorEvalScratch[i10] * fu;
        const bottom =
          motionVectorEvalScratch[i01] * (1 - fu) +
          motionVectorEvalScratch[i11] * fu;
        currentPointX = top * (1 - fv) + bottom * fv;
        const topY =
          motionVectorEvalScratch[i00 + 1] * (1 - fu) +
          motionVectorEvalScratch[i10 + 1] * fu;
        const bottomY =
          motionVectorEvalScratch[i01 + 1] * (1 - fu) +
          motionVectorEvalScratch[i11 + 1] * fu;
        currentPointY = topY * (1 - fv) + bottomY * fv;
      } else {
        const currentPoint = transformMeshPoint(
          transformFrame,
          sourceX,
          sourceY,
        );
        currentPointX = currentPoint.x;
        currentPointY = currentPoint.y;
      }
      const pointEntry: MotionVectorHistoryPoint = nextHistoryPoints[index] ?? {
        sourceX: 0,
        sourceY: 0,
        x: 0,
        y: 0,
      };
      pointEntry.sourceX = sourceX;
      pointEntry.sourceY = sourceY;
      pointEntry.x = currentPointX;
      pointEntry.y = currentPointY;
      nextHistoryPoints[index] = pointEntry;
      const previous = previousField?.points[index] ?? {
        sourceX,
        sourceY,
        x: sourceX,
        y: sourceY,
      };
      const sourceDx = currentPointX - sourceX;
      const sourceDy = currentPointY - sourceY;
      const historyDx = hasPerPixelPrograms
        ? (currentPointX - previous.x) * 1.1
        : 0;
      const historyDy = hasPerPixelPrograms
        ? (currentPointY - previous.y) * 1.1
        : 0;
      const baseDx = sourceDx + historyDx;
      const baseDy = sourceDy + historyDy;
      const baseMagnitude = Math.hypot(baseDx, baseDy);
      let dx = baseDx;
      let dy = baseDy;

      if (hasLegacyMotionVectorControls && explicitLegacyMagnitude > 0.0001) {
        if (baseMagnitude < 0.0001) {
          continue;
        }
        const normalizedX = baseDx / baseMagnitude;
        const normalizedY = baseDy / baseMagnitude;
        dx = normalizedX * explicitLegacyMagnitude;
        dy = normalizedY * explicitLegacyMagnitude;
      }

      const magnitude = Math.hypot(dx, dy);
      if (magnitude < 0.002) {
        continue;
      }
      const vector = vectors[vectorCount] ?? {
        positions: [0, 0, 0, 0, 0, 0],
        color: colorValue,
        alpha: 0,
        thickness: 1,
        additive: false,
      };
      const positions = vector.positions;
      positions[0] = currentPointX - dx * 0.45;
      positions[1] = currentPointY - dy * 0.45;
      positions[2] = 0.18;
      positions[3] = currentPointX + dx;
      positions[4] = currentPointY + dy;
      positions[5] = 0.18;
      vector.color = colorValue;
      vector.alpha = alpha;
      vector.thickness = 1.0;
      vector.additive = false;
      vectors[vectorCount] = vector;
      vectorCount += 1;
    }
  }

  vectors.length = vectorCount;
  geometryState.lastMotionVectorField = {
    countX,
    countY,
    points: nextHistoryPoints,
  };
  geometryState.motionVectorFrameIndex = nextVisualFrameIndex;
  geometryState.motionVectorHistoryBufferIndex = nextBufferIndex;
  return vectors;
}
