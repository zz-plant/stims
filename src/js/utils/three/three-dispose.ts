import type * as THREE from 'three';

export function disposeMaterial(
  material: THREE.Material | THREE.Material[] | null | undefined,
) {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach((item) => item?.dispose());
    return;
  }
  material.dispose();
}

export function disposeGeometry(
  geometry:
    | THREE.BufferGeometry
    | THREE.InstancedBufferGeometry
    | null
    | undefined,
) {
  geometry?.dispose();
}
