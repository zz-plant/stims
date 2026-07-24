import type * as THREE from 'three';

type DisposeMeshOptions = {
  removeFromParent?: boolean;
};

type DisposeObjectOptions = {
  removeFromParent?: boolean;
  clearChildren?: boolean;
};

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

export function disposeMesh(
  mesh: THREE.Mesh | null | undefined,
  { removeFromParent = true }: DisposeMeshOptions = {},
) {
  if (!mesh) return;
  if (removeFromParent) {
    mesh.removeFromParent();
  }
  disposeGeometry(mesh.geometry);
  disposeMaterial(mesh.material as THREE.Material | THREE.Material[]);
}

export function disposeObject3D(
  object: THREE.Object3D | null | undefined,
  { removeFromParent = true, clearChildren = false }: DisposeObjectOptions = {},
) {
  if (!object) return;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if ((mesh as { isMesh?: boolean }).isMesh) {
      disposeMesh(mesh, { removeFromParent: false });
    }
  });
  if (clearChildren) {
    object.clear();
  }
  if (removeFromParent) {
    object.removeFromParent();
  }
}
