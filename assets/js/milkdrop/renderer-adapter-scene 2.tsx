import { createPortal, createRoot } from '@react-three/fiber';
import type { Group, ShaderMaterial } from 'three';
import {
  type BufferGeometry,
  type LineBasicMaterial,
  PerspectiveCamera,
  Scene,
} from 'three';
import type { RendererLike } from './renderer-adapter-shared.ts';

type MilkdropLineSegments = import('three').LineSegments<
  BufferGeometry,
  LineBasicMaterial | ShaderMaterial
>;

type MilkdropRendererAdapterSceneObjects = {
  root: Group;
  background: import('three').Mesh;
  meshLines: MilkdropLineSegments;
  mainWaveGroup: Group;
  customWaveGroup: Group;
  trailGroup: Group;
  particleFieldGroup: Group;
  shapesGroup: Group;
  borderGroup: Group;
  motionVectorGroup: Group;
  motionVectorCpuGroup: Group;
  proceduralMotionVectors: MilkdropLineSegments;
  blendWaveGroup: Group;
  blendCustomWaveGroup: Group;
  blendParticleFieldGroup: Group;
  blendShapeGroup: Group;
  blendBorderGroup: Group;
  blendMotionVectorGroup: Group;
  blendMotionVectorCpuGroup: Group;
  blendProceduralMotionVectors: MilkdropLineSegments;
};

type MilkdropRendererAdapterSceneOwner = {
  attach: () => void;
  dispose: () => void;
};

type DetachedRendererStub = RendererLike & {
  shadowMap: {
    enabled: boolean;
    type: number;
    needsUpdate: boolean;
  };
  setPixelRatio: (_value: number) => void;
  setSize: (_width: number, _height: number, _updateStyle?: boolean) => void;
  forceContextLoss: () => void;
  renderLists: {
    dispose: () => void;
  };
  xr: {
    addEventListener: (_type: string, _listener: () => void) => void;
    removeEventListener: (_type: string, _listener: () => void) => void;
  };
  outputColorSpace?: unknown;
  toneMapping?: unknown;
};

function MilkdropRendererAdapterScene({
  objects,
}: {
  objects: MilkdropRendererAdapterSceneObjects;
}) {
  return (
    <>
      <primitive dispose={null} object={objects.background} />
      <primitive dispose={null} object={objects.meshLines} />
      <primitive dispose={null} object={objects.mainWaveGroup} />
      <primitive dispose={null} object={objects.customWaveGroup} />
      <primitive dispose={null} object={objects.trailGroup} />
      <primitive dispose={null} object={objects.particleFieldGroup} />
      <primitive dispose={null} object={objects.shapesGroup} />
      <primitive dispose={null} object={objects.borderGroup} />
      <primitive dispose={null} object={objects.motionVectorGroup}>
        <primitive dispose={null} object={objects.motionVectorCpuGroup} />
        <primitive dispose={null} object={objects.proceduralMotionVectors} />
      </primitive>
      <primitive dispose={null} object={objects.blendWaveGroup} />
      <primitive dispose={null} object={objects.blendCustomWaveGroup} />
      <primitive dispose={null} object={objects.blendParticleFieldGroup} />
      <primitive dispose={null} object={objects.blendShapeGroup} />
      <primitive dispose={null} object={objects.blendBorderGroup} />
      <primitive dispose={null} object={objects.blendMotionVectorGroup}>
        <primitive dispose={null} object={objects.blendMotionVectorCpuGroup} />
        <primitive
          dispose={null}
          object={objects.blendProceduralMotionVectors}
        />
      </primitive>
    </>
  );
}

function createDetachedRendererStub(): DetachedRendererStub {
  return {
    render() {},
    setPixelRatio() {},
    setSize() {},
    forceContextLoss() {},
    shadowMap: {
      enabled: false,
      type: 0,
      needsUpdate: false,
    },
    renderLists: {
      dispose() {},
    },
    xr: {
      addEventListener() {},
      removeEventListener() {},
    },
  };
}

function canUseReactSceneOwner(renderer: RendererLike | null) {
  return (
    renderer !== null &&
    typeof document !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof (renderer as { setAnimationLoop?: unknown }).setAnimationLoop ===
      'function'
  );
}

export function createMilkdropRendererAdapterSceneOwner({
  renderer,
  objects,
}: {
  renderer: RendererLike | null;
  objects: MilkdropRendererAdapterSceneObjects;
}): MilkdropRendererAdapterSceneOwner | null {
  if (!canUseReactSceneOwner(renderer)) {
    return null;
  }

  const canvas = document.createElement('canvas');
  const root = createRoot(canvas);
  const detachedRenderer = createDetachedRendererStub();
  const detachedScene = new Scene();
  const detachedCamera = new PerspectiveCamera(75, 1, 0.1, 1000);
  let attached = false;
  let disposed = false;

  const configured = root.configure({
    gl: detachedRenderer,
    scene: detachedScene,
    camera: detachedCamera,
    frameloop: 'never',
    dpr: 1,
    size: {
      width: 1,
      height: 1,
      top: 0,
      left: 0,
    },
    events: () =>
      ({
        enabled: false,
        priority: 0,
        connected: null,
        handlers: {},
        connect() {},
        disconnect() {},
        update() {},
      }) as never,
  });

  return {
    attach() {
      if (attached || disposed) {
        return;
      }
      attached = true;
      void configured
        .then(() => {
          if (disposed) {
            return;
          }
          root.render(
            createPortal(
              <MilkdropRendererAdapterScene objects={objects} />,
              objects.root,
              {
                events: {
                  enabled: false,
                },
              },
            ),
          );
        })
        .catch(() => {
          attached = false;
        });
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      void configured
        .then(() => {
          root.unmount();
        })
        .catch(() => {});
    },
  };
}
