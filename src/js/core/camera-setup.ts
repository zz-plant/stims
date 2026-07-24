import { OrthographicCamera } from 'three';

/**
 * Orthographic camera for MilkDrop rendering.
 *
 * MilkDrop uses a normalized 2D coordinate space where objects at screen
 * edges must render at the same scale as center objects. A perspective
 * camera would make edge objects appear smaller (perspective foreshortening),
 * causing visible size/position errors.
 *
 * Frustum covers the MilkDrop visible area:
 *   vertical: [-1, 1]
 *   horizontal: [-max(1, aspect), max(1, aspect)]
 */
export function initCamera({
  aspect = globalThis.innerWidth / globalThis.innerHeight,
  near = -100,
  far = 100,
  position = { x: 0, y: 0, z: 50 },
} = {}) {
  const halfWidth = Math.max(1, aspect);
  const halfHeight = 1;
  const camera = new OrthographicCamera(
    -halfWidth,
    halfWidth,
    halfHeight,
    -halfHeight,
    near,
    far,
  );
  camera.position.set(position.x, position.y, position.z);
  camera.lookAt(0, 0, 0);
  return camera;
}
