import type {
  MilkdropCompiledPreset,
  MilkdropGpuFieldSignalInputs,
  MilkdropGpuGeometryHints,
  MilkdropMeshVisual,
  MilkdropMotionVectorVisual,
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
  MAX_MOTION_VECTOR_COLUMNS,
  MAX_MOTION_VECTOR_ROWS,
  type MeshField,
  type MotionVectorDescriptorContext,
  type MotionVectorHistoryPoint,
  type MutableState,
  normalizeTransformCenter,
} from './shared';

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
  ) => MutableState;
}) {
  const cacheKey = getTransformCacheKey(gridX, gridY);
  const cached = geometryState.frameTransformCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const local: MutableState = {
    x: gridX,
    y: gridY,
    rad: Math.sqrt(gridX * gridX + gridY * gridY),
    ang: Math.atan2(gridY, gridX),
    zoom: state.zoom ?? 1,
    zoomexp: state.zoomexp ?? 1,
    rot: state.rot ?? 0,
    warp: state.warp ?? 0,
    cx: state.cx ?? 0.5,
    cy: state.cy ?? 0.5,
    sx: state.sx ?? 1,
    sy: state.sy ?? 1,
    dx: state.dx ?? 0,
    dy: state.dy ?? 0,
  };
  runProgram(preset.ir.programs.perPixel, createEnv(signals, local), local);

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
  ) => MutableState;
  proceduralMeshPlan: MilkdropProceduralMeshDescriptorPlan | null;
}): MeshField {
  const density = getMeshDensity(state, detailScale);
  if (proceduralMeshPlan) {
    return {
      density,
      points: [],
      program: proceduralMeshPlan.fieldProgram,
      signals: buildProceduralFieldSignals(signals),
    };
  }

  const points = new Array<MeshField['points'][number]>(density * density);

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
      });
      points[row * density + col] = {
        sourceX: x,
        sourceY: y,
        x: point.x,
        y: point.y,
      };
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
    positions: positions.slice(0, writeIndex),
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
    ...buildProceduralFieldTransform(state),
  };
}

export function buildGpuGeometryHints({
  state,
  preset,
  meshField,
  trailWaves,
  proceduralMotionVectorPlan,
}: {
  state: MutableState;
  preset: MilkdropCompiledPreset;
  meshField: MeshField;
  trailWaves: import('../types').MilkdropProceduralWaveVisual[];
  proceduralMotionVectorPlan: MilkdropProceduralMotionVectorDescriptorPlan | null;
}): MilkdropGpuGeometryHints {
  return {
    mainWave: null,
    trailWaves: trailWaves.slice(),
    customWaves: [],
    meshField: getProceduralMeshFieldVisual({ state, meshField }),
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
  const vectors: MilkdropMotionVectorVisual[] = [];
  const nextHistoryPoints = new Array<MotionVectorHistoryPoint>(
    countX * countY,
  );
  const previousField = geometryState.lastMotionVectorField;
  const hasPerPixelPrograms = preset.ir.programs.perPixel.statements.length > 0;
  const legacyOffsetX = clamp(state.mv_dx ?? 0, -1, 1);
  const legacyOffsetY = clamp(state.mv_dy ?? 0, -1, 1);
  const legacyLength = Math.max(0, state.mv_l ?? 0);
  const legacyCellScale =
    Math.min(2 / Math.max(countX, 1), 2 / Math.max(countY, 1)) * 0.625;
  const explicitLegacyMagnitude =
    legacyLength <= 1 ? legacyLength : legacyLength * legacyCellScale;

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
      });
      nextHistoryPoints[index] = {
        sourceX,
        sourceY,
        x: currentPoint.x,
        y: currentPoint.y,
      };
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
      vectors.push({
        positions: [
          currentPoint.x - dx * 0.45,
          currentPoint.y - dy * 0.45,
          0.18,
          currentPoint.x + dx,
          currentPoint.y + dy,
          0.18,
        ],
        color: colorValue,
        alpha: hasLegacyMotionVectorControls
          ? alpha
          : clamp(alpha * (0.75 + magnitude * 2.2), 0.02, 1),
        thickness: hasLegacyMotionVectorControls
          ? clamp(1 + magnitude * 10, 1, 4)
          : clamp(1 + magnitude * 18, 1, 4),
        additive: false,
      });
    }
  }

  geometryState.lastMotionVectorField = {
    countX,
    countY,
    points: nextHistoryPoints,
  };
  return vectors;
}
