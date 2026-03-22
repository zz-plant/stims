import type { BufferGeometry, Group, Line, Mesh, Points } from 'three';
import { disposeGeometry, disposeMaterial } from '../../utils/three-dispose';

export function clearGroup(
  group: Group,
  disposeObject: (object: { children?: unknown[] }) => void,
) {
  for (let index = group.children.length - 1; index >= 0; index -= 1) {
    const child = group.children[index];
    disposeObject(child);
    group.remove(child);
  }
}

export function createObjectDisposer(
  isSharedGeometry: (geometry: BufferGeometry) => boolean,
) {
  function disposeObject(object: { children?: unknown[] }) {
    if (
      'children' in object &&
      Array.isArray(object.children) &&
      object.children.length
    ) {
      object.children.forEach((child) =>
        disposeObject(child as { children?: unknown[] }),
      );
    }
    if ('geometry' in object) {
      const geometry = (object as Line | Mesh | Points).geometry;
      if (!isSharedGeometry(geometry)) {
        disposeGeometry(geometry);
      }
    }
    if ('material' in object) {
      disposeMaterial((object as Line | Mesh | Points).material);
    }
  }

  return disposeObject;
}

export function trimGroupChildren(
  group: Group,
  keepCount: number,
  disposeObject: (object: { children?: unknown[] }) => void,
) {
  for (let index = group.children.length - 1; index >= keepCount; index -= 1) {
    const child = group.children[index];
    disposeObject(child as { children?: unknown[] });
    group.remove(child);
  }
}
