import {
  AdditiveBlending,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  PlaneGeometry,
} from 'three';
import {
  getSharedMilkdropCapturedVideoTexture,
  isMilkdropCapturedVideoReady,
} from '../../core/services/captured-video-texture.ts';
import type { MilkdropCapturedVideoReactiveState } from '../types.ts';

const OVERLAY_DEPTH = 2.4;
const OVERLAY_ASPECT = 16 / 9;
const BASE_ROTATION = -0.11;
const SHARED_GEOMETRY = new PlaneGeometry(1, 1);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function resolveCapturedVideoOverlayLayout({
  aspect,
  fov,
  reactivity,
}: {
  aspect: number;
  fov: number;
  reactivity: Pick<
    MilkdropCapturedVideoReactiveState,
    | 'overlayWidthScale'
    | 'overlayHeightScale'
    | 'overlayDriftX'
    | 'overlayDriftY'
    | 'overlayRotation'
    | 'baseOpacity'
    | 'ghostOpacity'
  >;
}) {
  const frustumHeight =
    2 * Math.tan(MathUtils.degToRad(fov) * 0.5) * OVERLAY_DEPTH;
  const frustumWidth = frustumHeight * aspect;
  const desktopLike = aspect >= 1;
  const widthFraction = desktopLike ? 0.29 : 0.48;
  const maxHeightFraction = desktopLike ? 0.34 : 0.42;
  const width = frustumWidth * widthFraction;
  const rawHeight = width / OVERLAY_ASPECT;
  const height = Math.min(rawHeight, frustumHeight * maxHeightFraction);
  const resolvedWidth = height * OVERLAY_ASPECT;
  const padX = frustumWidth * (desktopLike ? 0.048 : 0.04);
  const padY = frustumHeight * (desktopLike ? 0.12 : 0.15);

  return {
    width: resolvedWidth * reactivity.overlayWidthScale,
    height: height * reactivity.overlayHeightScale,
    x:
      frustumWidth * 0.5 -
      padX -
      resolvedWidth * 0.5 +
      reactivity.overlayDriftX,
    y: frustumHeight * 0.5 - padY - height * 0.5 + reactivity.overlayDriftY,
    rotation: BASE_ROTATION + reactivity.overlayRotation,
    baseOpacity: clamp(reactivity.baseOpacity, 0.12, 0.34),
    ghostOpacity: clamp(reactivity.ghostOpacity, 0.1, 0.29),
  };
}

export function createMilkdropCapturedVideoOverlay() {
  const texture = getSharedMilkdropCapturedVideoTexture();
  const group = new Group();
  group.visible = false;
  group.frustumCulled = false;
  group.renderOrder = 5000;

  const baseMaterial = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.18,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const redGhostMaterial = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.16,
    color: 0xff6b92,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const cyanGhostMaterial = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.14,
    color: 0x66e1ff,
    blending: AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  const baseMesh = new Mesh(SHARED_GEOMETRY, baseMaterial);
  const redGhostMesh = new Mesh(SHARED_GEOMETRY, redGhostMaterial);
  const cyanGhostMesh = new Mesh(SHARED_GEOMETRY, cyanGhostMaterial);
  [baseMesh, redGhostMesh, cyanGhostMesh].forEach((mesh) => {
    mesh.frustumCulled = false;
    mesh.renderOrder = 5000;
  });
  group.add(baseMesh, redGhostMesh, cyanGhostMesh);

  let attachedCamera: PerspectiveCamera | null = null;

  const setDomOverlayState = (active: boolean) => {
    if (typeof document === 'undefined') {
      return;
    }
    if (active) {
      document.documentElement.dataset.youtubeThreeOverlay = 'true';
      return;
    }
    delete document.documentElement.dataset.youtubeThreeOverlay;
  };

  return {
    attach(camera: PerspectiveCamera) {
      if (attachedCamera === camera) {
        return;
      }
      if (attachedCamera) {
        attachedCamera.remove(group);
      }
      attachedCamera = camera;
      camera.add(group);
    },
    update({
      camera,
      reactivity,
    }: {
      camera: PerspectiveCamera;
      reactivity: MilkdropCapturedVideoReactiveState;
    }) {
      const active = isMilkdropCapturedVideoReady();
      group.visible = active;
      setDomOverlayState(active);
      if (!active) {
        return;
      }

      const layout = resolveCapturedVideoOverlayLayout({
        aspect: camera.aspect,
        fov: camera.fov,
        reactivity,
      });

      group.position.set(layout.x, layout.y, -OVERLAY_DEPTH);
      group.rotation.z = layout.rotation;

      baseMesh.scale.set(layout.width, layout.height, 1);
      redGhostMesh.scale.set(
        layout.width * (1.008 + reactivity.trebleShimmer * 0.008),
        layout.height * (1.008 + reactivity.trebleShimmer * 0.006),
        1,
      );
      cyanGhostMesh.scale.set(
        layout.width * (1.01 + reactivity.trebleShimmer * 0.01),
        layout.height * (1.01 + reactivity.trebleShimmer * 0.007),
        1,
      );

      baseMaterial.opacity = layout.baseOpacity;
      redGhostMaterial.opacity = layout.ghostOpacity;
      cyanGhostMaterial.opacity = layout.ghostOpacity * 0.92;

      redGhostMesh.position.set(reactivity.ghostOffsetX, 0, 0.002);
      cyanGhostMesh.position.set(
        -reactivity.ghostOffsetX,
        reactivity.ghostOffsetY,
        -0.002,
      );
      baseMesh.position.set(0, 0, 0);
      texture.needsUpdate = true;
    },
    dispose() {
      setDomOverlayState(false);
      if (attachedCamera) {
        attachedCamera.remove(group);
        attachedCamera = null;
      }
      group.removeFromParent();
      baseMaterial.dispose();
      redGhostMaterial.dispose();
      cyanGhostMaterial.dispose();
    },
  };
}
