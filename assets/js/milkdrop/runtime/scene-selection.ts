import type {
  MilkdropBorderVisual,
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropMeshVisual,
  MilkdropShapeVisual,
  MilkdropWaveVisual,
} from '../types.ts';

export type MilkdropScenePickKind =
  | 'shape'
  | 'custom-wave'
  | 'main-wave'
  | 'border'
  | 'mesh';

export type MilkdropScenePickResult = {
  kind: MilkdropScenePickKind;
  slotIndex: number | null;
  worldX: number;
  worldY: number;
  sourceFields: string[];
};

export type MilkdropScenePickDescription = {
  title: string;
  detail: string;
  fieldSummary: string;
};

export type MilkdropScenePointerPoint = {
  worldX: number;
  worldY: number;
};

export type MilkdropSceneDragModifiers = {
  shiftKey?: boolean;
  altKey?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toWorldPoint({
  clientX,
  clientY,
  viewportWidth,
  viewportHeight,
}: {
  clientX: number;
  clientY: number;
  viewportWidth: number;
  viewportHeight: number;
}): MilkdropScenePointerPoint {
  const safeWidth = Math.max(1, viewportWidth);
  const safeHeight = Math.max(1, viewportHeight);
  return {
    worldX: clamp((clientX / safeWidth) * 2 - 1, -1, 1),
    worldY: clamp(1 - (clientY / safeHeight) * 2, -1, 1),
  };
}

function parseShapeSlotIndex(key: string) {
  const match = /^shape_(\d+)$/u.exec(key);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getShapeSourceFields(index: number) {
  const prefix = `shape_${index}`;
  return [
    `${prefix}_enabled`,
    `${prefix}_sides`,
    `${prefix}_x`,
    `${prefix}_y`,
    `${prefix}_rad`,
    `${prefix}_ang`,
    `${prefix}_textured`,
    `${prefix}_tex_zoom`,
    `${prefix}_tex_ang`,
    `${prefix}_a`,
    `${prefix}_r`,
    `${prefix}_g`,
    `${prefix}_b`,
    `${prefix}_border_a`,
    `${prefix}_border_r`,
    `${prefix}_border_g`,
    `${prefix}_border_b`,
    `${prefix}_additive`,
    `${prefix}_thickoutline`,
  ];
}

function getCustomWaveSourceFields(index: number) {
  const prefix = `custom_wave_${index}`;
  return [
    `${prefix}_enabled`,
    `${prefix}_samples`,
    `${prefix}_spectrum`,
    `${prefix}_additive`,
    `${prefix}_usedots`,
    `${prefix}_scaling`,
    `${prefix}_smoothing`,
    `${prefix}_mystery`,
    `${prefix}_thick`,
    `${prefix}_x`,
    `${prefix}_y`,
    `${prefix}_r`,
    `${prefix}_g`,
    `${prefix}_b`,
    `${prefix}_a`,
  ];
}

function getBorderSourceFields(key: MilkdropBorderVisual['key']) {
  const prefix = key === 'outer' ? 'ob' : 'ib';
  return [
    `${prefix}_size`,
    `${prefix}_r`,
    `${prefix}_g`,
    `${prefix}_b`,
    `${prefix}_a`,
    `${prefix}_border`,
  ];
}

function getMeshSourceFields() {
  return ['mesh_density', 'mesh_alpha', 'mesh_r', 'mesh_g', 'mesh_b'];
}

function getMainWaveSourceFields() {
  return [
    'wave_mode',
    'wave_scale',
    'wave_smoothing',
    'wave_a',
    'wave_r',
    'wave_g',
    'wave_b',
    'wave_x',
    'wave_y',
    'wave_mystery',
    'wave_thick',
    'wave_additive',
    'wave_usedots',
    'wave_brighten',
  ];
}

function getPositionsAsPairs(positions: number[]) {
  const pairs: Array<{ x: number; y: number }> = [];
  for (let index = 0; index + 1 < positions.length; index += 3) {
    const x = positions[index];
    const y = positions[index + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    pairs.push({ x, y });
  }
  return pairs;
}

function distanceToSegment(
  point: MilkdropScenePointerPoint,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) {
    return Math.hypot(point.worldX - start.x, point.worldY - start.y);
  }

  const t = clamp(
    ((point.worldX - start.x) * segmentX +
      (point.worldY - start.y) * segmentY) /
      lengthSquared,
    0,
    1,
  );
  const projectionX = start.x + segmentX * t;
  const projectionY = start.y + segmentY * t;
  return Math.hypot(point.worldX - projectionX, point.worldY - projectionY);
}

function getPolylineDistance(
  point: MilkdropScenePointerPoint,
  positions: number[],
  closed = false,
) {
  const pairs = getPositionsAsPairs(positions);
  if (pairs.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < pairs.length - 1; index += 1) {
    bestDistance = Math.min(
      bestDistance,
      distanceToSegment(
        point,
        pairs[index] as { x: number; y: number },
        pairs[index + 1] as { x: number; y: number },
      ),
    );
  }

  if (closed) {
    bestDistance = Math.min(
      bestDistance,
      distanceToSegment(
        point,
        pairs[pairs.length - 1] as { x: number; y: number },
        pairs[0] as { x: number; y: number },
      ),
    );
  }

  return bestDistance;
}

function getBounds(positions: number[]) {
  const pairs = getPositionsAsPairs(positions);
  if (pairs.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of pairs) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

function pickShape({
  shapes,
  point,
}: {
  shapes: MilkdropShapeVisual[];
  point: MilkdropScenePointerPoint;
}): MilkdropScenePickResult | null {
  let best: { distance: number; result: MilkdropScenePickResult } | null = null;
  for (const [index, shape] of shapes.entries()) {
    const slotIndex = parseShapeSlotIndex(shape.key) ?? index + 1;
    const distance = Math.hypot(point.worldX - shape.x, point.worldY - shape.y);
    const threshold = Math.max(0.06, shape.radius * 1.15);
    if (distance > threshold) {
      continue;
    }

    const result: MilkdropScenePickResult = {
      kind: 'shape',
      slotIndex,
      worldX: point.worldX,
      worldY: point.worldY,
      sourceFields: getShapeSourceFields(slotIndex),
    };
    if (!best || distance < best.distance) {
      best = { distance, result };
    }
  }
  return best?.result ?? null;
}

function pickCustomWave({
  waves,
  point,
}: {
  waves: MilkdropWaveVisual[];
  point: MilkdropScenePointerPoint;
}): MilkdropScenePickResult | null {
  let best: { distance: number; result: MilkdropScenePickResult } | null = null;
  for (const [index, wave] of waves.entries()) {
    const distance = getPolylineDistance(point, wave.positions, wave.closed);
    const threshold = Math.max(0.06, wave.thickness * 0.02);
    if (distance > threshold) {
      continue;
    }

    const slotIndex = index + 1;
    const result: MilkdropScenePickResult = {
      kind: 'custom-wave',
      slotIndex,
      worldX: point.worldX,
      worldY: point.worldY,
      sourceFields: getCustomWaveSourceFields(slotIndex),
    };
    if (!best || distance < best.distance) {
      best = { distance, result };
    }
  }
  return best?.result ?? null;
}

function pickMainWave({
  wave,
  point,
}: {
  wave: MilkdropWaveVisual;
  point: MilkdropScenePointerPoint;
}): MilkdropScenePickResult | null {
  const distance = getPolylineDistance(point, wave.positions, wave.closed);
  const threshold = Math.max(0.06, wave.thickness * 0.018);
  if (distance > threshold) {
    return null;
  }

  return {
    kind: 'main-wave',
    slotIndex: 1,
    worldX: point.worldX,
    worldY: point.worldY,
    sourceFields: getMainWaveSourceFields(),
  };
}

function pickBorder({
  borders,
  point,
}: {
  borders: MilkdropBorderVisual[];
  point: MilkdropScenePointerPoint;
}): MilkdropScenePickResult | null {
  let best: { distance: number; result: MilkdropScenePickResult } | null = null;
  const edgeDistance = Math.min(
    1 - Math.abs(point.worldX),
    1 - Math.abs(point.worldY),
  );

  for (const border of borders) {
    const threshold = Math.max(0.04, border.size + 0.03);
    if (edgeDistance > threshold) {
      continue;
    }

    const result: MilkdropScenePickResult = {
      kind: 'border',
      slotIndex: border.key === 'outer' ? 0 : 1,
      worldX: point.worldX,
      worldY: point.worldY,
      sourceFields: getBorderSourceFields(border.key),
    };
    if (!best || edgeDistance < best.distance) {
      best = { distance: edgeDistance, result };
    }
  }

  return best?.result ?? null;
}

function pickMesh({
  mesh,
  point,
}: {
  mesh: MilkdropMeshVisual;
  point: MilkdropScenePointerPoint;
}): MilkdropScenePickResult | null {
  const bounds = getBounds(mesh.positions);
  if (!bounds) {
    return null;
  }

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const tolerance = Math.max(0.12, Math.min(width, height) * 0.18);
  const expandedBounds = {
    minX: bounds.minX - tolerance,
    minY: bounds.minY - tolerance,
    maxX: bounds.maxX + tolerance,
    maxY: bounds.maxY + tolerance,
  };
  const withinBounds =
    point.worldX >= expandedBounds.minX &&
    point.worldX <= expandedBounds.maxX &&
    point.worldY >= expandedBounds.minY &&
    point.worldY <= expandedBounds.maxY;

  if (!withinBounds) {
    return null;
  }

  return {
    kind: 'mesh',
    slotIndex: null,
    worldX: point.worldX,
    worldY: point.worldY,
    sourceFields: getMeshSourceFields(),
  };
}

export function resolveMilkdropScenePointerPoint(event: {
  clientX: number;
  clientY: number;
  viewportWidth: number;
  viewportHeight: number;
}) {
  return toWorldPoint(event);
}

export function getMilkdropScenePickResult({
  frameState,
  point,
}: {
  frameState: MilkdropFrameState;
  point: MilkdropScenePointerPoint;
}): MilkdropScenePickResult | null {
  return (
    pickShape({ shapes: frameState.shapes, point }) ??
    pickCustomWave({ waves: frameState.customWaves, point }) ??
    pickMainWave({ wave: frameState.mainWave, point }) ??
    pickBorder({ borders: frameState.borders, point }) ??
    pickMesh({ mesh: frameState.mesh, point })
  );
}

export function describeMilkdropScenePickResult(
  selection: MilkdropScenePickResult | null,
): MilkdropScenePickDescription {
  if (!selection) {
    return {
      title: 'No selection',
      detail: 'Click the scene to inspect a visual target.',
      fieldSummary: 'Shapes can be dragged. Other targets are inspect-only.',
    };
  }

  if (selection.kind === 'shape') {
    return {
      title: `Shape ${selection.slotIndex ?? '?'}`,
      detail:
        'Drag to move. Hold Shift to change radius. Hold Alt to change angle.',
      fieldSummary: selection.sourceFields.join(', '),
    };
  }

  if (selection.kind === 'custom-wave') {
    return {
      title: `Custom wave ${selection.slotIndex ?? '?'}`,
      detail: 'Inspect-only selection for the active custom wave.',
      fieldSummary: selection.sourceFields.join(', '),
    };
  }

  if (selection.kind === 'main-wave') {
    return {
      title: 'Main wave',
      detail: 'Inspect-only selection for the main waveform.',
      fieldSummary: selection.sourceFields.join(', '),
    };
  }

  if (selection.kind === 'border') {
    return {
      title: selection.slotIndex === 0 ? 'Outer border' : 'Inner border',
      detail: 'Inspect-only selection for the active border layer.',
      fieldSummary: selection.sourceFields.join(', '),
    };
  }

  return {
    title: 'Mesh field',
    detail: 'Inspect-only selection for the mesh surface.',
    fieldSummary: selection.sourceFields.join(', '),
  };
}

function getSelectionFieldMap(
  compiled: MilkdropCompiledPreset,
  selection: MilkdropScenePickResult,
) {
  const fields: Record<string, number> = {};
  const assignPrefix = (prefix: string) => {
    for (const [key, value] of Object.entries(compiled.ir.numericFields)) {
      if (key.startsWith(prefix) && typeof value === 'number') {
        fields[key] = value;
      }
    }
  };

  if (selection.kind === 'shape' && selection.slotIndex !== null) {
    assignPrefix(`shape_${selection.slotIndex}_`);
    const shape = compiled.ir.customShapes.find(
      (candidate) => candidate.index === selection.slotIndex,
    );
    if (shape) {
      Object.assign(fields, shape.fields);
    }
    return fields;
  }

  if (selection.kind === 'custom-wave' && selection.slotIndex !== null) {
    assignPrefix(`custom_wave_${selection.slotIndex}_`);
    const wave = compiled.ir.customWaves.find(
      (candidate) => candidate.index === selection.slotIndex,
    );
    if (wave) {
      Object.assign(fields, wave.fields);
    }
    return fields;
  }

  if (selection.kind === 'main-wave') {
    assignPrefix('wave_');
    Object.assign(fields, compiled.ir.mainWave);
    return fields;
  }

  if (selection.kind === 'border') {
    assignPrefix(selection.slotIndex === 0 ? 'ob_' : 'ib_');
    return fields;
  }

  assignPrefix('mesh_');
  return fields;
}

export function getMilkdropSceneDragFieldUpdates({
  compiled,
  selection,
  currentPoint,
  startPoint,
  modifiers = {},
  baseFields,
}: {
  compiled: MilkdropCompiledPreset;
  selection: MilkdropScenePickResult;
  currentPoint: MilkdropScenePointerPoint;
  startPoint: MilkdropScenePointerPoint;
  modifiers?: MilkdropSceneDragModifiers;
  baseFields?: Record<string, number>;
}) {
  if (selection.kind !== 'shape' || selection.slotIndex === null) {
    return {};
  }

  const resolvedBaseFields =
    baseFields ?? getSelectionFieldMap(compiled, selection);
  const prefix = `shape_${selection.slotIndex}`;
  const baseX = resolvedBaseFields[`${prefix}_x`] ?? 0.5;
  const baseY = resolvedBaseFields[`${prefix}_y`] ?? 0.5;
  const baseRadius = resolvedBaseFields[`${prefix}_rad`] ?? 0.15;
  const baseAngle = resolvedBaseFields[`${prefix}_ang`] ?? 0;

  if (modifiers.altKey) {
    return {
      [`${prefix}_ang`]: Number.parseFloat(
        (
          baseAngle +
          (currentPoint.worldX - startPoint.worldX) * Math.PI
        ).toFixed(4),
      ),
    };
  }

  if (modifiers.shiftKey) {
    return {
      [`${prefix}_rad`]: clamp(
        Number.parseFloat(
          (
            baseRadius +
            (startPoint.worldY - currentPoint.worldY) * 0.35
          ).toFixed(4),
        ),
        0.04,
        0.9,
      ),
    };
  }

  return {
    [`${prefix}_x`]: clamp(
      Number.parseFloat(
        (baseX + (currentPoint.worldX - startPoint.worldX) * 0.5).toFixed(4),
      ),
      0,
      1,
    ),
    [`${prefix}_y`]: clamp(
      Number.parseFloat(
        (baseY + (currentPoint.worldY - startPoint.worldY) * 0.5).toFixed(4),
      ),
      0,
      1,
    ),
  };
}

export function isMilkdropSceneSelectionEditable(
  selection: MilkdropScenePickResult | null,
) {
  return selection?.kind === 'shape';
}

export { getSelectionFieldMap as getMilkdropSceneSelectionFieldMap };
