import type { Group, Line, LineLoop, Points } from 'three';
import {
  AdditiveBlending,
  BufferGeometry,
  LineBasicMaterial,
  NormalBlending,
  PointsMaterial,
  Group as ThreeGroup,
  Line as ThreeLine,
  LineLoop as ThreeLineLoop,
  Points as ThreePoints,
} from 'three';
import type {
  MilkdropBackendBehavior,
  MilkdropRendererBatcher,
} from '../renderer-adapter';
import type { MilkdropColor, MilkdropWaveVisual } from '../types';

type WaveLayerObject = Line | LineLoop | Points;

const THICK_WAVE_PASS_OFFSET = 1 / 1024;

function getWaveLayerCount(wave: MilkdropWaveVisual) {
  return wave.drawMode === 'dots' || wave.thickness > 1 ? 4 : 1;
}

function getWaveLayerOffsets(layerCount: number) {
  if (layerCount < 4) {
    return [{ x: 0, y: 0 }];
  }
  return [
    { x: 0, y: 0 },
    { x: THICK_WAVE_PASS_OFFSET, y: 0 },
    { x: THICK_WAVE_PASS_OFFSET, y: THICK_WAVE_PASS_OFFSET },
    { x: 0, y: THICK_WAVE_PASS_OFFSET },
  ];
}

function createWaveLayerObject(
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
  offsetX: number,
  offsetY: number,
) {
  const positions = helpers.getWaveLinePositions(wave, behavior);
  if (wave.drawMode === 'dots') {
    const object = new ThreePoints(
      new BufferGeometry(),
      new PointsMaterial({
        size: 1,
        transparent: true,
        depthWrite: false,
        opacity: wave.alpha * alphaMultiplier,
        ...(wave.additive ? { blending: AdditiveBlending } : {}),
      }),
    );
    object.geometry.userData.skipDynamicBounds = true;
    helpers.ensureGeometryPositions(object.geometry, positions);
    helpers.setMaterialColor(
      object.material,
      wave.color,
      wave.alpha * alphaMultiplier,
    );
    object.position.set(offsetX, offsetY, 0.24);
    return object;
  }

  const ObjectType =
    wave.closed && behavior.useLineLoopPrimitives ? ThreeLineLoop : ThreeLine;
  const object = new ObjectType(
    new BufferGeometry(),
    new LineBasicMaterial({
      linewidth: 1,
      transparent: true,
      depthWrite: false,
      opacity: wave.alpha * alphaMultiplier,
      ...(wave.additive ? { blending: AdditiveBlending } : {}),
    }),
  );
  object.geometry.userData.skipDynamicBounds = true;
  helpers.ensureGeometryPositions(object.geometry, positions);
  helpers.setMaterialColor(
    object.material,
    wave.color,
    wave.alpha * alphaMultiplier,
  );
  object.position.set(offsetX, offsetY, 0.24);
  return object;
}

function syncWaveLayerObject(
  existing: WaveLayerObject | undefined,
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
  offsetX: number,
  offsetY: number,
) {
  const needsPoints = wave.drawMode === 'dots';
  const expectsLoop =
    wave.closed && !needsPoints && behavior.useLineLoopPrimitives;
  const matches =
    !!existing &&
    ((needsPoints && existing instanceof ThreePoints) ||
      (expectsLoop && existing instanceof ThreeLineLoop) ||
      (!needsPoints && !expectsLoop && existing instanceof ThreeLine));

  if (!matches) {
    return createWaveLayerObject(
      wave,
      behavior,
      helpers,
      alphaMultiplier,
      offsetX,
      offsetY,
    );
  }

  helpers.ensureGeometryPositions(
    existing.geometry,
    helpers.getWaveLinePositions(wave, behavior),
  );
  if (existing instanceof ThreePoints) {
    const material = existing.material as PointsMaterial;
    material.size = 1;
    material.blending = wave.additive ? AdditiveBlending : NormalBlending;
    helpers.setMaterialColor(
      material,
      wave.color,
      wave.alpha * alphaMultiplier,
    );
  } else {
    const material = existing.material as LineBasicMaterial;
    material.linewidth = 1;
    material.blending = wave.additive ? AdditiveBlending : NormalBlending;
    helpers.setMaterialColor(
      material,
      wave.color,
      wave.alpha * alphaMultiplier,
    );
  }
  existing.position.set(offsetX, offsetY, 0.24);
  return existing;
}

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
  const layerCount = getWaveLayerCount(wave);
  const group = new ThreeGroup();
  for (const { x, y } of getWaveLayerOffsets(layerCount)) {
    group.add(
      createWaveLayerObject(wave, behavior, helpers, alphaMultiplier, x, y),
    );
  }
  return group;
}

export function updateWaveObject(
  object: Group,
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
  const layerCount = getWaveLayerCount(wave);
  const offsets = getWaveLayerOffsets(layerCount);

  for (let index = 0; index < offsets.length; index += 1) {
    const { x, y } = offsets[index] as { x: number; y: number };
    const existing = object.children[index] as WaveLayerObject | undefined;
    const synced = syncWaveLayerObject(
      existing,
      wave,
      behavior,
      helpers,
      alphaMultiplier,
      x,
      y,
    );
    if (!existing) {
      object.add(synced);
    } else if (synced !== existing) {
      object.remove(existing);
      helpers.disposeObject(existing);
      object.add(synced);
    }
  }
  for (
    let index = object.children.length - 1;
    index >= offsets.length;
    index -= 1
  ) {
    const child = object.children[index];
    object.remove(child);
    helpers.disposeObject(child as { children?: unknown[] });
  }
}

export function syncWaveObject(
  existing: Group | undefined,
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

  if (!(existing instanceof ThreeGroup)) {
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
        depthWrite: false,
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
    existing: Group | undefined,
    wave: MilkdropWaveVisual,
    alphaMultiplier: number,
  ) => Group | null;
}) {
  if (batcher?.renderWaveGroup?.(target, group, waves, alphaMultiplier)) {
    clearGroup(group);
    return;
  }
  for (let index = 0; index < waves.length; index += 1) {
    const wave = waves[index] as MilkdropWaveVisual;
    const existing = group.children[index] as Group | undefined;
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
