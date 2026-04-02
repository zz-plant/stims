import type { Group, Line, LineLoop, Points } from 'three';
import {
  AdditiveBlending,
  BufferGeometry,
  LineBasicMaterial,
  NormalBlending,
  PointsMaterial,
  Line as ThreeLine,
  LineLoop as ThreeLineLoop,
  Points as ThreePoints,
} from 'three';
import type {
  MilkdropBackendBehavior,
  MilkdropRendererBatcher,
} from '../renderer-adapter';
import type { MilkdropColor, MilkdropWaveVisual } from '../types';

export function createWaveObject(
  wave: MilkdropWaveVisual | null,
  behavior: MilkdropBackendBehavior,
  helpers: {
    ensureGeometryPositions: (
      geometry: BufferGeometry,
      positions: number[],
    ) => void;
    getWaveLinePositions: (
      wave: MilkdropWaveVisual,
      behavior: MilkdropBackendBehavior,
    ) => number[];
    setMaterialColor: (
      material: LineBasicMaterial | PointsMaterial,
      color: MilkdropColor,
      alpha: number,
    ) => void;
  },
  alphaMultiplier = 1,
) {
  if (!wave || wave.positions.length === 0) {
    return null;
  }

  if (wave.drawMode === 'dots') {
    const object = new ThreePoints(
      new BufferGeometry(),
      new PointsMaterial({
        size: wave.pointSize,
        transparent: true,
        opacity: wave.alpha * alphaMultiplier,
        ...(wave.additive ? { blending: AdditiveBlending } : {}),
      }),
    );
    object.geometry.userData.skipDynamicBounds = true;
    helpers.ensureGeometryPositions(object.geometry, wave.positions);
    helpers.setMaterialColor(
      object.material,
      wave.color,
      wave.alpha * alphaMultiplier,
    );
    object.position.z = 0.24;
    return object;
  }

  const ObjectType =
    wave.closed && behavior.useLineLoopPrimitives ? ThreeLineLoop : ThreeLine;
  const object = new ObjectType(
    new BufferGeometry(),
    new LineBasicMaterial({
      linewidth: Math.max(1, wave.thickness),
      transparent: true,
      opacity: wave.alpha * alphaMultiplier,
      ...(wave.additive ? { blending: AdditiveBlending } : {}),
    }),
  );
  object.geometry.userData.skipDynamicBounds = true;
  helpers.ensureGeometryPositions(
    object.geometry,
    helpers.getWaveLinePositions(wave, behavior),
  );
  helpers.setMaterialColor(
    object.material,
    wave.color,
    wave.alpha * alphaMultiplier,
  );
  object.position.z = 0.24;
  return object;
}

export function updateWaveObject(
  object: Line | LineLoop | Points,
  wave: MilkdropWaveVisual,
  behavior: MilkdropBackendBehavior,
  helpers: {
    ensureGeometryPositions: (
      geometry: BufferGeometry,
      positions: number[],
    ) => void;
    getWaveLinePositions: (
      wave: MilkdropWaveVisual,
      behavior: MilkdropBackendBehavior,
    ) => number[];
    setMaterialColor: (
      material: LineBasicMaterial | PointsMaterial,
      color: MilkdropColor,
      alpha: number,
    ) => void;
  },
  alphaMultiplier: number,
) {
  helpers.ensureGeometryPositions(
    object.geometry,
    helpers.getWaveLinePositions(wave, behavior),
  );
  if (object instanceof ThreePoints) {
    const material = object.material as PointsMaterial;
    material.size = wave.pointSize;
    material.blending = wave.additive ? AdditiveBlending : NormalBlending;
    helpers.setMaterialColor(
      material,
      wave.color,
      wave.alpha * alphaMultiplier,
    );
  } else {
    const material = object.material as LineBasicMaterial;
    material.linewidth = Math.max(1, wave.thickness);
    material.blending = wave.additive ? AdditiveBlending : NormalBlending;
    helpers.setMaterialColor(
      material,
      wave.color,
      wave.alpha * alphaMultiplier,
    );
  }
  object.position.z = 0.24;
}

export function syncWaveObject(
  existing: Line | LineLoop | Points | undefined,
  wave: MilkdropWaveVisual,
  behavior: MilkdropBackendBehavior,
  helpers: {
    disposeObject: (object: { children?: unknown[] }) => void;
    ensureGeometryPositions: (
      geometry: BufferGeometry,
      positions: number[],
    ) => void;
    getWaveLinePositions: (
      wave: MilkdropWaveVisual,
      behavior: MilkdropBackendBehavior,
    ) => number[];
    setMaterialColor: (
      material: LineBasicMaterial | PointsMaterial,
      color: MilkdropColor,
      alpha: number,
    ) => void;
  },
  alphaMultiplier: number,
) {
  if (wave.positions.length === 0) {
    if (existing) {
      helpers.disposeObject(existing);
    }
    return null;
  }

  const wantsPoints = wave.drawMode === 'dots';
  const wantsLoop =
    wave.closed && !wantsPoints && behavior.useLineLoopPrimitives;
  const matches =
    !!existing &&
    ((wantsPoints && existing instanceof ThreePoints) ||
      (wantsLoop && existing instanceof ThreeLineLoop) ||
      (!wantsPoints && !wantsLoop && existing instanceof ThreeLine));

  if (!matches) {
    if (existing) {
      helpers.disposeObject(existing);
    }
    return createWaveObject(wave, behavior, helpers, alphaMultiplier);
  }

  updateWaveObject(existing, wave, behavior, helpers, alphaMultiplier);
  return existing;
}

export function createLineObject(
  positions: number[],
  color: MilkdropColor,
  alpha: number,
  additive: boolean,
  helpers: {
    ensureGeometryPositions: (
      geometry: BufferGeometry,
      positions: number[],
    ) => void;
    markAlwaysOnscreen: <T extends ThreeLine>(object: T) => T;
    setMaterialColor: (
      material: LineBasicMaterial,
      color: MilkdropColor,
      alpha: number,
    ) => void;
  },
) {
  const object = helpers.markAlwaysOnscreen(
    new ThreeLine(
      new BufferGeometry(),
      new LineBasicMaterial({
        transparent: true,
        opacity: alpha,
        ...(additive ? { blending: AdditiveBlending } : {}),
      }),
    ),
  );
  object.geometry.userData.skipDynamicBounds = true;
  helpers.ensureGeometryPositions(object.geometry, positions);
  helpers.setMaterialColor(object.material, color, alpha);
  object.position.z = 0.24;
  return object;
}

export function syncLineObject(
  existing: Line | undefined,
  line: {
    positions: number[];
    color: MilkdropColor;
    alpha: number;
    additive: boolean;
  },
  alphaMultiplier: number,
  helpers: {
    disposeObject: (object: { children?: unknown[] }) => void;
    ensureGeometryPositions: (
      geometry: BufferGeometry,
      positions: number[],
    ) => void;
    markAlwaysOnscreen: <T extends ThreeLine>(object: T) => T;
    setMaterialColor: (
      material: LineBasicMaterial,
      color: MilkdropColor,
      alpha: number,
    ) => void;
  },
) {
  if (line.positions.length === 0) {
    if (existing) {
      helpers.disposeObject(existing);
    }
    return null;
  }

  if (!(existing instanceof ThreeLine) || existing instanceof ThreeLineLoop) {
    if (existing) {
      helpers.disposeObject(existing);
    }
    return createLineObject(
      line.positions,
      line.color,
      line.alpha * alphaMultiplier,
      line.additive,
      helpers,
    );
  }

  helpers.ensureGeometryPositions(existing.geometry, line.positions);
  const material = existing.material as LineBasicMaterial;
  material.blending = line.additive ? AdditiveBlending : NormalBlending;
  helpers.setMaterialColor(material, line.color, line.alpha * alphaMultiplier);
  existing.position.z = 0.24;
  return existing;
}

export function renderWaveGroup({
  target,
  group,
  waves,
  alphaMultiplier = 1,
  batcher,
  clearGroup,
  trimGroupChildren,
  syncWaveObject,
}: {
  target: 'main-wave' | 'custom-wave' | 'blend-main-wave' | 'blend-custom-wave';
  group: Group;
  waves: MilkdropWaveVisual[];
  alphaMultiplier?: number;
  batcher: MilkdropRendererBatcher | null;
  clearGroup: (group: Group) => void;
  trimGroupChildren: (group: Group, keepCount: number) => void;
  syncWaveObject: (
    existing: Line | LineLoop | Points | undefined,
    wave: MilkdropWaveVisual,
    alphaMultiplier: number,
  ) => Line | LineLoop | Points | null;
}) {
  if (batcher?.renderWaveGroup?.(target, group, waves, alphaMultiplier)) {
    clearGroup(group);
    return;
  }
  for (let index = 0; index < waves.length; index += 1) {
    const wave = waves[index] as MilkdropWaveVisual;
    const existing = group.children[index] as
      | Line
      | LineLoop
      | Points
      | undefined;
    const synced = syncWaveObject(existing, wave, alphaMultiplier);
    if (!synced) {
      continue;
    }
    if (!existing) {
      group.add(synced);
    } else if (synced !== existing) {
      group.remove(existing);
      group.add(synced);
    }
  }
  trimGroupChildren(group, waves.length);
}

export function renderLineVisualGroup({
  target,
  group,
  lines,
  alphaMultiplier = 1,
  batcher,
  clearGroup,
  trimGroupChildren,
  syncLineObject,
}: {
  target: 'trails' | 'motion-vectors' | 'blend-motion-vectors';
  group: Group;
  lines: Array<{
    positions: number[];
    color: MilkdropColor;
    alpha: number;
    additive?: boolean;
  }>;
  alphaMultiplier?: number;
  batcher: MilkdropRendererBatcher | null;
  clearGroup: (group: Group) => void;
  trimGroupChildren: (group: Group, keepCount: number) => void;
  syncLineObject: (
    existing: Line | undefined,
    line: {
      positions: number[];
      color: MilkdropColor;
      alpha: number;
      additive: boolean;
    },
    alphaMultiplier: number,
  ) => Line | null;
}) {
  if (batcher?.renderLineVisualGroup?.(target, group, lines, alphaMultiplier)) {
    clearGroup(group);
    return;
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    const existing = group.children[index] as Line | undefined;
    const synced = syncLineObject(
      existing,
      {
        positions: line.positions,
        color: line.color,
        alpha: line.alpha,
        additive: line.additive ?? false,
      },
      alphaMultiplier,
    );
    if (!synced) {
      if (existing) {
        group.remove(existing);
      }
      continue;
    }
    if (!existing) {
      group.add(synced);
    } else if (synced !== existing) {
      group.remove(existing);
      group.add(synced);
    }
  }
  trimGroupChildren(group, lines.length);
}
