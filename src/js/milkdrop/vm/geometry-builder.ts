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

function getTransformCacheKey(x: number, y: number) {
  const quantizedX = Math.round((x + 1) * 2048);
  const quantizedY = Math.round((y + 1) * 2048);
  return quantizedX * 4096 + quantizedY;
}

export function resetFrameTransformCache(geometryState: GeometryBuilderState) {
  geometryState.frameTransformCache.clear();
  geometryState.transformCachePoolIndex = 0;
}

function getTransformCacheEntry(geometryState: GeometryBuilderState): {
  x: number;
  y: number;
} {
  const pool = geometryState.transformCachePool;
  const index = geometryState.transformCachePoolIndex;
  let entry = pool[index];
  if (!entry) {
    entry = { x: 0, y: 0 };
    pool[index] = entry;
  }
  geometryState.transformCachePoolIndex = index + 1;
  return entry;
}

function transformMeshPoint({
  signals,
  gridX,
  gridY,
  state,
  preset,
  geometryState,
  runProgram,
  createEnv,
  scratch,
  aspectX,
  aspectY,
}: {
  signals: MilkdropRuntimeSignals;
  gridX: number;
  gridY: number;
  state: MutableState;
  preset: MilkdropCompiledPreset;
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
  scratch: MutableState;
  aspectX?: number;
  aspectY?: number;
}) {
  const cacheKey = getTransformCacheKey(gridX, gridY);
  const cached = geometryState.frameTransformCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const local = scratch;
  const aspectRatio = signals.aspect ?? 1;
  // MilkDrop shrinks the minor axis (values <= 1); mirrors the shader-uniform
  // convention in feedback-manager-shared.ts's syncMilkdropShaderBuiltinUniforms.
  const resolvedAspectX = aspectX ?? (aspectRatio < 1 ? aspectRatio : 1);
  const resolvedAspectY = aspectY ?? (aspectRatio > 1 ? 1 / aspectRatio : 1);

  // Convert from renderer space [-1,1] to MilkDrop space [0,1]
  // x = 0 is left, x = 1 is right (with aspect correction)
  // y = 0 is top, y = 1 is bottom (with y-flip and aspect correction)
  local.x = gridX * 0.5 * resolvedAspectX + 0.5;
  local.y = -gridY * 0.5 * resolvedAspectY + 0.5;

  const aspectGridX = gridX * resolvedAspectX;
  const aspectGridY = gridY * resolvedAspectY;
  local.rad = Math.sqrt(aspectGridX * aspectGridX + aspectGridY * aspectGridY);
  local.ang = Math.atan2(aspectGridY, aspectGridX);
  local.zoom = state.zoom ?? 1;
  local.zoomexp = state.zoomexp ?? 1;
  local.rot = state.rot ?? 0;
  local.warp = state.warp ?? 0;
  local.cx = state.cx ?? 0.5;
  local.cy = state.cy ?? 0.5;
  local.sx = state.sx ?? 1;
  local.sy = state.sy ?? 1;
  local.dx = state.dx ?? 0;
  local.dy = state.dy ?? 0;

  // Seed per-pixel locals with q1-q32 so per-pixel writes don't leak to
  // the shared register bank and corrupt the next frame's per-frame pool
  const env = createEnv(signals, local, { reuseExtraAsEnv: true });
  for (let i = 1; i <= 32; i += 1) {
    const key = `q${i}`;
    if (!(key in local)) {
      local[key] = (env as Record<string, number>)[key] ?? 0;
    }
  }

  runProgram(preset.ir.programs.perPixel, env, local);

  // Per-pixel code reads (and may write) x/y in MilkDrop [0,1] space; the
  // transform math below runs in renderer [-1,1] space, so invert the mapping.
  const rendererX = (((local.x ?? 0.5) - 0.5) * 2) / resolvedAspectX;
  const rendererY = -((((local.y ?? 0.5) - 0.5) * 2) / resolvedAspectY);

  const warpAnimSpeed = clamp(state.warpanimspeed ?? 1, 0, 4);
  const centerX = normalizeTransformCenter(local.cx ?? 0.5);
  const centerY = normalizeTransformCenterY(local.cy ?? 0.5);
  const scaleX = local.sx ?? 1;
  const scaleY = local.sy ?? 1;
  const translateX = local.dx ?? 0;
  const translateY = local.dy ?? 0;

  const cosRot = Math.cos(local.rot);
  const sinRot = Math.sin(local.rot);
  const relX = rendererX - centerX;
  const relY = rendererY - centerY;
  const rx = relX * cosRot - relY * sinRot + centerX;
  const ry = relX * sinRot + relY * cosRot + centerY;

  const zoomRadius = Math.hypot(rx - centerX, ry - centerY);
  const radiusNormalized = clamp(zoomRadius / Math.SQRT2, 0, 1);
  const zoomExponent = Math.max(local.zoomexp ?? 1, 0.0001);
  const zoom = Math.max(local.zoom ?? 1, 0);
  // Authored presets legitimately use extreme pairs (orbasonic ships
  // zoom=100 with zoomexp=100); unclamped, zoom^(zoomexp^(2r-1)) overflows
  // float32 at the edges and NaN-poisons the warp into a black frame.
  // MilkDrop's own math saturates instead of exploding, so bound the scale.
  const zoomScale = clamp(
    zoom === 0 ? 0 : zoom ** (zoomExponent ** (radiusNormalized * 2 - 1)),
    0.02,
    50,
  );
  const zx = centerX + (rx - centerX) * zoomScale;
  const zy = centerY + (ry - centerY) * zoomScale;

  const ripple =
    Math.sin(local.rad * 8.0 + signals.time * (0.35 + warpAnimSpeed)) *
    local.warp *
    0.1;
  const rippleAngle = Math.atan2(zy - centerY, zx - centerX);
  const wx = zx + Math.cos(rippleAngle) * ripple;
  const wy = zy + Math.sin(rippleAngle) * ripple;

  const tx = wx + translateX;
  const ty = wy + translateY;

  const transformed = getTransformCacheEntry(geometryState);
  transformed.x = (tx - centerX) * scaleX + centerX;
  transformed.y = (ty - centerY) * scaleY + centerY;
  geometryState.frameTransformCache.set(cacheKey, transformed);
  return transformed;
}

export function getMeshDensity(state: MutableState, detailScale: number) {
  // 96 caps the per-frame CPU warp at ~9.2k vertices; only reachable when the
  // detail scale (gated on backend + quality tier) climbs past ~3x.
  return clamp(Math.round((state.mesh_density ?? 16) * detailScale), 8, 96);
}

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
  const declaresLegacyField = preset.ast.fields.some((field) => {
    const key = normalizeProgramAssignmentTarget(field.key);
    return key === 'mv_dx' || key === 'mv_dy' || key === 'mv_l';
  });
  const legacyControls =
    declaresLegacyField ||
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

  // Clear per-pixel scratch each frame to prevent accumulation across frames
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

  for (let row = 0; row < density; row += 1) {
    for (let col = 0; col < density; col += 1) {
      const x = (col / Math.max(1, density - 1)) * 2 - 1;
      const y = (row / Math.max(1, density - 1)) * 2 - 1;
      const point = transformMeshPoint({
        signals,
        gridX: x,
        gridY: y,
        state,
        preset,
        geometryState,
        runProgram,
        createEnv,
        scratch: geometryState.pointScratch,
        aspectX,
        aspectY,
      });
      const pointIndex = row * density + col;
      const pointEntry: MeshFieldPoint = points[pointIndex] ?? {
        sourceX: 0,
        sourceY: 0,
        x: 0,
        y: 0,
      };
      pointEntry.sourceX = x;
      pointEntry.sourceY = y;
      pointEntry.x = point.x;
      pointEntry.y = point.y;
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
    ...buildProceduralFieldTransform(state),
  };
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
        const point = transformMeshPoint({
          signals,
          gridX: (col / (evalColumns - 1)) * 2 - 1,
          gridY: (row / (evalRows - 1)) * 2 - 1,
          state,
          preset,
          geometryState,
          runProgram,
          createEnv,
          scratch: geometryState.pointScratch,
          aspectX,
          aspectY,
        });
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
        const currentPoint = transformMeshPoint({
          signals,
          gridX: sourceX,
          gridY: sourceY,
          state,
          preset,
          geometryState,
          runProgram,
          createEnv,
          scratch: geometryState.pointScratch,
          aspectX,
          aspectY,
        });
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
