import { getDevicePerformanceProfile } from '../../core/device-profile.ts';
import { isMobileDevice } from '../../utils/device-detect';
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
  const densityInfluence = clamp(detailScale, 0.5, 1.65);
  const rawCount = Math.round(
    Math.sqrt(pointCount) * (4.5 + meshDensity * 0.22) * densityInfluence,
  );
  return clamp(rawCount, 24, 320);
}

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
    return {
      enabled: false,
      instanceCount: 0,
      size: 0,
      alpha: 0,
      motionScale: 0,
      seed: 0,
      anchorSource: 'mesh-field',
    };
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
}) {
  const cacheKey = getTransformCacheKey(gridX, gridY);
  const cached = geometryState.frameTransformCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const local = scratch;
  local.x = gridX;
  local.y = gridY;
  local.rad = Math.sqrt(gridX * gridX + gridY * gridY);
  local.ang = Math.atan2(gridY, gridX);
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
  runProgram(
    preset.ir.programs.perPixel,
    createEnv(signals, local, { reuseExtraAsEnv: true }),
    local,
  );

  const warpAnimSpeed = clamp(state.warpanimspeed ?? 1, 0, 4);
  const angle = local.ang + local.rot;
  const centerX = normalizeTransformCenter(local.cx ?? 0.5);
  const centerY = normalizeTransformCenter(local.cy ?? 0.5);
  const scaleX = local.sx ?? 1;
  const scaleY = local.sy ?? 1;
  const translateX = (local.dx ?? 0) * 2;
  const translateY = (local.dy ?? 0) * 2;
  const transformedX = (local.x - centerX) * scaleX + centerX + translateX;
  const transformedY = (local.y - centerY) * scaleY + centerY + translateY;
  const ripple =
    Math.sin(
      local.rad * 12 +
        signals.time * (0.6 + signals.trebleAtt) * (0.35 + warpAnimSpeed),
    ) *
    local.warp *
    0.08;
  const radiusNormalized = clamp(local.rad / Math.SQRT2, 0, 1);
  const zoomExponent = Math.max(local.zoomexp ?? 1, 0.0001);
  const zoomScale =
    Math.max(local.zoom ?? 1, 0.0001) **
    (zoomExponent ** (radiusNormalized * 2 - 1));
  const px = (transformedX + Math.cos(angle * 3) * ripple) * zoomScale;
  const py = (transformedY + Math.sin(angle * 4) * ripple) * zoomScale;
  const cos = Math.cos(local.rot);
  const sin = Math.sin(local.rot);
  const transformed = {
    x: px * cos - py * sin,
    y: px * sin + py * cos,
  };
  geometryState.frameTransformCache.set(cacheKey, transformed);
  return transformed;
}

function getMeshDensity(state: MutableState, detailScale: number) {
  return clamp(Math.round((state.mesh_density ?? 16) * detailScale), 8, 28);
}

export function getMotionVectorDescriptorContext({
  state,
  preset,
}: {
  state: MutableState;
  preset: MilkdropCompiledPreset;
}): MotionVectorDescriptorContext | null {
  const legacyControls =
    Math.abs(state.mv_dx ?? 0) > 0.0001 ||
    Math.abs(state.mv_dy ?? 0) > 0.0001 ||
    Math.abs(state.mv_l ?? 0) > 0.0001 ||
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

export function buildProceduralFieldTransform(state: MutableState) {
  return {
    zoom: Math.max(state.zoom ?? 1, 0.0001),
    zoomExponent: Math.max(state.zoomexp ?? 1, 0.0001),
    rotation: state.rot ?? 0,
    warp: state.warp ?? 0,
    warpAnimSpeed: clamp(state.warpanimspeed ?? 1, 0, 4),
    centerX: normalizeTransformCenter(state.cx ?? 0.5),
    centerY: normalizeTransformCenter(state.cy ?? 0.5),
    scaleX: state.sx ?? 1,
    scaleY: state.sy ?? 1,
    translateX: (state.dx ?? 0) * 2,
    translateY: (state.dy ?? 0) * 2,
  };
}

export function buildProceduralFieldSignals(
  signals: MilkdropRuntimeSignals,
): MilkdropGpuFieldSignalInputs {
  return {
    time: signals.time,
    frame: signals.frame,
    fps: signals.fps,
    bass: signals.bass,
    mid: signals.mid,
    mids: signals.mids,
    treble: signals.treble,
    bassAtt: signals.bassAtt,
    midAtt: signals.mid_att,
    midsAtt: signals.midsAtt,
    trebleAtt: signals.trebleAtt,
    beat: signals.beat,
    beatPulse: signals.beatPulse,
    rms: signals.rms,
    vol: signals.vol,
    music: signals.music,
    weightedEnergy: signals.weightedEnergy,
  };
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
}: {
  state: MutableState;
  meshField: MeshField;
}): MilkdropMeshVisual {
  const colorValue = color(
    state.mesh_r ?? 0.4,
    state.mesh_g ?? 0.6,
    state.mesh_b ?? 1,
    state.mesh_alpha ?? 0.2,
  );
  const alpha = clamp(state.mesh_alpha ?? 0.2, 0.02, 0.9);

  if (meshField.points.length === 0) {
    return {
      positions: [],
      color: colorValue,
      alpha,
    };
  }

  const positions = new Array<number>(
    meshField.density * Math.max(0, meshField.density - 1) * 12,
  );
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
      writeIndex === positions.length
        ? positions
        : positions.slice(0, writeIndex),
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
    trailWaves: trailWaves.slice(),
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
      });
      const pointEntry: MotionVectorHistoryPoint = nextHistoryPoints[index] ?? {
        sourceX: 0,
        sourceY: 0,
        x: 0,
        y: 0,
      };
      pointEntry.sourceX = sourceX;
      pointEntry.sourceY = sourceY;
      pointEntry.x = currentPoint.x;
      pointEntry.y = currentPoint.y;
      nextHistoryPoints[index] = pointEntry;
      const previous = previousField?.points[index] ?? {
        sourceX,
        sourceY,
        x: sourceX,
        y: sourceY,
      };
      const sourceDx = (currentPoint.x - sourceX) * 1.35;
      const sourceDy = (currentPoint.y - sourceY) * 1.35;
      const historyDx = hasPerPixelPrograms
        ? (currentPoint.x - previous.x) * 1.1
        : 0;
      const historyDy = hasPerPixelPrograms
        ? (currentPoint.y - previous.y) * 1.1
        : 0;
      const baseDx = sourceDx + historyDx;
      const baseDy = sourceDy + historyDy;
      const baseMagnitude = Math.hypot(baseDx, baseDy);
      let dx = clamp(baseDx, -0.24, 0.24);
      let dy = clamp(baseDy, -0.24, 0.24);

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
      positions[0] = currentPoint.x - dx * 0.45;
      positions[1] = currentPoint.y - dy * 0.45;
      positions[2] = 0.18;
      positions[3] = currentPoint.x + dx;
      positions[4] = currentPoint.y + dy;
      positions[5] = 0.18;
      vector.color = colorValue;
      vector.alpha = hasLegacyMotionVectorControls
        ? alpha
        : clamp(alpha * (0.75 + magnitude * 2.2), 0.02, 1);
      vector.thickness = hasLegacyMotionVectorControls
        ? clamp(1 + magnitude * 10, 1, 4)
        : clamp(1 + magnitude * 18, 1, 4);
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
