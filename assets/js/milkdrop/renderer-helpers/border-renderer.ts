import type { Group, Line, LineLoop, Mesh } from 'three';
import {
  BufferGeometry,
  DoubleSide,
  LineBasicMaterial,
  MeshBasicMaterial,
  Path,
  Shape,
  ShapeGeometry,
  Group as ThreeGroup,
  Line as ThreeLine,
  LineLoop as ThreeLineLoop,
  Mesh as ThreeMesh,
} from 'three';
import { disposeGeometry } from '../../utils/three-dispose';
import type {
  MilkdropBackendBehavior,
  MilkdropRendererBatcher,
} from '../renderer-adapter';
import type { MilkdropBorderVisual } from '../types';

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
    markAlwaysOnscreen: <
      T extends ThreeGroup | ThreeMesh | ThreeLine | ThreeLineLoop,
    >(
      object: T,
    ) => T;
    setMaterialColor: (
      material: MeshBasicMaterial | LineBasicMaterial,
      color: MilkdropBorderVisual['color'],
      alpha: number,
    ) => void;
  },
  alphaMultiplier = 1,
) {
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const left = -1 + inset * 2;
  const right = 1 - inset * 2;
  const top = 1 - inset * 2;
  const bottom = -1 + inset * 2;
  const group = helpers.markAlwaysOnscreen(new ThreeGroup());
  const fillShape = new Shape();
  fillShape.moveTo(-1, 1);
  fillShape.lineTo(1, 1);
  fillShape.lineTo(1, -1);
  fillShape.lineTo(-1, -1);
  fillShape.lineTo(-1, 1);
  const hole = new Path();
  hole.moveTo(left, top);
  hole.lineTo(left, bottom);
  hole.lineTo(right, bottom);
  hole.lineTo(right, top);
  hole.lineTo(left, top);
  fillShape.holes.push(hole);

  const fill = helpers.markAlwaysOnscreen(
    new ThreeMesh(
      new ShapeGeometry(fillShape),
      new MeshBasicMaterial({
        transparent: true,
        opacity: border.alpha * 0.45 * alphaMultiplier,
        side: DoubleSide,
      }),
    ),
  );
  helpers.setMaterialColor(
    fill.material,
    border.color,
    border.alpha * 0.45 * alphaMultiplier,
  );
  fill.position.z = 0.285;
  group.add(fill);

  const outline = new (
    behavior.useLineLoopPrimitives ? ThreeLineLoop : ThreeLine
  )(
    new BufferGeometry(),
    new LineBasicMaterial({
      transparent: true,
      opacity: border.alpha * alphaMultiplier,
    }),
  );
  outline.frustumCulled = false;
  helpers.ensureGeometryPositions(
    outline.geometry,
    helpers.getBorderLinePositions(border, 0.3, behavior),
  );
  helpers.setMaterialColor(
    outline.material,
    border.color,
    border.alpha * alphaMultiplier,
  );
  outline.position.z = 0.3;
  group.add(outline);

  return group;
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
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const previousInset = object.userData.borderInset as number | undefined;
  if (previousInset !== inset) {
    helpers.ensureGeometryPositions(
      object.geometry,
      helpers.getBorderLinePositions(border, 0.3, behavior),
    );
    object.userData.borderInset = inset;
  }
  helpers.setMaterialColor(
    object.material as LineBasicMaterial,
    border.color,
    border.alpha * alphaMultiplier,
  );
}

export function updateBorderFill(
  object: Mesh,
  border: MilkdropBorderVisual,
  helpers: {
    isSharedGeometry: (geometry: BufferGeometry) => boolean;
    setMaterialColor: (
      material: MeshBasicMaterial,
      color: MilkdropBorderVisual['color'],
      alpha: number,
    ) => void;
  },
  alphaMultiplier: number,
) {
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const previousInset = object.userData.borderInset as number | undefined;
  if (previousInset !== inset) {
    const left = -1 + inset * 2;
    const right = 1 - inset * 2;
    const top = 1 - inset * 2;
    const bottom = -1 + inset * 2;
    const fillShape = new Shape();
    fillShape.moveTo(-1, 1);
    fillShape.lineTo(1, 1);
    fillShape.lineTo(1, -1);
    fillShape.lineTo(-1, -1);
    fillShape.lineTo(-1, 1);
    const hole = new Path();
    hole.moveTo(left, top);
    hole.lineTo(left, bottom);
    hole.lineTo(right, bottom);
    hole.lineTo(right, top);
    hole.lineTo(left, top);
    fillShape.holes.push(hole);

    if (!helpers.isSharedGeometry(object.geometry)) {
      disposeGeometry(object.geometry);
    }
    object.geometry = new ShapeGeometry(fillShape);
    object.userData.borderInset = inset;
  }
  helpers.setMaterialColor(
    object.material as MeshBasicMaterial,
    border.color,
    border.alpha * 0.45 * alphaMultiplier,
  );
  object.position.z = 0.285;
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
  if (!(existing instanceof ThreeGroup)) {
    if (existing) {
      helpers.disposeObject(existing);
    }
    return helpers.createBorderObject(border, alphaMultiplier);
  }

  const fill = existing.children[0];
  const outline = existing.children[1];
  const expectsLoop = behavior.useLineLoopPrimitives;
  const hasSupportedOutline = expectsLoop
    ? outline instanceof ThreeLineLoop
    : outline instanceof ThreeLine;
  if (!(fill instanceof ThreeMesh) || !hasSupportedOutline) {
    helpers.disposeObject(existing);
    return helpers.createBorderObject(border, alphaMultiplier);
  }

  helpers.updateBorderFill(fill, border, alphaMultiplier);
  helpers.updateBorderLine(outline as Line | LineLoop, border, alphaMultiplier);
  outline.position.z = 0.3;
  return existing;
}

export function renderBorderGroup({
  target,
  group,
  borders,
  alphaMultiplier = 1,
  batcher,
  clearGroup,
  trimGroupChildren,
  syncBorderObject,
}: {
  target: 'borders' | 'blend-borders';
  group: Group;
  borders: MilkdropBorderVisual[];
  alphaMultiplier?: number;
  batcher: MilkdropRendererBatcher | null;
  clearGroup: (group: Group) => void;
  trimGroupChildren: (group: Group, keepCount: number) => void;
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
  for (let index = 0; index < borders.length; index += 1) {
    const border = borders[index];
    if (!border) {
      continue;
    }
    const existing = group.children[index] as Group | undefined;
    const synced = syncBorderObject(existing, border, alphaMultiplier);
    if (!existing) {
      group.add(synced);
    } else if (synced !== existing) {
      group.remove(existing);
      group.add(synced);
    }
  }
  trimGroupChildren(group, borders.length);
}
