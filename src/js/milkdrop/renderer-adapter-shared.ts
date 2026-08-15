import type { Camera, PointsMaterial, Scene, Texture } from 'three';
import {
  AddEquation,
  AdditiveBlending,
  BufferGeometry,
  CustomBlending,
  DstColorFactor,
  DynamicDrawUsage,
  Float32BufferAttribute,
  type Group,
  type Line,
  type LineBasicMaterial,
  type LineSegments,
  type Material,
  type Mesh,
  type MeshBasicMaterial,
  OneFactor,
  PlaneGeometry,
  type Points,
  ReverseSubtractEquation,
  Shape,
  ShapeGeometry,
  Sphere,
  Vector2,
  Vector3,
  ZeroFactor,
} from 'three';
import { disposeGeometry, disposeMaterial } from '../utils/three/three-dispose';
import type { MilkdropBackendBehavior } from './backend-behavior';
import type {
  MilkdropBorderVisual,
  MilkdropColor,
  MilkdropCompiledPreset,
  MilkdropFeedbackManager,
  MilkdropFeedbackSetRenderTarget,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralWaveVisual,
  MilkdropShapeVisual,
  MilkdropWaveVisual,
} from './types';
import {
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlags,
} from './webgpu-optimization-flags';

export type RendererLike = {
  isWebGPURenderer?: boolean;
  depth?: boolean;
  getSize?: (target: Vector2) => Vector2;
  render: (scene: Scene, camera: Camera) => void;
  setRenderTarget?: RendererSetRenderTarget;
};

export type RendererSetRenderTarget = {
  bivarianceHack: MilkdropFeedbackSetRenderTarget;
}['bivarianceHack'];

export type MilkdropRendererAdapterConfig = {
  scene: Scene;
  camera: Camera;
  renderer?: RendererLike | null;
  backend: 'webgl' | 'webgpu';
  preset?: MilkdropCompiledPreset | null;
  behavior?: MilkdropBackendBehavior;
  createFeedbackManager?: MilkdropFeedbackManagerFactory;
  batcher?: MilkdropRendererBatcher | null;
  fallbackCustomWaves?: boolean;
  webgpuOptimizationFlags?: MilkdropWebGpuOptimizationFlags;
};

export type MilkdropRendererBatcher = {
  attach: (root: Group) => void;
  dispose: () => void;
  disposeWithCaches?: () => void;
  setShapeTexture?: (texture: Texture | null) => void;
  renderWaveGroup?: (
    target:
      | 'main-wave'
      | 'custom-wave'
      | 'blend-main-wave'
      | 'blend-custom-wave',
    group: Group,
    waves: MilkdropWaveVisual[],
    alphaMultiplier: number,
  ) => boolean;
  renderProceduralWaveGroup?: (
    target: 'main-wave' | 'trail-waves',
    group: Group,
    waves: MilkdropProceduralWaveVisual[],
  ) => boolean;
  renderProceduralCustomWaveGroup?: (
    group: Group,
    waves: MilkdropProceduralCustomWaveVisual[],
  ) => boolean;
  renderShapeGroup?: (
    target: 'shapes' | 'blend-shapes',
    group: Group,
    shapes: MilkdropShapeVisual[],
    alphaMultiplier: number,
  ) => boolean;
  renderBorderGroup?: (
    target: 'borders' | 'blend-borders',
    group: Group,
    borders: MilkdropBorderVisual[],
    alphaMultiplier: number,
    screenAspect: number,
  ) => boolean;
  renderLineVisualGroup?: (
    target: 'trails' | 'motion-vectors' | 'blend-motion-vectors',
    group: Group,
    lines: Array<{
      positions: ArrayLike<number>;
      color: MilkdropColor;
      alpha: number;
      additive?: boolean;
    }>,
    alphaMultiplier: number,
  ) => boolean;
};

export type MilkdropFeedbackManagerFactory = (
  width: number,
  height: number,
) => MilkdropFeedbackManager;

export const DEFAULT_ADAPTER_WEBGPU_OPTIMIZATION_FLAGS =
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS;
export const MAX_MILKDROP_POLYGON_SIDES = 128;

const SHARED_GEOMETRY_FLAG = 'milkdropSharedGeometry';
export const BACKGROUND_GEOMETRY = markSharedGeometry(
  new PlaneGeometry(6.4, 6.4),
);
const polygonFillGeometryCache = new Map<number, ShapeGeometry>();
const polygonOutlineGeometryCache = new Map<string, BufferGeometry>();

export function getShaderTextureSourceId(source: string) {
  switch (source) {
    case 'video':
      return 8;
    case 'pattern':
      return 6;
    case 'fractal':
      return 7;
    case 'caustics':
      return 5;
    case 'aura':
      return 4;
    case 'voronoi':
      return 3;
    case 'simplex':
      return 2;
    case 'perlin':
      return 9;
    case 'noise':
      return 1;
    default:
      return 0;
  }
}

export function getShaderTextureBlendModeId(mode: string) {
  switch (mode) {
    case 'replace':
      return 1;
    case 'mix':
      return 2;
    case 'add':
      return 3;
    case 'multiply':
      return 4;
    case 'subtract':
      return 5;
    default:
      return 0;
  }
}

export function getShaderSampleDimensionId(dimension: '2d' | '3d') {
  return dimension === '3d' ? 1 : 0;
}

export function markSharedGeometry<T extends BufferGeometry>(geometry: T) {
  geometry.userData[SHARED_GEOMETRY_FLAG] = true;
  return geometry;
}

export function isSharedGeometry(geometry: BufferGeometry) {
  return geometry.userData[SHARED_GEOMETRY_FLAG] === true;
}

export function setGeometryBoundingSphere(
  geometry: BufferGeometry,
  center: Vector3,
  radius: number,
) {
  if (!geometry.boundingSphere) {
    geometry.boundingSphere = new Sphere(center.clone(), radius);
    return geometry.boundingSphere;
  }
  geometry.boundingSphere.center.copy(center);
  geometry.boundingSphere.radius = radius;
  return geometry.boundingSphere;
}

export function setSharedGeometryBounds(
  geometry: BufferGeometry,
  {
    center = new Vector3(0, 0, 0),
    radius,
  }: {
    center?: Vector3;
    radius: number;
  },
) {
  setGeometryBoundingSphere(geometry, center, radius);
  return geometry;
}

export function setGeometryBoundsFromPositions(
  geometry: BufferGeometry,
  positions: ArrayLike<number>,
) {
  if (positions.length < 3) {
    return setGeometryBoundingSphere(geometry, new Vector3(0, 0, 0), 0);
  }

  let minX = positions[0] ?? 0;
  let maxX = minX;
  let minY = positions[1] ?? 0;
  let maxY = minY;
  let minZ = positions[2] ?? 0;
  let maxZ = minZ;

  for (let index = 3; index < positions.length; index += 3) {
    const x = positions[index] ?? 0;
    const y = positions[index + 1] ?? 0;
    const z = positions[index + 2] ?? 0;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }

  const center = new Vector3(
    (minX + maxX) * 0.5,
    (minY + maxY) * 0.5,
    (minZ + maxZ) * 0.5,
  );
  let radiusSq = 0;

  for (let index = 0; index < positions.length; index += 3) {
    const dx = (positions[index] ?? 0) - center.x;
    const dy = (positions[index + 1] ?? 0) - center.y;
    const dz = (positions[index + 2] ?? 0) - center.z;
    radiusSq = Math.max(radiusSq, dx * dx + dy * dy + dz * dz);
  }

  return setGeometryBoundingSphere(geometry, center, Math.sqrt(radiusSq));
}

export function markAlwaysOnscreen<
  T extends Group | Mesh | Line | LineSegments | Points,
>(object: T) {
  object.frustumCulled = false;
  return object;
}

export function normalizeMilkdropPolygonSides(sides: number) {
  if (!Number.isFinite(sides)) {
    return 3;
  }
  return Math.min(MAX_MILKDROP_POLYGON_SIDES, Math.max(3, Math.round(sides)));
}

export function getUnitPolygonVertices(sides: number) {
  const safeSides = normalizeMilkdropPolygonSides(sides);
  return Array.from({ length: safeSides }, (_, index) => {
    const theta =
      (index / safeSides) * Math.PI * 2 + Math.PI / Math.max(3, safeSides);
    return new Vector2(Math.cos(theta), Math.sin(theta));
  });
}

export function getUnitPolygonFillGeometry(sides: number) {
  const safeSides = normalizeMilkdropPolygonSides(sides);
  const cached = polygonFillGeometryCache.get(safeSides);
  if (cached) {
    return cached;
  }

  const vertices = getUnitPolygonVertices(safeSides);
  const firstVertex = vertices[0] ?? new Vector2(1, 0);
  const fillShape = new Shape();
  fillShape.moveTo(firstVertex.x, firstVertex.y);
  vertices.slice(1).forEach((vertex) => fillShape.lineTo(vertex.x, vertex.y));
  fillShape.lineTo(firstVertex.x, firstVertex.y);

  const geometry = markSharedGeometry(new ShapeGeometry(fillShape));
  setSharedGeometryBounds(geometry, { radius: 1 });
  polygonFillGeometryCache.set(safeSides, geometry);
  return geometry;
}

export function getUnitPolygonOutlineGeometry(sides: number) {
  const safeSides = normalizeMilkdropPolygonSides(sides);
  const cached = polygonOutlineGeometryCache.get(`open:${safeSides}`);
  if (cached) {
    return cached;
  }

  const geometry = markSharedGeometry(new BufferGeometry());
  const positions = getUnitPolygonVertices(safeSides).flatMap((vertex) => [
    vertex.x,
    vertex.y,
    0,
  ]);
  ensureGeometryPositions(geometry, positions);
  polygonOutlineGeometryCache.set(`open:${safeSides}`, geometry);
  return geometry;
}

export function getUnitPolygonClosedLineGeometry(sides: number) {
  const safeSides = normalizeMilkdropPolygonSides(sides);
  const cached = polygonOutlineGeometryCache.get(`closed:${safeSides}`);
  if (cached) {
    return cached;
  }

  const geometry = markSharedGeometry(new BufferGeometry());
  const positions = closeLinePositions(
    getUnitPolygonVertices(safeSides).flatMap((vertex) => [
      vertex.x,
      vertex.y,
      0,
    ]),
  );
  ensureGeometryPositions(geometry, positions);
  polygonOutlineGeometryCache.set(`closed:${safeSides}`, geometry);
  return geometry;
}

export function clearSharedMilkdropGeometries() {
  disposeGeometry(BACKGROUND_GEOMETRY);
  for (const geometry of polygonFillGeometryCache.values()) {
    disposeGeometry(geometry);
  }
  polygonFillGeometryCache.clear();
  for (const geometry of polygonOutlineGeometryCache.values()) {
    disposeGeometry(geometry);
  }
  polygonOutlineGeometryCache.clear();
}

export function closeLinePositions<T extends ArrayLike<number>>(
  positions: T,
): T | number[] {
  if (positions.length < 6) {
    return positions;
  }
  const firstX = positions[0];
  const firstY = positions[1];
  const firstZ = positions[2];
  const lastIndex = positions.length - 3;
  if (
    positions[lastIndex] === firstX &&
    positions[lastIndex + 1] === firstY &&
    positions[lastIndex + 2] === firstZ
  ) {
    return positions;
  }
  return [...Array.from(positions), firstX, firstY, firstZ];
}

export function getWaveLinePositions(
  wave: MilkdropWaveVisual,
  behavior: MilkdropBackendBehavior,
) {
  return wave.closed && behavior.closeLinesManually
    ? closeLinePositions(wave.positions)
    : wave.positions;
}

export function getBorderLinePositions(
  border: MilkdropBorderVisual,
  z: number,
  behavior: MilkdropBackendBehavior,
) {
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const left = -1 + inset * 2;
  const right = 1 - inset * 2;
  const top = 1 - inset * 2;
  const bottom = -1 + inset * 2;
  const positions = [
    left,
    top,
    z,
    right,
    top,
    z,
    right,
    bottom,
    z,
    left,
    bottom,
    z,
  ];
  return behavior.closeLinesManually
    ? closeLinePositions(positions)
    : positions;
}

export function getShapeFillFallbackColor(shape: MilkdropShapeVisual) {
  if (!shape.secondaryColor) {
    return shape.color;
  }
  return {
    r: (shape.color.r + shape.secondaryColor.r) * 0.5,
    g: (shape.color.g + shape.secondaryColor.g) * 0.5,
    b: (shape.color.b + shape.secondaryColor.b) * 0.5,
    a: Math.max(shape.color.a ?? 0.4, shape.secondaryColor.a ?? 0),
  };
}

export function lerpNumber(previous: number, current: number, mix: number) {
  return previous + (current - previous) * mix;
}

export function isFeedbackCapableRenderer(
  renderer: RendererLike | null,
): renderer is RendererLike & {
  getSize: (target: Vector2) => Vector2;
  setRenderTarget: RendererSetRenderTarget;
} {
  return !!renderer && !!renderer.getSize && !!renderer.setRenderTarget;
}

export function setMaterialColor(
  material: LineBasicMaterial | MeshBasicMaterial | PointsMaterial,
  value: { r: number; g: number; b: number },
  opacity: number,
) {
  material.color.setRGB(value.r, value.g, value.b);
  material.opacity = opacity;
  material.transparent = opacity < 1 || material.blending === AdditiveBlending;
}

export function setMaterialBlendMode(
  material: Material | Material[],
  blendMode: 'subtractive' | 'multiplicative',
) {
  const candidates = Array.isArray(material) ? material : [material];
  for (const mat of candidates) {
    mat.blending = CustomBlending;
    mat.blendSrc = blendMode === 'multiplicative' ? DstColorFactor : OneFactor;
    mat.blendDst = blendMode === 'multiplicative' ? ZeroFactor : OneFactor;
    mat.blendEquation =
      blendMode === 'subtractive' ? ReverseSubtractEquation : AddEquation;
  }
}

export function applyBlendModeToGroup(
  group: Group,
  blendMode: 'subtractive' | 'multiplicative',
) {
  for (const child of group.children) {
    if ('material' in child) {
      setMaterialBlendMode(
        (child as { material: Material }).material,
        blendMode,
      );
    }
    if (
      'children' in child &&
      Array.isArray((child as Group).children) &&
      (child as Group).children.length > 0
    ) {
      applyBlendModeToGroup(child as Group, blendMode);
    }
  }
}

/**
 * Writes `data` into a dynamic float attribute, growing the underlying buffer
 * but never shrinking it, and returns the vertex count `data` occupies.
 *
 * The no-shrink rule is not a micro-optimisation — it is what keeps WebGPU
 * valid. Replacing the attribute changes `position.count`, which is what
 * `RenderObject.getDrawParameters()` derives the draw count from, but the
 * backend's uploaded GPUBuffer for that geometry is only refreshed on its own
 * schedule. For one frame the draw is issued with the new count against the
 * old, smaller buffer:
 *
 *   Vertex range (first: 0, count: 1555) requires a larger buffer (18660)
 *   than the bound buffer size (10932) of the vertex buffer at slot 0
 *
 * which invalidates the whole command buffer, so the frame is dropped too.
 * Keeping one monotonically-growing buffer per geometry makes the bound size
 * an upper bound on every draw range that can follow, so the mismatch cannot
 * occur regardless of upload timing.
 *
 * Preset transitions are where this bit: a blend renders the outgoing and
 * incoming preset into the same pooled geometries, so a wave whose sample
 * count differs between the two would reallocate on *every* frame of the
 * blend, alternating between the two lengths.
 */
export function ensureDynamicFloatAttribute(
  geometry: BufferGeometry,
  name: string,
  data: ArrayLike<number>,
  itemSize: number,
): number {
  const existing = geometry.getAttribute(name);
  if (
    existing instanceof Float32BufferAttribute &&
    existing.itemSize === itemSize &&
    existing.array.length >= data.length
  ) {
    (existing.array as Float32Array).set(data);
    existing.needsUpdate = true;
  } else {
    // Grow to exactly what is needed rather than doubling: these buffers reach
    // ~40k floats for a dense mesh, and the callers' lengths come from a small
    // set of preset-driven sizes, so they settle after the first few frames.
    const array = new Float32Array(Math.max(itemSize, data.length));
    array.set(data);
    const attribute = new Float32BufferAttribute(array, itemSize);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
  }
  return Math.floor(data.length / itemSize);
}

export function ensureGeometryPositions(
  geometry: BufferGeometry,
  positions: ArrayLike<number>,
) {
  const vertexCount = ensureDynamicFloatAttribute(
    geometry,
    'position',
    positions,
    3,
  );
  // The buffer may now be larger than this frame's data, so the draw range —
  // not the attribute length — is what bounds the draw. On an indexed geometry
  // the draw range counts indices rather than vertices, so a vertex count
  // would be the wrong unit; no current caller indexes, and this keeps a
  // future one from silently drawing the wrong range.
  if (geometry.getIndex() === null) {
    geometry.setDrawRange(0, vertexCount);
  }

  if (geometry.userData.skipDynamicBounds === true) {
    setGeometryBoundingSphere(geometry, new Vector3(0, 0, 0), Math.SQRT2 * 2.4);
    return;
  }
  setGeometryBoundsFromPositions(geometry, positions);
}

export function clearGroup(group: Group) {
  trimCountCache.delete(group);
  for (let index = group.children.length - 1; index >= 0; index -= 1) {
    const child = group.children[index];
    disposeObject(child);
    group.remove(child);
  }
}

export function disposeObject(object: { children?: unknown[] }) {
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

const trimCountCache = new WeakMap<Group, number>();

export function trimGroupChildren(group: Group, keepCount: number) {
  const prevCount = trimCountCache.get(group);
  if (prevCount === keepCount) {
    return;
  }
  trimCountCache.set(group, keepCount);
  for (let index = group.children.length - 1; index >= keepCount; index -= 1) {
    const child = group.children[index];
    disposeObject(child as { children?: unknown[] });
    group.remove(child);
  }
}

export function clearTrimCountCache(group: Group) {
  trimCountCache.delete(group);
}

export function withRenderOrder<T extends { renderOrder: number }>(
  object: T,
  renderOrder: number,
) {
  object.renderOrder = renderOrder;
  return object;
}

export function getMilkdropLayerRenderOrder(
  target:
    | 'background'
    | 'mesh'
    | 'main-wave'
    | 'custom-wave'
    | 'trails'
    | 'particle-field'
    | 'shapes'
    | 'borders'
    | 'motion-vectors'
    | 'blend-main-wave'
    | 'blend-custom-wave'
    | 'blend-particle-field'
    | 'blend-shapes'
    | 'blend-borders'
    | 'blend-motion-vectors',
) {
  switch (target) {
    case 'background':
      return 0;
    case 'mesh':
      return 10;
    case 'main-wave':
      return 20;
    case 'custom-wave':
      return 30;
    case 'trails':
      return 40;
    case 'particle-field':
      return 45;
    case 'shapes':
      return 50;
    case 'borders':
      return 60;
    case 'motion-vectors':
      return 70;
    case 'blend-main-wave':
      return 80;
    case 'blend-custom-wave':
      return 90;
    case 'blend-particle-field':
      return 95;
    case 'blend-shapes':
      return 100;
    case 'blend-borders':
      return 110;
    case 'blend-motion-vectors':
      return 120;
  }
}

export function getMilkdropPassRenderOrder(
  target:
    | 'main-wave'
    | 'custom-wave'
    | 'trails'
    | 'particle-field'
    | 'shapes'
    | 'borders'
    | 'motion-vectors'
    | 'blend-main-wave'
    | 'blend-custom-wave'
    | 'blend-particle-field'
    | 'blend-shapes'
    | 'blend-borders'
    | 'blend-motion-vectors',
  additive = false,
) {
  return getMilkdropLayerRenderOrder(target) + (additive ? 1 : 0);
}
