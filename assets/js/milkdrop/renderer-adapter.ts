import type {
  Camera,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  Texture,
} from 'three';
import {
  AdditiveBlending,
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  type Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Sphere,
  Vector2,
  Vector3,
} from 'three';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import {
  createBorderObject as createBorderObjectHelper,
  renderBorderGroup as renderBorderGroupHelper,
  syncBorderObject as syncBorderObjectHelper,
  updateBorderFill as updateBorderFillHelper,
  updateBorderLine as updateBorderLineHelper,
} from './renderer-helpers/border-renderer';
import { buildFeedbackCompositeState as buildFeedbackCompositeStateHelper } from './renderer-helpers/feedback-composite';
import { renderMesh as renderMeshHelper } from './renderer-helpers/mesh-renderer';
import { renderMotionVectors as renderMotionVectorsHelper } from './renderer-helpers/motion-vector-renderer';
import {
  syncInterpolatedProceduralCustomWaveObject,
  syncInterpolatedProceduralWaveObject,
  syncProceduralCustomWaveObject,
  syncProceduralWaveObject,
} from './renderer-helpers/procedural-wave-renderer';
import {
  createShapeObject as createShapeObjectHelper,
  renderShapeGroup as renderShapeGroupHelper,
  syncShapeFillMaterial as syncShapeFillMaterialHelper,
  syncShapeObject as syncShapeObjectHelper,
  syncShapeOutline as syncShapeOutlineHelper,
} from './renderer-helpers/shape-renderer';
import {
  renderLineVisualGroup as renderLineVisualGroupHelper,
  renderWaveGroup as renderWaveGroupHelper,
  syncLineObject as syncLineObjectHelper,
  syncWaveObject as syncWaveObjectHelper,
} from './renderer-helpers/wave-renderer';
import type {
  MilkdropBorderVisual,
  MilkdropColor,
  MilkdropCompiledPreset,
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
  MilkdropFeedbackSetRenderTarget,
  MilkdropGpuGeometryHints,
  MilkdropGpuInteractionTransform,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralWaveVisual,
  MilkdropRendererAdapter,
  MilkdropRenderPayload,
  MilkdropShapeVisual,
  MilkdropWaveVisual,
  MilkdropWebGpuDescriptorPlan,
} from './types';
import {
  applyMilkdropWebGpuOptimizationFlags,
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlags,
} from './webgpu-optimization-flags';

type RendererLike = {
  getSize?: (target: Vector2) => Vector2;
  render: (scene: Scene, camera: Camera) => void;
  setRenderTarget?: RendererSetRenderTarget;
};

type RendererSetRenderTarget = {
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
  webgpuOptimizationFlags?: MilkdropWebGpuOptimizationFlags;
};

export type MilkdropRendererBatcher = {
  attach: (root: Group) => void;
  dispose: () => void;
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
  ) => boolean;
  renderLineVisualGroup?: (
    target: 'trails' | 'motion-vectors' | 'blend-motion-vectors',
    group: Group,
    lines: Array<{
      positions: number[];
      color: MilkdropColor;
      alpha: number;
      additive?: boolean;
    }>,
    alphaMultiplier: number,
  ) => boolean;
};

export type FeedbackBackendProfile = {
  currentFrameBoost: number;
  feedbackSoftness: number;
  sceneResolutionScale: number;
  feedbackResolutionScale: number;
  samples: number;
};

export type MilkdropFeedbackManagerFactory = (
  width: number,
  height: number,
) => MilkdropFeedbackManager;

export type MilkdropBackendBehavior = {
  feedbackProfile: FeedbackBackendProfile;
  useHalfFloatFeedback: boolean;
  closeLinesManually: boolean;
  useLineLoopPrimitives: boolean;
  supportsShapeGradient: boolean;
  supportsFeedbackPass: boolean;
};

export const WEBGL_MILKDROP_BACKEND_BEHAVIOR: MilkdropBackendBehavior = {
  feedbackProfile: {
    currentFrameBoost: 0,
    feedbackSoftness: 0,
    sceneResolutionScale: 0.72,
    feedbackResolutionScale: 0.72,
    samples: 0,
  },
  useHalfFloatFeedback: false,
  closeLinesManually: false,
  useLineLoopPrimitives: true,
  supportsShapeGradient: true,
  supportsFeedbackPass: true,
};

export const WEBGPU_MILKDROP_BACKEND_BEHAVIOR: MilkdropBackendBehavior = {
  feedbackProfile: {
    currentFrameBoost: 0.1,
    feedbackSoftness: 0.65,
    sceneResolutionScale: 1,
    feedbackResolutionScale: 0.85,
    samples: 0,
  },
  useHalfFloatFeedback: true,
  closeLinesManually: true,
  useLineLoopPrimitives: false,
  supportsShapeGradient: true,
  supportsFeedbackPass: true,
};

const SHARED_GEOMETRY_FLAG = 'milkdropSharedGeometry';
const BACKGROUND_GEOMETRY = markSharedGeometry(new PlaneGeometry(6.4, 6.4));
const polygonFillGeometryCache = new Map<number, ShapeGeometry>();
const polygonOutlineGeometryCache = new Map<string, BufferGeometry>();

function getShaderTextureSourceId(source: string) {
  switch (source) {
    case 'noise':
    case 'perlin':
      return 1;
    case 'simplex':
      return 2;
    case 'voronoi':
      return 3;
    case 'aura':
      return 4;
    case 'caustics':
      return 5;
    case 'pattern':
      return 6;
    case 'fractal':
      return 7;
    default:
      return 0;
  }
}

function getShaderTextureBlendModeId(mode: string) {
  switch (mode) {
    case 'replace':
      return 1;
    case 'mix':
      return 2;
    case 'add':
      return 3;
    case 'multiply':
      return 4;
    default:
      return 0;
  }
}

function getShaderSampleDimensionId(dimension: '2d' | '3d') {
  return dimension === '3d' ? 1 : 0;
}

export function getFeedbackBackendProfile(
  backend: 'webgl' | 'webgpu',
): FeedbackBackendProfile {
  return backend === 'webgpu'
    ? WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile
    : WEBGL_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile;
}

function markSharedGeometry<T extends BufferGeometry>(geometry: T) {
  geometry.userData[SHARED_GEOMETRY_FLAG] = true;
  return geometry;
}

function isSharedGeometry(geometry: BufferGeometry) {
  return geometry.userData[SHARED_GEOMETRY_FLAG] === true;
}

function setGeometryBoundingSphere(
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

function setSharedGeometryBounds(
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

function setGeometryBoundsFromPositions(
  geometry: BufferGeometry,
  positions: number[],
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

function markAlwaysOnscreen<
  T extends Group | Mesh | Line | LineSegments | Points,
>(object: T) {
  object.frustumCulled = false;
  return object;
}

function getUnitPolygonVertices(sides: number) {
  const safeSides = Math.max(3, Math.round(sides));
  return Array.from({ length: safeSides }, (_, index) => {
    const theta =
      (index / safeSides) * Math.PI * 2 + Math.PI / Math.max(3, safeSides);
    return new Vector2(Math.cos(theta), Math.sin(theta));
  });
}

function getUnitPolygonFillGeometry(sides: number) {
  const safeSides = Math.max(3, Math.round(sides));
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

function getUnitPolygonOutlineGeometry(sides: number) {
  const safeSides = Math.max(3, Math.round(sides));
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

function getUnitPolygonClosedLineGeometry(sides: number) {
  const safeSides = Math.max(3, Math.round(sides));
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

function closeLinePositions(positions: number[]) {
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
  return [...positions, firstX, firstY, firstZ];
}

function getWaveLinePositions(
  wave: MilkdropWaveVisual,
  behavior: MilkdropBackendBehavior,
) {
  return wave.closed && behavior.closeLinesManually
    ? closeLinePositions(wave.positions)
    : wave.positions;
}

function getBorderLinePositions(
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

function getShapeFillFallbackColor(shape: MilkdropShapeVisual) {
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

function lerpNumber(previous: number, current: number, mix: number) {
  return previous + (current - previous) * mix;
}

function lerpColor(
  previousColor: MilkdropColor,
  currentColor: MilkdropColor,
  mix: number,
): MilkdropColor {
  return {
    r: lerpNumber(previousColor.r, currentColor.r, mix),
    g: lerpNumber(previousColor.g, currentColor.g, mix),
    b: lerpNumber(previousColor.b, currentColor.b, mix),
    ...(previousColor.a !== undefined || currentColor.a !== undefined
      ? {
          a: lerpNumber(previousColor.a ?? 0, currentColor.a ?? 0, mix),
        }
      : {}),
  };
}

function interpolateShapeVisual(
  previousShape: MilkdropShapeVisual,
  currentShape: MilkdropShapeVisual,
  mix: number,
): MilkdropShapeVisual {
  return {
    ...currentShape,
    x: lerpNumber(previousShape.x, currentShape.x, mix),
    y: lerpNumber(previousShape.y, currentShape.y, mix),
    radius: lerpNumber(previousShape.radius, currentShape.radius, mix),
    rotation: lerpNumber(previousShape.rotation, currentShape.rotation, mix),
    textured: previousShape.textured || currentShape.textured,
    textureZoom: lerpNumber(
      previousShape.textureZoom,
      currentShape.textureZoom,
      mix,
    ),
    textureAngle: lerpNumber(
      previousShape.textureAngle,
      currentShape.textureAngle,
      mix,
    ),
    color: lerpColor(previousShape.color, currentShape.color, mix),
    secondaryColor:
      previousShape.secondaryColor || currentShape.secondaryColor
        ? lerpColor(
            previousShape.secondaryColor ?? previousShape.color,
            currentShape.secondaryColor ?? currentShape.color,
            mix,
          )
        : null,
    borderColor: lerpColor(
      previousShape.borderColor,
      currentShape.borderColor,
      mix,
    ),
    additive: previousShape.additive || currentShape.additive,
    thickOutline: previousShape.thickOutline || currentShape.thickOutline,
  };
}

function isFeedbackCapableRenderer(
  renderer: RendererLike | null,
): renderer is RendererLike & {
  getSize: (target: Vector2) => Vector2;
  setRenderTarget: RendererSetRenderTarget;
} {
  return !!renderer && !!renderer.getSize && !!renderer.setRenderTarget;
}

function setMaterialColor(
  material: LineBasicMaterial | MeshBasicMaterial | PointsMaterial,
  value: { r: number; g: number; b: number },
  opacity: number,
) {
  material.color.setRGB(value.r, value.g, value.b);
  material.opacity = opacity;
  material.transparent = opacity < 1 || material.blending === AdditiveBlending;
}

function ensureGeometryPositions(
  geometry: BufferGeometry,
  positions: number[],
) {
  const existing = geometry.getAttribute('position');
  if (
    existing instanceof Float32BufferAttribute &&
    existing.itemSize === 3 &&
    existing.array.length === positions.length
  ) {
    existing.array.set(positions);
    existing.needsUpdate = true;
  } else {
    const attribute = new Float32BufferAttribute(positions, 3);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
  }
  if (geometry.userData.skipDynamicBounds === true) {
    setGeometryBoundingSphere(geometry, new Vector3(0, 0, 0), Math.SQRT2 * 2.4);
    return;
  }
  setGeometryBoundsFromPositions(geometry, positions);
}

function clearGroup(group: Group) {
  for (let index = group.children.length - 1; index >= 0; index -= 1) {
    const child = group.children[index];
    disposeObject(child);
    group.remove(child);
  }
}

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

function trimGroupChildren(group: Group, keepCount: number) {
  for (let index = group.children.length - 1; index >= keepCount; index -= 1) {
    const child = group.children[index];
    disposeObject(child as { children?: unknown[] });
    group.remove(child);
  }
}

class ThreeMilkdropAdapter implements MilkdropRendererAdapter {
  readonly backend: 'webgl' | 'webgpu';
  private readonly behavior: MilkdropBackendBehavior;
  private readonly createFeedbackManager: MilkdropFeedbackManagerFactory | null;
  private readonly batcher: MilkdropRendererBatcher | null;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly renderer: RendererLike | null;
  private readonly root = new Group();
  private readonly background = markAlwaysOnscreen(
    new Mesh(
      BACKGROUND_GEOMETRY,
      new MeshBasicMaterial({
        color: 0x000000,
        transparent: false,
        opacity: 1,
        depthWrite: true,
        depthTest: false,
      }),
    ),
  );
  private readonly meshLines: LineSegments<
    BufferGeometry,
    LineBasicMaterial | ShaderMaterial
  > = markAlwaysOnscreen(
    new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({
        color: 0x4d66f2,
        transparent: true,
        opacity: 0.24,
      }),
    ),
  );
  private readonly mainWaveGroup = new Group();
  private readonly customWaveGroup = new Group();
  private readonly trailGroup = new Group();
  private readonly shapesGroup = new Group();
  private readonly borderGroup = markAlwaysOnscreen(new Group());
  private readonly motionVectorGroup = markAlwaysOnscreen(new Group());
  private readonly motionVectorCpuGroup = markAlwaysOnscreen(new Group());
  private readonly proceduralMotionVectors: LineSegments<
    BufferGeometry,
    LineBasicMaterial | ShaderMaterial
  > = markAlwaysOnscreen(
    new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
      }),
    ),
  );
  private readonly blendWaveGroup = new Group();
  private readonly blendCustomWaveGroup = new Group();
  private readonly blendShapeGroup = new Group();
  private readonly blendBorderGroup = markAlwaysOnscreen(new Group());
  private readonly blendMotionVectorGroup = markAlwaysOnscreen(new Group());
  private readonly blendMotionVectorCpuGroup = markAlwaysOnscreen(new Group());
  private readonly blendProceduralMotionVectors: LineSegments<
    BufferGeometry,
    LineBasicMaterial | ShaderMaterial
  > = markAlwaysOnscreen(
    new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.35,
      }),
    ),
  );
  private readonly feedback: MilkdropFeedbackManager | null;
  private webgpuDescriptorPlan: MilkdropWebGpuDescriptorPlan | null = null;
  private readonly webgpuOptimizationFlags: MilkdropWebGpuOptimizationFlags;

  constructor({
    scene,
    camera,
    renderer,
    backend,
    behavior,
    createFeedbackManager,
    batcher,
    webgpuOptimizationFlags = DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  }: {
    scene: Scene;
    camera: Camera;
    renderer: RendererLike | null;
    backend: 'webgl' | 'webgpu';
    behavior: MilkdropBackendBehavior;
    createFeedbackManager: MilkdropFeedbackManagerFactory | null;
    batcher: MilkdropRendererBatcher | null;
    webgpuOptimizationFlags?: MilkdropWebGpuOptimizationFlags;
  }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.backend = backend;
    this.behavior = behavior;
    this.createFeedbackManager = createFeedbackManager;
    this.batcher = batcher;
    this.webgpuOptimizationFlags = { ...webgpuOptimizationFlags };
    this.root.frustumCulled = false;
    this.meshLines.geometry.userData.skipDynamicBounds = true;
    this.proceduralMotionVectors.geometry.userData.skipDynamicBounds = true;
    this.blendProceduralMotionVectors.geometry.userData.skipDynamicBounds = true;

    this.background.position.z = -1.2;
    this.meshLines.position.z = -0.3;
    this.root.add(this.background);
    this.root.add(this.meshLines);
    this.root.add(this.mainWaveGroup);
    this.root.add(this.customWaveGroup);
    this.root.add(this.trailGroup);
    this.root.add(this.shapesGroup);
    this.root.add(this.borderGroup);
    this.motionVectorGroup.add(this.motionVectorCpuGroup);
    this.proceduralMotionVectors.visible = false;
    this.motionVectorGroup.add(this.proceduralMotionVectors);
    this.root.add(this.motionVectorGroup);
    this.root.add(this.blendWaveGroup);
    this.root.add(this.blendCustomWaveGroup);
    this.root.add(this.blendShapeGroup);
    this.root.add(this.blendBorderGroup);
    this.blendMotionVectorGroup.add(this.blendMotionVectorCpuGroup);
    this.blendProceduralMotionVectors.visible = false;
    this.blendMotionVectorGroup.add(this.blendProceduralMotionVectors);
    this.root.add(this.blendMotionVectorGroup);
    this.batcher?.attach(this.root);

    if (
      this.behavior.supportsFeedbackPass &&
      isFeedbackCapableRenderer(renderer) &&
      this.createFeedbackManager
    ) {
      const size = renderer.getSize(new Vector2());
      this.feedback = this.createFeedbackManager(
        Math.max(1, Math.round(size.x)),
        Math.max(1, Math.round(size.y)),
      );
    } else {
      this.feedback = null;
    }
  }

  attach() {
    if (!this.scene.children.includes(this.root)) {
      this.scene.add(this.root);
    }
  }

  setPreset(preset: MilkdropCompiledPreset) {
    this.webgpuDescriptorPlan =
      this.backend === 'webgpu'
        ? applyMilkdropWebGpuOptimizationFlags(
            preset.ir.compatibility.gpuDescriptorPlans.webgpu,
            this.webgpuOptimizationFlags,
          )
        : null;
  }

  assessSupport(preset: MilkdropCompiledPreset) {
    return preset.ir.compatibility.backends[this.backend];
  }

  resize(width: number, height: number) {
    this.feedback?.resize(width, height);
  }

  setAdaptiveQuality(
    multipliers: Partial<{
      feedbackResolutionMultiplier: number;
    }>,
  ) {
    this.feedback?.setAdaptiveQuality?.(multipliers);
  }

  private renderWaveGroup(
    target:
      | 'main-wave'
      | 'custom-wave'
      | 'blend-main-wave'
      | 'blend-custom-wave',
    group: Group,
    waves: MilkdropWaveVisual[],
    alphaMultiplier = 1,
  ) {
    return renderWaveGroupHelper({
      target,
      group,
      waves,
      alphaMultiplier,
      batcher: this.batcher,
      clearGroup,
      trimGroupChildren,
      syncWaveObject: (existing, wave, nextAlphaMultiplier) =>
        syncWaveObjectHelper(
          existing,
          wave,
          this.behavior,
          {
            disposeObject,
            ensureGeometryPositions,
            getWaveLinePositions,
            setMaterialColor,
          },
          nextAlphaMultiplier,
        ),
    });
  }

  private renderProceduralWaveGroup(
    target: 'main-wave' | 'trail-waves',
    group: Group,
    waves: MilkdropProceduralWaveVisual[],
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    if (this.batcher?.renderProceduralWaveGroup?.(target, group, waves)) {
      clearGroup(group);
      return;
    }
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as MilkdropProceduralWaveVisual;
      const existing = group.children[index] as Line | undefined;
      const synced = syncProceduralWaveObject(existing, wave, interaction);
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderProceduralCustomWaveGroup(
    group: Group,
    waves: MilkdropProceduralCustomWaveVisual[],
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    if (this.batcher?.renderProceduralCustomWaveGroup?.(group, waves)) {
      clearGroup(group);
      return;
    }
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as MilkdropProceduralCustomWaveVisual;
      const existing = group.children[index] as Line | undefined;
      const synced = syncProceduralCustomWaveObject(
        existing,
        wave,
        interaction,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderInterpolatedProceduralWaveGroup(
    group: Group,
    waves: Array<{
      previous: MilkdropProceduralWaveVisual;
      current: MilkdropProceduralWaveVisual;
    }>,
    mix: number,
    alphaMultiplier: number,
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as {
        previous: MilkdropProceduralWaveVisual;
        current: MilkdropProceduralWaveVisual;
      };
      const existing = group.children[index] as Line | undefined;
      const synced = syncInterpolatedProceduralWaveObject(
        existing,
        wave.previous,
        wave.current,
        mix,
        alphaMultiplier,
        interaction,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderInterpolatedProceduralCustomWaveGroup(
    group: Group,
    waves: Array<{
      previous: MilkdropProceduralCustomWaveVisual;
      current: MilkdropProceduralCustomWaveVisual;
    }>,
    mix: number,
    alphaMultiplier: number,
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as {
        previous: MilkdropProceduralCustomWaveVisual;
        current: MilkdropProceduralCustomWaveVisual;
      };
      const existing = group.children[index] as Line | undefined;
      const synced = syncInterpolatedProceduralCustomWaveObject(
        existing,
        wave.previous,
        wave.current,
        mix,
        alphaMultiplier,
        interaction,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, waves.length);
  }

  private renderShapeGroup(
    target: 'shapes' | 'blend-shapes',
    group: Group,
    shapes: MilkdropShapeVisual[],
    alphaMultiplier = 1,
  ) {
    return renderShapeGroupHelper({
      target,
      group,
      shapes,
      alphaMultiplier,
      batcher: this.batcher,
      clearGroup,
      trimGroupChildren,
      syncShapeObject: (existing, shape, nextAlphaMultiplier) =>
        syncShapeObjectHelper(
          existing,
          shape,
          this.behavior,
          {
            disposeObject,
            createShapeObject: (nextShape, createAlphaMultiplier) =>
              createShapeObjectHelper(
                nextShape,
                this.behavior,
                {
                  getShapeFillFallbackColor,
                  getShapeTexture: () =>
                    (this.feedback?.getShapeTexture?.() as Texture | null) ??
                    null,
                  getUnitPolygonFillGeometry,
                  getUnitPolygonOutlineGeometry,
                  getUnitPolygonClosedLineGeometry,
                },
                createAlphaMultiplier,
              ),
            syncShapeFillMaterial: (mesh, nextShape, syncAlphaMultiplier) =>
              syncShapeFillMaterialHelper(
                mesh,
                nextShape,
                this.behavior,
                {
                  disposeMaterial,
                  getShapeFillFallbackColor,
                  getShapeTexture: () =>
                    (this.feedback?.getShapeTexture?.() as Texture | null) ??
                    null,
                  setMaterialColor,
                },
                syncAlphaMultiplier,
              ),
            syncShapeOutline: (
              object,
              nextShape,
              syncAlphaMultiplier,
              opacity,
            ) =>
              syncShapeOutlineHelper(
                object,
                nextShape,
                this.behavior,
                {
                  getUnitPolygonOutlineGeometry,
                  getUnitPolygonClosedLineGeometry,
                  setMaterialColor,
                },
                syncAlphaMultiplier,
                opacity,
              ),
            getUnitPolygonFillGeometry,
          },
          nextAlphaMultiplier,
        ),
    });
  }

  private renderBorderGroup(
    target: 'borders' | 'blend-borders',
    group: Group,
    borders: MilkdropBorderVisual[],
    alphaMultiplier = 1,
  ) {
    return renderBorderGroupHelper({
      target,
      group,
      borders,
      alphaMultiplier,
      batcher: this.batcher,
      clearGroup,
      trimGroupChildren,
      syncBorderObject: (existing, border, nextAlphaMultiplier) =>
        syncBorderObjectHelper(
          existing,
          border,
          this.behavior,
          {
            disposeObject,
            createBorderObject: (nextBorder, createAlphaMultiplier) =>
              createBorderObjectHelper(
                nextBorder,
                this.behavior,
                {
                  ensureGeometryPositions,
                  getBorderLinePositions,
                  markAlwaysOnscreen,
                  setMaterialColor,
                },
                createAlphaMultiplier,
              ),
            updateBorderFill: (object, nextBorder, syncAlphaMultiplier) =>
              updateBorderFillHelper(
                object,
                nextBorder,
                {
                  isSharedGeometry,
                  setMaterialColor,
                },
                syncAlphaMultiplier,
              ),
            updateBorderLine: (object, nextBorder, syncAlphaMultiplier) =>
              updateBorderLineHelper(
                object,
                nextBorder,
                this.behavior,
                {
                  ensureGeometryPositions,
                  getBorderLinePositions,
                  setMaterialColor,
                },
                syncAlphaMultiplier,
              ),
          },
          nextAlphaMultiplier,
        ),
    });
  }

  private renderInterpolatedShapeGroup(
    group: Group,
    previousShapes: MilkdropShapeVisual[],
    currentShapes: MilkdropShapeVisual[],
    mix: number,
    alphaMultiplier = 1,
  ) {
    const interpolatedShapes = currentShapes.map((shape, index) => {
      const previousShape = previousShapes[index];
      return previousShape
        ? interpolateShapeVisual(previousShape, shape, mix)
        : shape;
    });
    this.renderShapeGroup(
      'blend-shapes',
      group,
      interpolatedShapes,
      alphaMultiplier,
    );
  }

  private renderLineVisualGroup(
    target: 'trails' | 'motion-vectors' | 'blend-motion-vectors',
    group: Group,
    lines: Array<{
      positions: number[];
      color: MilkdropColor;
      alpha: number;
      additive?: boolean;
    }>,
    alphaMultiplier = 1,
  ) {
    return renderLineVisualGroupHelper({
      target,
      group,
      lines,
      alphaMultiplier,
      batcher: this.batcher,
      clearGroup,
      trimGroupChildren,
      syncLineObject: (existing, line, nextAlphaMultiplier) =>
        syncLineObjectHelper(existing, line, nextAlphaMultiplier, {
          disposeObject,
          ensureGeometryPositions,
          markAlwaysOnscreen,
          setMaterialColor,
        }),
    });
  }

  private renderMesh(
    mesh: MilkdropRenderPayload['frameState']['mesh'],
    gpuGeometry: MilkdropGpuGeometryHints,
    signals: MilkdropRenderPayload['frameState']['signals'],
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    return renderMeshHelper({
      backend: this.backend,
      meshLines: this.meshLines,
      mesh,
      gpuGeometry,
      signals,
      webgpuDescriptorPlan: this.webgpuDescriptorPlan,
      interaction,
      disposeMaterial,
      ensureGeometryPositions,
      setMaterialColor,
    });
  }

  private renderMotionVectors(
    payload: MilkdropRenderPayload['frameState'],
    alphaMultiplier = 1,
    previousFrame?: MilkdropRenderPayload['frameState'] | null,
    blendMix = 1,
    cpuGroup: Group = this.motionVectorCpuGroup,
    proceduralObject: LineSegments<
      BufferGeometry,
      LineBasicMaterial | ShaderMaterial
    > = this.proceduralMotionVectors,
  ) {
    return renderMotionVectorsHelper({
      backend: this.backend,
      webgpuDescriptorPlanProceduralMotionVectors:
        this.webgpuDescriptorPlan?.proceduralMotionVectors ?? null,
      payload,
      alphaMultiplier,
      previousFrame,
      blendMix,
      cpuGroup,
      proceduralObject,
      clearGroup,
      renderLineVisualGroup: (target, group, lines, nextAlphaMultiplier) =>
        this.renderLineVisualGroup(target, group, lines, nextAlphaMultiplier),
    });
  }

  private buildFeedbackCompositeState(
    frameState: MilkdropRenderPayload['frameState'],
  ): MilkdropFeedbackCompositeState {
    return buildFeedbackCompositeStateHelper({
      frameState,
      backend: this.backend,
      directFeedbackShaders: this.webgpuOptimizationFlags.directFeedbackShaders,
      webgpuFeedbackPlanShaderExecution:
        this.webgpuDescriptorPlan?.feedback?.shaderExecution,
      getShaderTextureSourceId,
      getShaderTextureBlendModeId,
      getShaderSampleDimensionId,
    });
  }

  render(payload: MilkdropRenderPayload) {
    const backgroundMaterial = this.background.material as MeshBasicMaterial;
    setMaterialColor(backgroundMaterial, payload.frameState.background, 1);

    this.renderMesh(
      payload.frameState.mesh,
      payload.frameState.gpuGeometry,
      payload.frameState.signals,
      payload.frameState.interaction?.mesh,
    );

    const proceduralWavePlans =
      this.webgpuDescriptorPlan?.proceduralWaves ?? [];
    const canUseProceduralMainWave =
      this.backend === 'webgpu' &&
      proceduralWavePlans.some((plan) => plan.target === 'main-wave');
    const canUseProceduralCustomWaves =
      this.backend === 'webgpu' &&
      proceduralWavePlans.some((plan) => plan.target === 'custom-wave');
    const canUseProceduralTrailWaves =
      this.backend === 'webgpu' &&
      proceduralWavePlans.some((plan) => plan.target === 'trail-waves');

    if (canUseProceduralMainWave && payload.frameState.gpuGeometry.mainWave) {
      this.renderProceduralWaveGroup('main-wave', this.mainWaveGroup, [
        payload.frameState.gpuGeometry.mainWave,
      ]);
    } else {
      this.renderWaveGroup('main-wave', this.mainWaveGroup, [
        payload.frameState.mainWave,
      ]);
    }
    if (
      canUseProceduralCustomWaves &&
      payload.frameState.gpuGeometry.customWaves.length > 0
    ) {
      this.renderProceduralCustomWaveGroup(
        this.customWaveGroup,
        payload.frameState.gpuGeometry.customWaves,
        payload.frameState.interaction?.waves,
      );
    } else {
      this.renderWaveGroup(
        'custom-wave',
        this.customWaveGroup,
        payload.frameState.customWaves,
      );
    }
    if (
      canUseProceduralTrailWaves &&
      payload.frameState.gpuGeometry.trailWaves.length > 0
    ) {
      this.renderProceduralWaveGroup(
        'trail-waves',
        this.trailGroup,
        payload.frameState.gpuGeometry.trailWaves,
        payload.frameState.interaction?.waves,
      );
    } else {
      this.renderLineVisualGroup(
        'trails',
        this.trailGroup,
        payload.frameState.trails,
      );
    }
    this.renderShapeGroup(
      'shapes',
      this.shapesGroup,
      payload.frameState.shapes,
    );
    this.renderBorderGroup(
      'borders',
      this.borderGroup,
      payload.frameState.borders,
    );
    this.renderMotionVectors(payload.frameState);

    const blend = payload.blendState;
    if (blend?.mode === 'gpu') {
      const previousFrame = blend.previousFrame;
      const blendMix = 1 - blend.alpha;
      if (
        canUseProceduralMainWave &&
        previousFrame.gpuGeometry.mainWave &&
        payload.frameState.gpuGeometry.mainWave
      ) {
        this.renderInterpolatedProceduralWaveGroup(
          this.blendWaveGroup,
          [
            {
              previous: previousFrame.gpuGeometry.mainWave,
              current: payload.frameState.gpuGeometry.mainWave,
            },
          ],
          blendMix,
          blend.alpha,
          {
            offsetX: lerpNumber(
              previousFrame.interaction?.waves.offsetX ?? 0,
              payload.frameState.interaction?.waves.offsetX ?? 0,
              blendMix,
            ),
            offsetY: lerpNumber(
              previousFrame.interaction?.waves.offsetY ?? 0,
              payload.frameState.interaction?.waves.offsetY ?? 0,
              blendMix,
            ),
            rotation: lerpNumber(
              previousFrame.interaction?.waves.rotation ?? 0,
              payload.frameState.interaction?.waves.rotation ?? 0,
              blendMix,
            ),
            scale: lerpNumber(
              previousFrame.interaction?.waves.scale ?? 1,
              payload.frameState.interaction?.waves.scale ?? 1,
              blendMix,
            ),
            alphaMultiplier: lerpNumber(
              previousFrame.interaction?.waves.alphaMultiplier ?? 1,
              payload.frameState.interaction?.waves.alphaMultiplier ?? 1,
              blendMix,
            ),
          },
        );
      } else {
        this.renderWaveGroup(
          'blend-main-wave',
          this.blendWaveGroup,
          [previousFrame.mainWave],
          blend.alpha,
        );
      }
      if (
        canUseProceduralCustomWaves &&
        previousFrame.gpuGeometry.customWaves.length > 0 &&
        payload.frameState.gpuGeometry.customWaves.length > 0
      ) {
        const interpolatedCustomWaves = previousFrame.gpuGeometry.customWaves
          .map((wave, index) => {
            const current = payload.frameState.gpuGeometry.customWaves[index];
            return current ? { previous: wave, current } : null;
          })
          .filter((wave): wave is NonNullable<typeof wave> => wave !== null);
        this.renderInterpolatedProceduralCustomWaveGroup(
          this.blendCustomWaveGroup,
          interpolatedCustomWaves,
          blendMix,
          blend.alpha,
          {
            offsetX: lerpNumber(
              previousFrame.interaction?.waves.offsetX ?? 0,
              payload.frameState.interaction?.waves.offsetX ?? 0,
              blendMix,
            ),
            offsetY: lerpNumber(
              previousFrame.interaction?.waves.offsetY ?? 0,
              payload.frameState.interaction?.waves.offsetY ?? 0,
              blendMix,
            ),
            rotation: lerpNumber(
              previousFrame.interaction?.waves.rotation ?? 0,
              payload.frameState.interaction?.waves.rotation ?? 0,
              blendMix,
            ),
            scale: lerpNumber(
              previousFrame.interaction?.waves.scale ?? 1,
              payload.frameState.interaction?.waves.scale ?? 1,
              blendMix,
            ),
            alphaMultiplier: lerpNumber(
              previousFrame.interaction?.waves.alphaMultiplier ?? 1,
              payload.frameState.interaction?.waves.alphaMultiplier ?? 1,
              blendMix,
            ),
          },
        );
      } else {
        this.renderWaveGroup(
          'blend-custom-wave',
          this.blendCustomWaveGroup,
          previousFrame.customWaves,
          blend.alpha,
        );
      }
      this.renderInterpolatedShapeGroup(
        this.blendShapeGroup,
        previousFrame.shapes,
        payload.frameState.shapes,
        blendMix,
        blend.alpha,
      );
      this.renderBorderGroup(
        'blend-borders',
        this.blendBorderGroup,
        previousFrame.borders,
        blend.alpha,
      );
      this.renderMotionVectors(
        payload.frameState,
        blend.alpha,
        previousFrame,
        blendMix,
        this.blendMotionVectorCpuGroup,
        this.blendProceduralMotionVectors,
      );
      if (
        !this.blendProceduralMotionVectors.visible &&
        previousFrame.motionVectors.length === 0
      ) {
        clearGroup(this.blendMotionVectorCpuGroup);
      }
    } else {
      this.renderWaveGroup(
        'blend-main-wave',
        this.blendWaveGroup,
        blend?.mode === 'cpu' ? [blend.mainWave] : [],
        blend?.alpha ?? 0,
      );
      this.renderWaveGroup(
        'blend-custom-wave',
        this.blendCustomWaveGroup,
        blend?.mode === 'cpu' ? blend.customWaves : [],
        blend?.alpha ?? 0,
      );
      this.renderShapeGroup(
        'blend-shapes',
        this.blendShapeGroup,
        blend?.mode === 'cpu' ? blend.shapes : [],
        blend?.alpha ?? 0,
      );
      this.renderBorderGroup(
        'blend-borders',
        this.blendBorderGroup,
        blend?.mode === 'cpu' ? blend.borders : [],
        blend?.alpha ?? 0,
      );
      this.blendProceduralMotionVectors.visible = false;
      this.renderLineVisualGroup(
        'blend-motion-vectors',
        this.blendMotionVectorCpuGroup,
        blend?.mode === 'cpu' ? blend.motionVectors : [],
        blend?.alpha ?? 0,
      );
    }

    if (
      !isFeedbackCapableRenderer(this.renderer) ||
      !this.feedback ||
      !payload.frameState.post.shaderEnabled
    ) {
      return false;
    }

    this.feedback.applyCompositeState(
      this.buildFeedbackCompositeState(payload.frameState),
    );
    return this.feedback.render(this.renderer, this.scene, this.camera);
  }

  dispose() {
    clearGroup(this.mainWaveGroup);
    clearGroup(this.customWaveGroup);
    clearGroup(this.trailGroup);
    clearGroup(this.shapesGroup);
    clearGroup(this.borderGroup);
    clearGroup(this.motionVectorGroup);
    clearGroup(this.blendWaveGroup);
    clearGroup(this.blendCustomWaveGroup);
    clearGroup(this.blendShapeGroup);
    clearGroup(this.blendBorderGroup);
    clearGroup(this.blendMotionVectorGroup);
    if (!isSharedGeometry(this.background.geometry)) {
      disposeGeometry(this.background.geometry);
    }
    disposeMaterial(this.background.material);
    if (!isSharedGeometry(this.meshLines.geometry)) {
      disposeGeometry(this.meshLines.geometry);
    }
    disposeMaterial(this.meshLines.material);
    this.batcher?.dispose();
    this.feedback?.dispose();
    this.scene.remove(this.root);
  }
}

export function createMilkdropRendererAdapterCore({
  scene,
  camera,
  renderer,
  backend,
  preset,
  behavior,
  createFeedbackManager,
  batcher,
  webgpuOptimizationFlags = DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
}: MilkdropRendererAdapterConfig) {
  const adapter = new ThreeMilkdropAdapter({
    scene,
    camera,
    renderer: renderer ?? null,
    backend,
    behavior:
      behavior ??
      (backend === 'webgpu'
        ? WEBGPU_MILKDROP_BACKEND_BEHAVIOR
        : WEBGL_MILKDROP_BACKEND_BEHAVIOR),
    createFeedbackManager: createFeedbackManager ?? null,
    batcher: batcher ?? null,
    webgpuOptimizationFlags,
  });
  if (preset) {
    adapter.setPreset(preset);
  }
  return adapter;
}

export const createMilkdropRendererAdapter = createMilkdropRendererAdapterCore;

export const __milkdropRendererAdapterTestUtils = {
  syncInterpolatedProceduralWaveObject,
  syncInterpolatedProceduralCustomWaveObject,
};
