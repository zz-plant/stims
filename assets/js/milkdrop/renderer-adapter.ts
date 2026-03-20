import type { Camera, Scene } from 'three';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineLoop,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Path,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Sphere,
  Vector2,
  Vector3,
  type WebGLRenderTarget,
} from 'three';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import type { MilkdropFeedbackManager } from './feedback-manager-shared.ts';
import type {
  MilkdropBorderVisual,
  MilkdropCompiledPreset,
  MilkdropGpuGeometryHints,
  MilkdropRendererAdapter,
  MilkdropRenderPayload,
  MilkdropShapeVisual,
  MilkdropWaveVisual,
} from './types';

type RendererLike = {
  getSize?: (target: Vector2) => Vector2;
  render: (scene: Scene, camera: Camera) => void;
  setRenderTarget?: RendererSetRenderTarget;
};

type RendererSetRenderTarget = {
  bivarianceHack(target: WebGLRenderTarget | null): void;
}['bivarianceHack'];

export type MilkdropRendererAdapterConfig = {
  scene: Scene;
  camera: Camera;
  renderer?: RendererLike | null;
  backend: 'webgl' | 'webgpu';
  behavior?: MilkdropBackendBehavior;
  createFeedbackManager?: MilkdropFeedbackManagerFactory;
};

export type FeedbackBackendProfile = {
  currentFrameBoost: number;
  feedbackSoftness: number;
  resolutionScale: number;
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
};

export const WEBGL_MILKDROP_BACKEND_BEHAVIOR: MilkdropBackendBehavior = {
  feedbackProfile: {
    currentFrameBoost: 0,
    feedbackSoftness: 0,
    resolutionScale: 0.85,
    samples: 0,
  },
  useHalfFloatFeedback: false,
  closeLinesManually: false,
  useLineLoopPrimitives: true,
  supportsShapeGradient: true,
};

export const WEBGPU_MILKDROP_BACKEND_BEHAVIOR: MilkdropBackendBehavior = {
  feedbackProfile: {
    currentFrameBoost: 0.1,
    feedbackSoftness: 0.65,
    resolutionScale: 1,
    samples: 0,
  },
  useHalfFloatFeedback: true,
  closeLinesManually: true,
  useLineLoopPrimitives: false,
  supportsShapeGradient: false,
};

const SHARED_GEOMETRY_FLAG = 'milkdropSharedGeometry';
const SHARED_BOUNDS_RADIUS = 4;
const BACKGROUND_GEOMETRY = markSharedGeometry(new PlaneGeometry(6.4, 6.4));
const polygonFillGeometryCache = new Map<number, ShapeGeometry>();
const polygonOutlineGeometryCache = new Map<string, BufferGeometry>();
const proceduralMeshGeometryCache = new Map<number, BufferGeometry>();
const proceduralMotionVectorGeometryCache = new Map<string, BufferGeometry>();

type ProceduralFieldUniformState = {
  zoom: { value: number };
  rotation: { value: number };
  warp: { value: number };
  warpAnimSpeed: { value: number };
  time: { value: number };
  trebleAtt: { value: number };
  tint: { value: Color };
  alpha: { value: number };
};

function createProceduralFieldUniformState() {
  return {
    zoom: { value: 1 },
    rotation: { value: 0 },
    warp: { value: 0 },
    warpAnimSpeed: { value: 1 },
    time: { value: 0 },
    trebleAtt: { value: 0 },
    tint: { value: new Color(1, 1, 1) },
    alpha: { value: 1 },
  } satisfies ProceduralFieldUniformState;
}

const PROCEDURAL_FIELD_SHADER_CHUNK = `
  vec2 milkdropTransformPoint(vec2 source) {
    float radius = length(source);
    float angle = atan(source.y, source.x) + rotation;
    float ripple = sin(
      radius * 12.0 +
      time * (0.6 + trebleAtt) * (0.35 + warpAnimSpeed)
    ) * warp * 0.08;
    vec2 warped = vec2(
      (source.x + cos(angle * 3.0) * ripple) * zoom,
      (source.y + sin(angle * 4.0) * ripple) * zoom
    );
    float cosRot = cos(rotation);
    float sinRot = sin(rotation);
    return vec2(
      warped.x * cosRot - warped.y * sinRot,
      warped.x * sinRot + warped.y * cosRot
    );
  }
`;

function createProceduralMeshMaterial() {
  const uniforms = createProceduralFieldUniformState();
  return new ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: `
      attribute vec3 sourcePosition;
      uniform float zoom;
      uniform float rotation;
      uniform float warp;
      uniform float warpAnimSpeed;
      uniform float time;
      uniform float trebleAtt;
      ${PROCEDURAL_FIELD_SHADER_CHUNK}

      void main() {
        vec2 transformed = milkdropTransformPoint(sourcePosition.xy);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(
          transformed.xy,
          sourcePosition.z,
          1.0
        );
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      uniform float alpha;

      void main() {
        gl_FragColor = vec4(tint, alpha);
      }
    `,
  });
}

function createProceduralMotionVectorMaterial() {
  const uniforms = createProceduralFieldUniformState();
  return new ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: `
      attribute vec3 sourcePosition;
      attribute float endpointWeight;
      uniform float zoom;
      uniform float rotation;
      uniform float warp;
      uniform float warpAnimSpeed;
      uniform float time;
      uniform float trebleAtt;
      varying float vAlpha;
      ${PROCEDURAL_FIELD_SHADER_CHUNK}

      void main() {
        vec2 source = sourcePosition.xy;
        vec2 current = milkdropTransformPoint(source);
        vec2 delta = clamp((current - source) * 1.35, vec2(-0.24), vec2(0.24));
        float magnitude = length(delta);
        vec2 renderPoint = mix(
          current - delta * 0.45,
          current + delta,
          endpointWeight
        );
        vAlpha = alpha * clamp(0.75 + magnitude * 2.2, 0.02, 1.0) * step(0.002, magnitude);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(
          renderPoint.xy,
          sourcePosition.z,
          1.0
        );
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      varying float vAlpha;

      void main() {
        if (vAlpha <= 0.0) {
          discard;
        }
        gl_FragColor = vec4(tint, vAlpha);
      }
    `,
  });
}
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

function getProceduralMeshGeometry(density: number) {
  const safeDensity = Math.max(2, Math.round(density));
  const cached = proceduralMeshGeometryCache.get(safeDensity);
  if (cached) {
    return cached;
  }

  const sourcePositions: number[] = [];
  for (let row = 0; row < safeDensity; row += 1) {
    for (let col = 0; col < safeDensity; col += 1) {
      const x = (col / Math.max(1, safeDensity - 1)) * 2 - 1;
      const y = (row / Math.max(1, safeDensity - 1)) * 2 - 1;

      if (col + 1 < safeDensity) {
        const nextX = ((col + 1) / Math.max(1, safeDensity - 1)) * 2 - 1;
        sourcePositions.push(x, y, -0.25, nextX, y, -0.25);
      }

      if (row + 1 < safeDensity) {
        const nextY = ((row + 1) / Math.max(1, safeDensity - 1)) * 2 - 1;
        sourcePositions.push(x, y, -0.25, x, nextY, -0.25);
      }
    }
  }

  const geometry = markSharedGeometry(new BufferGeometry());
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(sourcePositions, 3),
  );
  geometry.setAttribute(
    'sourcePosition',
    new Float32BufferAttribute(sourcePositions, 3),
  );
  proceduralMeshGeometryCache.set(safeDensity, geometry);
  return geometry;
}

function getProceduralMotionVectorGeometry(countX: number, countY: number) {
  const safeCountX = Math.max(1, Math.round(countX));
  const safeCountY = Math.max(1, Math.round(countY));
  const cacheKey = `${safeCountX}x${safeCountY}`;
  const cached = proceduralMotionVectorGeometryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sourcePositions: number[] = [];
  const endpointWeights: number[] = [];
  for (let row = 0; row < safeCountY; row += 1) {
    for (let col = 0; col < safeCountX; col += 1) {
      const sourceX = safeCountX === 1 ? 0 : (col / (safeCountX - 1)) * 2 - 1;
      const sourceY = safeCountY === 1 ? 0 : (row / (safeCountY - 1)) * 2 - 1;
      sourcePositions.push(sourceX, sourceY, 0.18, sourceX, sourceY, 0.18);
      endpointWeights.push(0, 1);
    }
  }

  const geometry = markSharedGeometry(new BufferGeometry());
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(sourcePositions, 3),
  );
  geometry.setAttribute(
    'sourcePosition',
    new Float32BufferAttribute(sourcePositions, 3),
  );
  geometry.setAttribute(
    'endpointWeight',
    new Float32BufferAttribute(endpointWeights, 1),
  );
  proceduralMotionVectorGeometryCache.set(cacheKey, geometry);
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

function syncProceduralFieldUniforms(
  material: ShaderMaterial,
  {
    zoom,
    rotation,
    warp,
    warpAnimSpeed,
    time,
    trebleAtt,
    tint,
    alpha,
  }: {
    zoom: number;
    rotation: number;
    warp: number;
    warpAnimSpeed: number;
    time: number;
    trebleAtt: number;
    tint: { r: number; g: number; b: number };
    alpha: number;
  },
) {
  material.uniforms.zoom.value = zoom;
  material.uniforms.rotation.value = rotation;
  material.uniforms.warp.value = warp;
  material.uniforms.warpAnimSpeed.value = warpAnimSpeed;
  material.uniforms.time.value = time;
  material.uniforms.trebleAtt.value = trebleAtt;
  material.uniforms.tint.value.setRGB(tint.r, tint.g, tint.b);
  material.uniforms.alpha.value = alpha;
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
  material.transparent = opacity < 1;
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
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  }

  if (!geometry.boundingSphere) {
    geometry.boundingSphere = new Sphere(
      new Vector3(0, 0, 0),
      SHARED_BOUNDS_RADIUS,
    );
  } else {
    geometry.boundingSphere.center.set(0, 0, 0);
    geometry.boundingSphere.radius = SHARED_BOUNDS_RADIUS;
  }
}

function clearGroup(group: Group) {
  group.children.slice().forEach((child) => {
    disposeObject(child);
    group.remove(child);
  });
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

function createWaveObject(
  wave: MilkdropWaveVisual | null,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier = 1,
) {
  if (!wave || wave.positions.length === 0) {
    return null;
  }

  if (wave.drawMode === 'dots') {
    const object = new Points(
      new BufferGeometry(),
      new PointsMaterial({
        size: wave.pointSize,
        transparent: true,
        opacity: wave.alpha * alphaMultiplier,
        ...(wave.additive ? { blending: AdditiveBlending } : {}),
      }),
    );
    ensureGeometryPositions(object.geometry, wave.positions);
    setMaterialColor(object.material, wave.color, wave.alpha * alphaMultiplier);
    object.position.z = 0.24;
    return object;
  }

  const ObjectType =
    wave.closed && behavior.useLineLoopPrimitives ? LineLoop : Line;
  const object = new ObjectType(
    new BufferGeometry(),
    new LineBasicMaterial({
      transparent: true,
      opacity: wave.alpha * alphaMultiplier,
      ...(wave.additive ? { blending: AdditiveBlending } : {}),
    }),
  );
  ensureGeometryPositions(
    object.geometry,
    getWaveLinePositions(wave, behavior),
  );
  setMaterialColor(object.material, wave.color, wave.alpha * alphaMultiplier);
  object.position.z = 0.24;
  return object;
}

function createShapeObject(
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier = 1,
) {
  const group = new Group();
  const fillMaterial =
    shape.secondaryColor && behavior.supportsShapeGradient
      ? new ShaderMaterial({
          uniforms: {
            primaryColor: {
              value: new Color(shape.color.r, shape.color.g, shape.color.b),
            },
            secondaryColor: {
              value: new Color(
                shape.secondaryColor.r,
                shape.secondaryColor.g,
                shape.secondaryColor.b,
              ),
            },
            primaryAlpha: {
              value: (shape.color.a ?? 0.4) * alphaMultiplier,
            },
            secondaryAlpha: {
              value: (shape.secondaryColor.a ?? 0) * alphaMultiplier,
            },
          },
          transparent: true,
          side: DoubleSide,
          ...(shape.additive ? { blending: AdditiveBlending } : {}),
          vertexShader: `
          varying vec2 vLocal;
          void main() {
            vLocal = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
          fragmentShader: `
          uniform vec3 primaryColor;
          uniform vec3 secondaryColor;
          uniform float primaryAlpha;
          uniform float secondaryAlpha;
          varying vec2 vLocal;

          void main() {
            float blend = clamp(length(vLocal), 0.0, 1.0);
            vec3 color = mix(primaryColor, secondaryColor, blend);
            float alpha = mix(primaryAlpha, secondaryAlpha, blend);
            gl_FragColor = vec4(color, alpha);
          }
        `,
        })
      : new MeshBasicMaterial({
          color: new Color(
            getShapeFillFallbackColor(shape).r,
            getShapeFillFallbackColor(shape).g,
            getShapeFillFallbackColor(shape).b,
          ),
          opacity:
            (getShapeFillFallbackColor(shape).a ?? 0.4) * alphaMultiplier,
          transparent: true,
          side: DoubleSide,
          ...(shape.additive ? { blending: AdditiveBlending } : {}),
        });

  const fill = new Mesh(getUnitPolygonFillGeometry(shape.sides), fillMaterial);
  fill.position.set(shape.x, shape.y, 0.14);
  fill.scale.set(shape.radius, shape.radius, 1);
  fill.rotation.z = shape.rotation;
  group.add(fill);

  if (shape.thickOutline) {
    const accentBorder = new (behavior.useLineLoopPrimitives ? LineLoop : Line)(
      behavior.useLineLoopPrimitives
        ? getUnitPolygonOutlineGeometry(shape.sides)
        : getUnitPolygonClosedLineGeometry(shape.sides),
      new LineBasicMaterial({
        color: new Color(
          shape.borderColor.r,
          shape.borderColor.g,
          shape.borderColor.b,
        ),
        opacity:
          Math.max(0.2, (shape.borderColor.a ?? 1) * 0.45) * alphaMultiplier,
        transparent: true,
        ...(shape.additive ? { blending: AdditiveBlending } : {}),
      }),
    );
    accentBorder.position.set(shape.x, shape.y, 0.15);
    accentBorder.scale.set(shape.radius * 1.045, shape.radius * 1.045, 1);
    accentBorder.rotation.z = shape.rotation;
    group.add(accentBorder);
  }

  const border = new (behavior.useLineLoopPrimitives ? LineLoop : Line)(
    behavior.useLineLoopPrimitives
      ? getUnitPolygonOutlineGeometry(shape.sides)
      : getUnitPolygonClosedLineGeometry(shape.sides),
    new LineBasicMaterial({
      color: new Color(
        shape.borderColor.r,
        shape.borderColor.g,
        shape.borderColor.b,
      ),
      opacity: (shape.borderColor.a ?? 1) * alphaMultiplier,
      transparent: true,
      ...(shape.additive ? { blending: AdditiveBlending } : {}),
    }),
  );
  border.position.set(shape.x, shape.y, 0.16);
  border.scale.set(shape.radius, shape.radius, 1);
  border.rotation.z = shape.rotation;
  group.add(border);

  return group;
}

function syncShapeFillMaterial(
  mesh: Mesh,
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  const wantsGradient =
    Boolean(shape.secondaryColor) && behavior.supportsShapeGradient;
  const existingMaterial = mesh.material;

  if (wantsGradient) {
    if (!(existingMaterial instanceof ShaderMaterial)) {
      disposeMaterial(existingMaterial);
      mesh.material = new ShaderMaterial({
        uniforms: {
          primaryColor: {
            value: new Color(shape.color.r, shape.color.g, shape.color.b),
          },
          secondaryColor: {
            value: new Color(
              shape.secondaryColor?.r ?? 0,
              shape.secondaryColor?.g ?? 0,
              shape.secondaryColor?.b ?? 0,
            ),
          },
          primaryAlpha: {
            value: (shape.color.a ?? 0.4) * alphaMultiplier,
          },
          secondaryAlpha: {
            value: (shape.secondaryColor?.a ?? 0) * alphaMultiplier,
          },
        },
        transparent: true,
        side: DoubleSide,
        ...(shape.additive ? { blending: AdditiveBlending } : {}),
        vertexShader: `
          varying vec2 vLocal;
          void main() {
            vLocal = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 primaryColor;
          uniform vec3 secondaryColor;
          uniform float primaryAlpha;
          uniform float secondaryAlpha;
          varying vec2 vLocal;

          void main() {
            float blend = clamp(length(vLocal), 0.0, 1.0);
            vec3 color = mix(primaryColor, secondaryColor, blend);
            float alpha = mix(primaryAlpha, secondaryAlpha, blend);
            gl_FragColor = vec4(color, alpha);
          }
        `,
      });
    }

    const material = mesh.material as ShaderMaterial;
    material.uniforms.primaryColor.value.setRGB(
      shape.color.r,
      shape.color.g,
      shape.color.b,
    );
    material.uniforms.secondaryColor.value.setRGB(
      shape.secondaryColor?.r ?? 0,
      shape.secondaryColor?.g ?? 0,
      shape.secondaryColor?.b ?? 0,
    );
    material.uniforms.primaryAlpha.value =
      (shape.color.a ?? 0.4) * alphaMultiplier;
    material.uniforms.secondaryAlpha.value =
      (shape.secondaryColor?.a ?? 0) * alphaMultiplier;
    material.blending = shape.additive ? AdditiveBlending : NormalBlending;
    material.needsUpdate = true;
    return;
  }

  if (!(existingMaterial instanceof MeshBasicMaterial)) {
    disposeMaterial(existingMaterial);
    const fillColor = getShapeFillFallbackColor(shape);
    mesh.material = new MeshBasicMaterial({
      color: new Color(fillColor.r, fillColor.g, fillColor.b),
      opacity: (fillColor.a ?? 0.4) * alphaMultiplier,
      transparent: true,
      side: DoubleSide,
      ...(shape.additive ? { blending: AdditiveBlending } : {}),
    });
  }

  const material = mesh.material as MeshBasicMaterial;
  material.blending = shape.additive ? AdditiveBlending : NormalBlending;
  const fillColor = getShapeFillFallbackColor(shape);
  setMaterialColor(material, fillColor, (fillColor.a ?? 0.4) * alphaMultiplier);
}

function syncShapeOutline(
  object: Line | LineLoop,
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
  opacity: number,
) {
  const nextGeometry = behavior.useLineLoopPrimitives
    ? getUnitPolygonOutlineGeometry(shape.sides)
    : getUnitPolygonClosedLineGeometry(shape.sides);
  if (object.geometry !== nextGeometry) {
    object.geometry = nextGeometry;
  }
  object.position.set(shape.x, shape.y, 0.16);
  object.scale.set(shape.radius, shape.radius, 1);
  object.rotation.z = shape.rotation;
  const material = object.material as LineBasicMaterial;
  material.blending = shape.additive ? AdditiveBlending : NormalBlending;
  setMaterialColor(material, shape.borderColor, opacity * alphaMultiplier);
}

function syncShapeObject(
  existing: Group | undefined,
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  const wantsAccent = shape.thickOutline;
  const fillZ = 0.14;
  const accentZ = 0.15;
  const borderZ = 0.16;

  if (!(existing instanceof Group)) {
    if (existing) {
      disposeObject(existing);
    }
    return createShapeObject(shape, behavior, alphaMultiplier);
  }

  const fill = existing.children[0];
  const accent = existing.children[1];
  const border = existing.children[wantsAccent ? 2 : 1];
  const expectsLoop = behavior.useLineLoopPrimitives;
  const hasSupportedBorder = expectsLoop
    ? border instanceof LineLoop
    : border instanceof Line;
  const hasSupportedAccent = expectsLoop
    ? accent instanceof LineLoop
    : accent instanceof Line;

  if (
    !(fill instanceof Mesh) ||
    !hasSupportedBorder ||
    (wantsAccent && !hasSupportedAccent)
  ) {
    disposeObject(existing);
    return createShapeObject(shape, behavior, alphaMultiplier);
  }

  if (fill.geometry !== getUnitPolygonFillGeometry(shape.sides)) {
    fill.geometry = getUnitPolygonFillGeometry(shape.sides);
  }
  fill.position.set(shape.x, shape.y, fillZ);
  fill.scale.set(shape.radius, shape.radius, 1);
  fill.rotation.z = shape.rotation;
  syncShapeFillMaterial(fill, shape, behavior, alphaMultiplier);

  if (wantsAccent && (accent instanceof LineLoop || accent instanceof Line)) {
    syncShapeOutline(
      accent,
      shape,
      behavior,
      alphaMultiplier,
      Math.max(0.2, (shape.borderColor.a ?? 1) * 0.45),
    );
    accent.scale.set(shape.radius * 1.045, shape.radius * 1.045, 1);
    accent.position.z = accentZ;
  }

  syncShapeOutline(
    border as Line | LineLoop,
    shape,
    behavior,
    alphaMultiplier,
    shape.borderColor.a ?? 1,
  );
  border.position.z = borderZ;

  if (!wantsAccent && accent) {
    disposeObject(accent as { children?: unknown[] });
    existing.remove(accent);
  } else if (
    wantsAccent &&
    !(accent instanceof LineLoop) &&
    !(accent instanceof Line)
  ) {
    const nextAccent = new (behavior.useLineLoopPrimitives ? LineLoop : Line)(
      behavior.useLineLoopPrimitives
        ? getUnitPolygonOutlineGeometry(shape.sides)
        : getUnitPolygonClosedLineGeometry(shape.sides),
      new LineBasicMaterial({
        transparent: true,
      }),
    );
    existing.add(nextAccent);
    syncShapeOutline(
      nextAccent,
      shape,
      behavior,
      alphaMultiplier,
      Math.max(0.2, (shape.borderColor.a ?? 1) * 0.45),
    );
    nextAccent.scale.set(shape.radius * 1.045, shape.radius * 1.045, 1);
    nextAccent.position.z = accentZ;
  }

  return existing;
}

function createBorderObject(
  border: MilkdropBorderVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier = 1,
) {
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const left = -1 + inset * 2;
  const right = 1 - inset * 2;
  const top = 1 - inset * 2;
  const bottom = -1 + inset * 2;
  const group = new Group();
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

  const fill = new Mesh(
    new ShapeGeometry(fillShape),
    new MeshBasicMaterial({
      transparent: true,
      opacity: Math.max(0.08, border.alpha * 0.45) * alphaMultiplier,
      side: DoubleSide,
    }),
  );
  setMaterialColor(
    fill.material,
    border.color,
    Math.max(0.08, border.alpha * 0.45) * alphaMultiplier,
  );
  fill.position.z = 0.285;
  group.add(fill);

  const outline = new (behavior.useLineLoopPrimitives ? LineLoop : Line)(
    new BufferGeometry(),
    new LineBasicMaterial({
      transparent: true,
      opacity: border.alpha * alphaMultiplier,
    }),
  );
  ensureGeometryPositions(
    outline.geometry,
    getBorderLinePositions(border, 0.3, behavior),
  );
  setMaterialColor(
    outline.material,
    border.color,
    border.alpha * alphaMultiplier,
  );
  outline.position.z = 0.3;
  group.add(outline);

  if (!border.styled) {
    return group;
  }

  const accent = new (behavior.useLineLoopPrimitives ? LineLoop : Line)(
    new BufferGeometry(),
    new LineBasicMaterial({
      transparent: true,
      opacity: Math.max(0.15, border.alpha * 0.55) * alphaMultiplier,
    }),
  );
  ensureGeometryPositions(
    accent.geometry,
    getBorderLinePositions(border, 0.3, behavior),
  );
  setMaterialColor(
    accent.material,
    border.color,
    border.alpha * alphaMultiplier,
  );
  accent.scale.set(
    border.key === 'outer' ? 0.985 : 1.015,
    border.key === 'outer' ? 0.985 : 1.015,
    1,
  );
  accent.position.z = 0.31;
  group.add(accent);
  return group;
}

function updateWaveObject(
  object: Line | LineLoop | Points,
  wave: MilkdropWaveVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  ensureGeometryPositions(
    object.geometry,
    getWaveLinePositions(wave, behavior),
  );
  if (object instanceof Points) {
    const material = object.material as PointsMaterial;
    material.size = wave.pointSize;
    material.blending = wave.additive ? AdditiveBlending : NormalBlending;
    setMaterialColor(material, wave.color, wave.alpha * alphaMultiplier);
  } else {
    const material = object.material as LineBasicMaterial;
    material.blending = wave.additive ? AdditiveBlending : NormalBlending;
    setMaterialColor(material, wave.color, wave.alpha * alphaMultiplier);
  }
  object.position.z = 0.24;
}

function syncWaveObject(
  existing: Line | LineLoop | Points | undefined,
  wave: MilkdropWaveVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  const wantsPoints = wave.drawMode === 'dots';
  const wantsLoop =
    wave.closed && !wantsPoints && behavior.useLineLoopPrimitives;
  const matches =
    !!existing &&
    ((wantsPoints && existing instanceof Points) ||
      (wantsLoop && existing instanceof LineLoop) ||
      (!wantsPoints && !wantsLoop && existing instanceof Line));

  if (!matches) {
    if (existing) {
      disposeObject(existing);
    }
    const created = createWaveObject(wave, behavior, alphaMultiplier);
    return created;
  }

  updateWaveObject(existing, wave, behavior, alphaMultiplier);
  return existing;
}

function updateBorderLine(
  object: Line | LineLoop,
  border: MilkdropBorderVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const previousInset = object.userData.borderInset as number | undefined;
  if (previousInset !== inset) {
    ensureGeometryPositions(
      object.geometry,
      getBorderLinePositions(border, 0.3, behavior),
    );
    object.userData.borderInset = inset;
  }
  setMaterialColor(
    object.material as LineBasicMaterial,
    border.color,
    border.alpha * alphaMultiplier,
  );
}

function updateBorderFill(
  object: Mesh,
  border: MilkdropBorderVisual,
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

    if (!isSharedGeometry(object.geometry)) {
      disposeGeometry(object.geometry);
    }
    object.geometry = new ShapeGeometry(fillShape);
    object.userData.borderInset = inset;
  }
  setMaterialColor(
    object.material as MeshBasicMaterial,
    border.color,
    Math.max(0.08, border.alpha * 0.45) * alphaMultiplier,
  );
  object.position.z = 0.285;
}

function syncBorderObject(
  existing: Group | undefined,
  border: MilkdropBorderVisual,
  behavior: MilkdropBackendBehavior,
  alphaMultiplier: number,
) {
  if (!(existing instanceof Group)) {
    if (existing) {
      disposeObject(existing);
    }
    return createBorderObject(border, behavior, alphaMultiplier);
  }

  const fill = existing.children[0];
  const outline = existing.children[1];
  const accent = existing.children[2];
  const wantsAccent = border.styled;
  const expectsLoop = behavior.useLineLoopPrimitives;
  const hasSupportedOutline = expectsLoop
    ? outline instanceof LineLoop
    : outline instanceof Line;
  const hasSupportedAccent = expectsLoop
    ? accent instanceof LineLoop
    : accent instanceof Line;
  if (
    !(fill instanceof Mesh) ||
    !hasSupportedOutline ||
    (wantsAccent && !hasSupportedAccent)
  ) {
    disposeObject(existing);
    return createBorderObject(border, behavior, alphaMultiplier);
  }

  updateBorderFill(fill, border, alphaMultiplier);
  updateBorderLine(
    outline as Line | LineLoop,
    border,
    behavior,
    alphaMultiplier,
  );
  outline.position.z = 0.3;
  if (wantsAccent && (accent instanceof LineLoop || accent instanceof Line)) {
    updateBorderLine(accent, border, behavior, alphaMultiplier);
    accent.scale.set(
      border.key === 'outer' ? 0.985 : 1.015,
      border.key === 'outer' ? 0.985 : 1.015,
      1,
    );
    accent.position.z = 0.31;
    (accent.material as LineBasicMaterial).opacity =
      Math.max(0.15, border.alpha * 0.55) * alphaMultiplier;
  }
  if (!wantsAccent && accent) {
    disposeObject(accent as { children?: unknown[] });
    existing.remove(accent);
  }
  return existing;
}

class ThreeMilkdropAdapter implements MilkdropRendererAdapter {
  readonly backend: 'webgl' | 'webgpu';
  private readonly behavior: MilkdropBackendBehavior;
  private readonly createFeedbackManager: MilkdropFeedbackManagerFactory | null;
  private readonly scene: Scene;
  private readonly camera: Camera;
  private readonly renderer: RendererLike | null;
  private readonly root = new Group();
  private readonly background = new Mesh(
    BACKGROUND_GEOMETRY,
    new MeshBasicMaterial({
      color: 0x000000,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: false,
    }),
  );
  private readonly meshLines: LineSegments<
    BufferGeometry,
    LineBasicMaterial | ShaderMaterial
  > = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({
      color: 0x4d66f2,
      transparent: true,
      opacity: 0.24,
    }),
  );
  private readonly mainWaveGroup = new Group();
  private readonly customWaveGroup = new Group();
  private readonly trailGroup = new Group();
  private readonly shapesGroup = new Group();
  private readonly borderGroup = new Group();
  private readonly motionVectorGroup = new Group();
  private readonly motionVectorCpuGroup = new Group();
  private readonly proceduralMotionVectors = new LineSegments(
    new BufferGeometry(),
    createProceduralMotionVectorMaterial(),
  );
  private readonly blendWaveGroup = new Group();
  private readonly blendCustomWaveGroup = new Group();
  private readonly blendShapeGroup = new Group();
  private readonly blendBorderGroup = new Group();
  private readonly blendMotionVectorGroup = new Group();
  private readonly feedback: MilkdropFeedbackManager | null;
  private readonly colorScaleScratch = new Color(1, 1, 1);
  private readonly tintScratch = new Color(1, 1, 1);

  constructor({
    scene,
    camera,
    renderer,
    backend,
    behavior,
    createFeedbackManager,
  }: {
    scene: Scene;
    camera: Camera;
    renderer: RendererLike | null;
    backend: 'webgl' | 'webgpu';
    behavior: MilkdropBackendBehavior;
    createFeedbackManager: MilkdropFeedbackManagerFactory | null;
  }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.backend = backend;
    this.behavior = behavior;
    this.createFeedbackManager = createFeedbackManager;

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
    this.root.add(this.blendMotionVectorGroup);

    if (isFeedbackCapableRenderer(renderer) && this.createFeedbackManager) {
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

  setPreset(_preset: MilkdropCompiledPreset) {}

  assessSupport(preset: MilkdropCompiledPreset) {
    return preset.ir.compatibility.backends[this.backend];
  }

  resize(width: number, height: number) {
    this.feedback?.resize(width, height);
  }

  private renderWaveGroup(
    group: Group,
    waves: MilkdropWaveVisual[],
    alphaMultiplier = 1,
  ) {
    waves.forEach((wave, index) => {
      const existing = group.children[index] as
        | Line
        | LineLoop
        | Points
        | undefined;
      const synced = syncWaveObject(
        existing,
        wave,
        this.behavior,
        alphaMultiplier,
      );
      if (!synced) {
        return;
      }
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    });
    group.children.slice(waves.length).forEach((child) => {
      disposeObject(child as { children?: unknown[] });
      group.remove(child);
    });
  }

  private renderShapeGroup(
    group: Group,
    shapes: MilkdropShapeVisual[],
    alphaMultiplier = 1,
  ) {
    shapes.forEach((shape, index) => {
      const existing = group.children[index] as Group | undefined;
      const synced = syncShapeObject(
        existing,
        shape,
        this.behavior,
        alphaMultiplier,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    });
    group.children.slice(shapes.length).forEach((child) => {
      disposeObject(child as { children?: unknown[] });
      group.remove(child);
    });
  }

  private renderBorderGroup(
    group: Group,
    borders: MilkdropBorderVisual[],
    alphaMultiplier = 1,
  ) {
    borders.forEach((border, index) => {
      const existing = group.children[index] as Group | undefined;
      const synced = syncBorderObject(
        existing,
        border,
        this.behavior,
        alphaMultiplier,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    });
    group.children.slice(borders.length).forEach((child) => {
      disposeObject(child as { children?: unknown[] });
      group.remove(child);
    });
  }

  private renderMesh(
    mesh: MilkdropRenderPayload['frameState']['mesh'],
    gpuGeometry: MilkdropGpuGeometryHints,
    signals: MilkdropRenderPayload['frameState']['signals'],
  ) {
    const proceduralMesh =
      this.backend === 'webgpu' ? gpuGeometry.meshField : null;
    if (proceduralMesh) {
      if (!(this.meshLines.material instanceof ShaderMaterial)) {
        disposeMaterial(this.meshLines.material);
        this.meshLines.material = createProceduralMeshMaterial();
      }
      this.meshLines.geometry = getProceduralMeshGeometry(
        proceduralMesh.density,
      );
      syncProceduralFieldUniforms(this.meshLines.material as ShaderMaterial, {
        zoom: proceduralMesh.zoom,
        rotation: proceduralMesh.rotation,
        warp: proceduralMesh.warp,
        warpAnimSpeed: proceduralMesh.warpAnimSpeed,
        time: signals.time,
        trebleAtt: signals.trebleAtt,
        tint: mesh.color,
        alpha: mesh.alpha,
      });
      this.meshLines.visible = mesh.alpha > 0.001;
      return;
    }

    if (!(this.meshLines.material instanceof LineBasicMaterial)) {
      disposeMaterial(this.meshLines.material);
      this.meshLines.material = new LineBasicMaterial({
        color: 0x4d66f2,
        transparent: true,
        opacity: 0.24,
      });
    }

    const meshMaterial = this.meshLines.material as LineBasicMaterial;
    ensureGeometryPositions(this.meshLines.geometry, mesh.positions);
    setMaterialColor(meshMaterial, mesh.color, mesh.alpha);
    this.meshLines.visible = mesh.positions.length > 0;
  }

  private renderMotionVectors(
    payload: MilkdropRenderPayload['frameState'],
    alphaMultiplier = 1,
  ) {
    const proceduralField =
      this.backend === 'webgpu' ? payload.gpuGeometry.motionVectorField : null;
    if (proceduralField) {
      clearGroup(this.motionVectorCpuGroup);
      this.proceduralMotionVectors.visible = true;
      this.proceduralMotionVectors.geometry = getProceduralMotionVectorGeometry(
        proceduralField.countX,
        proceduralField.countY,
      );
      syncProceduralFieldUniforms(
        this.proceduralMotionVectors.material as ShaderMaterial,
        {
          zoom: proceduralField.zoom,
          rotation: proceduralField.rotation,
          warp: proceduralField.warp,
          warpAnimSpeed: proceduralField.warpAnimSpeed,
          time: payload.signals.time,
          trebleAtt: payload.signals.trebleAtt,
          tint: {
            r: Math.min(Math.max(payload.variables.mv_r ?? 1, 0), 1),
            g: Math.min(Math.max(payload.variables.mv_g ?? 1, 0), 1),
            b: Math.min(Math.max(payload.variables.mv_b ?? 1, 0), 1),
          },
          alpha:
            Math.min(Math.max(payload.variables.mv_a ?? 0.35, 0.02), 1) *
            alphaMultiplier,
        },
      );
      return;
    }

    this.proceduralMotionVectors.visible = false;
    this.renderWaveGroup(
      this.motionVectorCpuGroup,
      payload.motionVectors.map((vector) => ({
        ...vector,
        drawMode: 'line',
        pointSize: 1,
      })),
      alphaMultiplier,
    );
  }

  render(payload: MilkdropRenderPayload) {
    const backgroundMaterial = this.background.material as MeshBasicMaterial;
    setMaterialColor(backgroundMaterial, payload.frameState.background, 1);

    this.renderMesh(
      payload.frameState.mesh,
      payload.frameState.gpuGeometry,
      payload.frameState.signals,
    );

    this.renderWaveGroup(this.mainWaveGroup, [payload.frameState.mainWave]);
    this.renderWaveGroup(this.customWaveGroup, payload.frameState.customWaves);
    this.renderWaveGroup(
      this.trailGroup,
      payload.frameState.trails.map((trail) => ({
        ...trail,
        drawMode: 'line',
        additive: false,
        pointSize: 2,
      })),
    );
    this.renderShapeGroup(this.shapesGroup, payload.frameState.shapes);
    this.renderBorderGroup(this.borderGroup, payload.frameState.borders);
    this.renderMotionVectors(payload.frameState);

    const blend = payload.blendState;
    this.renderWaveGroup(
      this.blendWaveGroup,
      blend ? [blend.mainWave] : [],
      blend?.alpha ?? 0,
    );
    this.renderWaveGroup(
      this.blendCustomWaveGroup,
      blend?.customWaves ?? [],
      blend?.alpha ?? 0,
    );
    this.renderShapeGroup(
      this.blendShapeGroup,
      blend?.shapes ?? [],
      blend?.alpha ?? 0,
    );
    this.renderBorderGroup(
      this.blendBorderGroup,
      blend?.borders ?? [],
      blend?.alpha ?? 0,
    );
    this.renderWaveGroup(
      this.blendMotionVectorGroup,
      (blend?.motionVectors ?? []).map((vector) => ({
        ...vector,
        drawMode: 'line',
        pointSize: 1,
      })),
      blend?.alpha ?? 0,
    );

    if (
      !isFeedbackCapableRenderer(this.renderer) ||
      !this.feedback ||
      !payload.frameState.post.shaderEnabled
    ) {
      return false;
    }

    this.feedback.compositeMaterial.uniforms.currentTex.value =
      this.feedback.sceneTarget.texture;
    this.feedback.compositeMaterial.uniforms.previousTex.value =
      this.feedback.readTarget.texture;
    this.feedback.compositeMaterial.uniforms.mixAlpha.value = payload.frameState
      .post.videoEchoEnabled
      ? payload.frameState.post.videoEchoAlpha +
        payload.frameState.post.shaderControls.mixAlpha
      : payload.frameState.post.shaderControls.mixAlpha;
    this.feedback.compositeMaterial.uniforms.zoom.value = payload.frameState
      .post.videoEchoEnabled
      ? payload.frameState.post.videoEchoZoom +
        payload.frameState.post.shaderControls.warpScale * 0.04
      : 1;
    this.feedback.compositeMaterial.uniforms.brighten.value = payload.frameState
      .post.brighten
      ? 1
      : 0;
    this.feedback.compositeMaterial.uniforms.darken.value = payload.frameState
      .post.darken
      ? 1
      : 0;
    this.feedback.compositeMaterial.uniforms.solarize.value = payload.frameState
      .post.solarize
      ? 1
      : 0;
    this.feedback.compositeMaterial.uniforms.invert.value = payload.frameState
      .post.invert
      ? 1
      : 0;
    this.feedback.compositeMaterial.uniforms.gammaAdj.value =
      payload.frameState.post.gammaAdj;
    this.feedback.compositeMaterial.uniforms.textureWrap.value = payload
      .frameState.post.textureWrap
      ? 1
      : 0;
    this.feedback.compositeMaterial.uniforms.feedbackTexture.value = payload
      .frameState.post.feedbackTexture
      ? 1
      : 0;
    this.feedback.compositeMaterial.uniforms.warpScale.value =
      payload.frameState.post.shaderControls.warpScale;
    this.feedback.compositeMaterial.uniforms.offsetX.value =
      payload.frameState.post.shaderControls.offsetX;
    this.feedback.compositeMaterial.uniforms.offsetY.value =
      payload.frameState.post.shaderControls.offsetY;
    this.feedback.compositeMaterial.uniforms.rotation.value =
      payload.frameState.post.shaderControls.rotation;
    this.feedback.compositeMaterial.uniforms.zoomMul.value =
      payload.frameState.post.shaderControls.zoom;
    this.feedback.compositeMaterial.uniforms.saturation.value =
      payload.frameState.post.shaderControls.saturation;
    this.feedback.compositeMaterial.uniforms.contrast.value =
      payload.frameState.post.shaderControls.contrast;
    this.colorScaleScratch.setRGB(
      payload.frameState.post.shaderControls.colorScale.r,
      payload.frameState.post.shaderControls.colorScale.g,
      payload.frameState.post.shaderControls.colorScale.b,
    );
    this.feedback.compositeMaterial.uniforms.colorScale.value =
      this.colorScaleScratch;
    this.feedback.compositeMaterial.uniforms.hueShift.value =
      payload.frameState.post.shaderControls.hueShift;
    this.feedback.compositeMaterial.uniforms.brightenBoost.value =
      payload.frameState.post.shaderControls.brightenBoost;
    this.feedback.compositeMaterial.uniforms.invertBoost.value =
      payload.frameState.post.shaderControls.invertBoost;
    this.feedback.compositeMaterial.uniforms.solarizeBoost.value =
      payload.frameState.post.shaderControls.solarizeBoost;
    this.tintScratch.setRGB(
      payload.frameState.post.shaderControls.tint.r,
      payload.frameState.post.shaderControls.tint.g,
      payload.frameState.post.shaderControls.tint.b,
    );
    this.feedback.compositeMaterial.uniforms.tint.value = this.tintScratch;
    this.feedback.compositeMaterial.uniforms.overlayTextureSource.value =
      getShaderTextureSourceId(
        payload.frameState.post.shaderControls.textureLayer.source,
      );
    this.feedback.compositeMaterial.uniforms.overlayTextureMode.value =
      getShaderTextureBlendModeId(
        payload.frameState.post.shaderControls.textureLayer.mode,
      );
    this.feedback.compositeMaterial.uniforms.overlayTextureAmount.value =
      payload.frameState.post.shaderControls.textureLayer.amount;
    this.feedback.compositeMaterial.uniforms.overlayTextureScale.value.set(
      payload.frameState.post.shaderControls.textureLayer.scaleX,
      payload.frameState.post.shaderControls.textureLayer.scaleY,
    );
    this.feedback.compositeMaterial.uniforms.overlayTextureOffset.value.set(
      payload.frameState.post.shaderControls.textureLayer.offsetX,
      payload.frameState.post.shaderControls.textureLayer.offsetY,
    );
    this.feedback.compositeMaterial.uniforms.warpTextureSource.value =
      getShaderTextureSourceId(
        payload.frameState.post.shaderControls.warpTexture.source,
      );
    this.feedback.compositeMaterial.uniforms.warpTextureAmount.value =
      payload.frameState.post.shaderControls.warpTexture.amount;
    this.feedback.compositeMaterial.uniforms.warpTextureScale.value.set(
      payload.frameState.post.shaderControls.warpTexture.scaleX,
      payload.frameState.post.shaderControls.warpTexture.scaleY,
    );
    this.feedback.compositeMaterial.uniforms.warpTextureOffset.value.set(
      payload.frameState.post.shaderControls.warpTexture.offsetX,
      payload.frameState.post.shaderControls.warpTexture.offsetY,
    );
    this.feedback.compositeMaterial.uniforms.signalBass.value =
      payload.frameState.signals.bass;
    this.feedback.compositeMaterial.uniforms.signalMid.value =
      payload.frameState.signals.mid;
    this.feedback.compositeMaterial.uniforms.signalTreb.value =
      payload.frameState.signals.treb;
    this.feedback.compositeMaterial.uniforms.signalBeat.value =
      payload.frameState.signals.beatPulse;
    this.feedback.compositeMaterial.uniforms.signalEnergy.value =
      payload.frameState.signals.weightedEnergy;
    this.feedback.compositeMaterial.uniforms.signalTime.value =
      payload.frameState.signals.time;

    this.renderer.setRenderTarget(this.feedback.sceneTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(this.feedback.writeTarget);
    this.renderer.render(this.feedback.compositeScene, this.feedback.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.feedback.presentScene, this.feedback.camera);
    this.feedback.swap();
    return true;
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
    this.feedback?.dispose();
    this.scene.remove(this.root);
  }
}

export function createMilkdropRendererAdapterCore({
  scene,
  camera,
  renderer,
  backend,
  behavior,
  createFeedbackManager,
}: MilkdropRendererAdapterConfig) {
  return new ThreeMilkdropAdapter({
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
  });
}

export const createMilkdropRendererAdapter = createMilkdropRendererAdapterCore;
