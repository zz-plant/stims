import type { Group, Line, LineBasicMaterial, LineLoop, Mesh } from 'three';
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Group as ThreeGroup,
  Mesh as ThreeMesh,
} from 'three';
import { disposeGeometry } from '../../utils/three-dispose';
import type {
  MilkdropBackendBehavior,
  MilkdropRendererBatcher,
} from '../renderer-adapter';
import type { MilkdropBorderVisual } from '../types';

const BORDER_TRIANGLE_INDICES = [
  0, 1, 4, 1, 4, 5, 2, 3, 6, 3, 7, 6, 2, 0, 6, 0, 4, 6, 3, 7, 5, 1, 3, 5,
];

function clampRadius(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getBorderGeometryKey(
  border: MilkdropBorderVisual,
  outerBorderSize: number | null,
) {
  return `${border.key}:${outerBorderSize ?? 'self'}:${border.size}`;
}

function buildBorderGeometry(
  border: MilkdropBorderVisual,
  outerBorderSize: number | null = null,
) {
  const outerRadius =
    border.key === 'outer'
      ? 1
      : clampRadius(1 - (outerBorderSize ?? border.size));
  const innerRadius =
    border.key === 'outer'
      ? clampRadius(1 - border.size)
      : clampRadius(outerRadius - border.size);

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [
        outerRadius,
        outerRadius,
        0,
        outerRadius,
        -outerRadius,
        0,
        -outerRadius,
        outerRadius,
        0,
        -outerRadius,
        -outerRadius,
        0,
        innerRadius,
        innerRadius,
        0,
        innerRadius,
        -innerRadius,
        0,
        -innerRadius,
        innerRadius,
        0,
        -innerRadius,
        -innerRadius,
        0,
      ],
      3,
    ),
  );
  geometry.setIndex(BORDER_TRIANGLE_INDICES);
  geometry.userData.borderGeometryKey = getBorderGeometryKey(
    border,
    outerBorderSize,
  );
  return geometry;
}

function syncBorderGeometry(
  object: Mesh,
  border: MilkdropBorderVisual,
  outerBorderSize: number | null,
) {
  const nextGeometryKey = getBorderGeometryKey(border, outerBorderSize);
  if (object.userData.borderGeometryKey === nextGeometryKey) {
    return;
  }

  disposeGeometry(object.geometry);
  object.geometry = buildBorderGeometry(border, outerBorderSize);
  object.userData.borderGeometryKey = nextGeometryKey;
}

function setBorderMaterialAppearance(
  material: MeshBasicMaterial,
  color: MilkdropBorderVisual['color'],
  alpha: number,
) {
  material.transparent = true;
  material.opacity = alpha;
  material.side = DoubleSide;
  material.color.setRGB(color.r, color.g, color.b);
}

function createBorderGroupObjectRaw(
  border: MilkdropBorderVisual,
  outerBorderSize: number | null,
  alphaMultiplier: number,
) {
  const group = new ThreeGroup();
  const fill = new ThreeMesh(
    buildBorderGeometry(border, outerBorderSize),
    new MeshBasicMaterial({
      transparent: true,
      opacity: border.alpha * alphaMultiplier,
      side: DoubleSide,
    }),
  );
  fill.userData.borderGeometryKey = getBorderGeometryKey(
    border,
    outerBorderSize,
  );
  setBorderMaterialAppearance(
    fill.material as MeshBasicMaterial,
    border.color,
    border.alpha * alphaMultiplier,
  );
  fill.position.z = 0.3;
  group.add(fill);
  return group;
}

function createBorderGroupObject(
  border: MilkdropBorderVisual,
  outerBorderSize: number | null,
  helpers: {
    markAlwaysOnscreen: <T extends ThreeGroup | ThreeMesh>(object: T) => T;
    setMaterialColor: (
      material: MeshBasicMaterial | LineBasicMaterial,
      color: MilkdropBorderVisual['color'],
      alpha: number,
    ) => void;
  },
  alphaMultiplier: number,
) {
  const group = helpers.markAlwaysOnscreen(new ThreeGroup());
  const fill = helpers.markAlwaysOnscreen(
    new ThreeMesh(
      buildBorderGeometry(border, outerBorderSize),
      new MeshBasicMaterial({
        transparent: true,
        opacity: border.alpha * alphaMultiplier,
        side: DoubleSide,
      }),
    ),
  );
  fill.userData.borderGeometryKey = getBorderGeometryKey(
    border,
    outerBorderSize,
  );
  helpers.setMaterialColor(
    fill.material,
    border.color,
    border.alpha * alphaMultiplier,
  );
  fill.position.z = 0.3;
  group.add(fill);
  return group;
}

function syncBorderGroupObject(
  existing: Group | undefined,
  border: MilkdropBorderVisual,
  outerBorderSize: number | null,
  alphaMultiplier: number,
  helpers: {
    disposeObject: (object: { children?: unknown[] }) => void;
  },
) {
  if (!(existing instanceof ThreeGroup)) {
    if (existing) {
      helpers.disposeObject(existing);
    }
    return createBorderGroupObjectRaw(border, outerBorderSize, alphaMultiplier);
  }

  const fill = existing.children[0];
  if (!(fill instanceof ThreeMesh) || existing.children.length !== 1) {
    helpers.disposeObject(existing);
    return createBorderGroupObjectRaw(border, outerBorderSize, alphaMultiplier);
  }

  syncBorderGeometry(fill, border, outerBorderSize);
  setBorderMaterialAppearance(
    fill.material as MeshBasicMaterial,
    border.color,
    border.alpha * alphaMultiplier,
  );
  fill.position.z = 0.3;
  return existing;
}

export function createBorderObject(
  border: MilkdropBorderVisual,
  behavior: MilkdropBackendBehavior,
  helpers: {
    ensureGeometryPositions: (
      geometry: BufferGeometry,
      positions: number[],
    ) => void;
    getBorderLinePositions: (
      border: MilkdropBorderVisual,
      z: number,
      behavior: MilkdropBackendBehavior,
    ) => number[];
    markAlwaysOnscreen: <T extends ThreeGroup | ThreeMesh>(object: T) => T;
    setMaterialColor: (
      material: MeshBasicMaterial | LineBasicMaterial,
      color: MilkdropBorderVisual['color'],
      alpha: number,
    ) => void;
  },
  alphaMultiplier = 1,
) {
  void behavior;
  void helpers.ensureGeometryPositions;
  void helpers.getBorderLinePositions;
  return createBorderGroupObject(border, null, helpers, alphaMultiplier);
}

export function updateBorderLine(
  object: Line | LineLoop,
  border: MilkdropBorderVisual,
  behavior: MilkdropBackendBehavior,
  helpers: {
    ensureGeometryPositions: (
      geometry: BufferGeometry,
      positions: number[],
    ) => void;
    getBorderLinePositions: (
      border: MilkdropBorderVisual,
      z: number,
      behavior: MilkdropBackendBehavior,
    ) => number[];
    setMaterialColor: (
      material: LineBasicMaterial,
      color: MilkdropBorderVisual['color'],
      alpha: number,
    ) => void;
  },
  alphaMultiplier: number,
) {
  void object;
  void border;
  void behavior;
  void helpers;
  void alphaMultiplier;
}

export function updateBorderFill(
  object: Mesh,
  border: MilkdropBorderVisual,
  helpers: {
    setMaterialColor: (
      material: MeshBasicMaterial,
      color: MilkdropBorderVisual['color'],
      alpha: number,
    ) => void;
  },
  alphaMultiplier: number,
  outerBorderSize: number | null = null,
) {
  syncBorderGeometry(object, border, outerBorderSize);
  helpers.setMaterialColor(
    object.material as MeshBasicMaterial,
    border.color,
    border.alpha * alphaMultiplier,
  );
  object.position.z = 0.3;
}

export function syncBorderObject(
  existing: Group | undefined,
  border: MilkdropBorderVisual,
  behavior: MilkdropBackendBehavior,
  helpers: {
    disposeObject: (object: { children?: unknown[] }) => void;
    createBorderObject: (
      border: MilkdropBorderVisual,
      alphaMultiplier: number,
    ) => Group;
    updateBorderFill: (
      object: Mesh,
      border: MilkdropBorderVisual,
      alphaMultiplier: number,
    ) => void;
    updateBorderLine: (
      object: Line | LineLoop,
      border: MilkdropBorderVisual,
      alphaMultiplier: number,
    ) => void;
  },
  alphaMultiplier: number,
) {
  void behavior;
  void helpers.updateBorderLine;

  return syncBorderGroupObject(existing, border, null, alphaMultiplier, {
    disposeObject: helpers.disposeObject,
  });
}

export function renderBorderGroup({
  target,
  group,
  borders,
  alphaMultiplier = 1,
  batcher,
  clearGroup,
  trimGroupChildren,
  disposeObject,
  syncBorderObject: _syncBorderObject,
}: {
  target: 'borders' | 'blend-borders';
  group: Group;
  borders: MilkdropBorderVisual[];
  alphaMultiplier?: number;
  batcher: MilkdropRendererBatcher | null;
  clearGroup: (group: Group) => void;
  trimGroupChildren: (group: Group, keepCount: number) => void;
  disposeObject: (object: { children?: unknown[] }) => void;
  syncBorderObject: (
    existing: Group | undefined,
    border: MilkdropBorderVisual,
    alphaMultiplier: number,
  ) => Group;
}) {
  if (batcher?.renderBorderGroup?.(target, group, borders, alphaMultiplier)) {
    clearGroup(group);
    return;
  }

  const outerBorderSize =
    borders.find((candidate) => candidate?.key === 'outer')?.size ?? null;

  for (let index = 0; index < borders.length; index += 1) {
    const border = borders[index];
    if (!border) {
      continue;
    }
    const existing = group.children[index] as Group | undefined;
    const synced = syncBorderGroupObject(
      existing,
      border,
      outerBorderSize,
      alphaMultiplier,
      {
        disposeObject,
      },
    );
    if (!existing) {
      group.add(synced);
    } else if (synced !== existing) {
      group.remove(existing);
      group.add(synced);
    }
  }
  trimGroupChildren(group, borders.length);
  void _syncBorderObject;
}
