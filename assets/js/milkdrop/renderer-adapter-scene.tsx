import type { Group, Scene } from 'three';

type MilkdropRendererAdapterSceneOwner = {
  attach: () => void;
  dispose: () => void;
};

export function createMilkdropRendererAdapterSceneOwner({
  scene,
  root,
}: {
  scene: Scene;
  root: Group;
}): MilkdropRendererAdapterSceneOwner {
  let attached = false;
  let disposed = false;

  return {
    attach() {
      if (attached || disposed) {
        return;
      }

      attached = true;
      scene.add(root);
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      attached = false;
      scene.remove(root);
    },
  };
}
