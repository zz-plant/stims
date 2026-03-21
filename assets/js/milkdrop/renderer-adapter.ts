import type { Camera, Scene } from 'three';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
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
} from 'three';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import type {
  MilkdropBorderVisual,
  MilkdropColor,
  MilkdropCompiledPreset,
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
  MilkdropFeedbackSetRenderTarget,
  MilkdropGpuGeometryHints,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralFieldTransformVisual,
  MilkdropProceduralWaveVisual,
  MilkdropRendererAdapter,
  MilkdropRenderPayload,
  MilkdropRuntimeSignals,
  MilkdropShapeVisual,
  MilkdropWaveVisual,
  MilkdropWebGpuDescriptorPlan,
} from './types';

type RendererLike = {
  getSize?: (target: Vector2) => Vector2;
  render: (scene: Scene, camera: Camera) => void;
  setRenderTarget?: RendererSetRenderTarget;
};

type RendererSetRenderTarget = {
  bivarianceHack: MilkdropFeedbackSetRenderTarget;
}['bivarianceHack'];

type ProceduralWaveSync = (
  object: Line | undefined,
  wave: MilkdropProceduralWaveVisual,
  signals: MilkdropRuntimeSignals,
) => Line;

type ProceduralCustomWaveSync = (
  object: Line | undefined,
  wave: MilkdropProceduralCustomWaveVisual,
  signals: MilkdropRuntimeSignals,
) => Line;

export type MilkdropRendererAdapterConfig = {
  scene: Scene;
  camera: Camera;
  renderer?: RendererLike | null;
  backend: 'webgl' | 'webgpu';
  preset?: MilkdropCompiledPreset | null;
  behavior?: MilkdropBackendBehavior;
  createFeedbackManager?: MilkdropFeedbackManagerFactory;
  syncWebGPUProceduralWaveObject?: ProceduralWaveSync;
  syncWebGPUProceduralCustomWaveObject?: ProceduralCustomWaveSync;
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
  supportsShapeGradient: false,
  supportsFeedbackPass: true,
};

const SHARED_GEOMETRY_FLAG = 'milkdropSharedGeometry';
const PROCEDURAL_MESH_BOUNDS_RADIUS = Math.SQRT2 * 2;
const PROCEDURAL_MOTION_VECTOR_BOUNDS_RADIUS = Math.SQRT2 * 2.35;
const PROCEDURAL_WAVE_BOUNDS_RADIUS = Math.SQRT2 * 2.2;
const BACKGROUND_GEOMETRY = markSharedGeometry(new PlaneGeometry(6.4, 6.4));
const polygonFillGeometryCache = new Map<number, ShapeGeometry>();
const polygonOutlineGeometryCache = new Map<string, BufferGeometry>();
const proceduralMeshGeometryCache = new Map<number, BufferGeometry>();
const proceduralMotionVectorGeometryCache = new Map<string, BufferGeometry>();
const proceduralWaveGeometryCache = new Map<number, BufferGeometry>();

type ProceduralFieldUniformState = {
  zoom: { value: number };
  zoomExponent: { value: number };
  rotation: { value: number };
  warp: { value: number };
  warpAnimSpeed: { value: number };
  centerX: { value: number };
  centerY: { value: number };
  scaleX: { value: number };
  scaleY: { value: number };
  translateX: { value: number };
  translateY: { value: number };
  time: { value: number };
  trebleAtt: { value: number };
  tint: { value: Color };
  alpha: { value: number };
};

function createProceduralFieldUniformState() {
  return {
    zoom: { value: 1 },
    zoomExponent: { value: 1 },
    rotation: { value: 0 },
    warp: { value: 0 },
    warpAnimSpeed: { value: 1 },
    centerX: { value: 0 },
    centerY: { value: 0 },
    scaleX: { value: 1 },
    scaleY: { value: 1 },
    translateX: { value: 0 },
    translateY: { value: 0 },
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
    float transformedX = (source.x - centerX) * scaleX + centerX + translateX;
    float transformedY = (source.y - centerY) * scaleY + centerY + translateY;
    float ripple = sin(
      radius * 12.0 +
      time * (0.6 + trebleAtt) * (0.35 + warpAnimSpeed)
    ) * warp * 0.08;
    float radiusNormalized = clamp(radius / 1.41421356237, 0.0, 1.0);
    float zoomScale = pow(
      max(zoom, 0.0001),
      pow(max(zoomExponent, 0.0001), radiusNormalized * 2.0 - 1.0)
    );
    vec2 warped = vec2(
      (transformedX + cos(angle * 3.0) * ripple) * zoomScale,
      (transformedY + sin(angle * 4.0) * ripple) * zoomScale
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
      uniform float zoomExponent;
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
  const uniforms = {
    ...createProceduralFieldUniformState(),
    sourceOffsetX: { value: 0 },
    sourceOffsetY: { value: 0 },
    explicitLength: { value: 0 },
    legacyControls: { value: 0 },
  };
  return new ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: `
      attribute vec3 sourcePosition;
      attribute float endpointWeight;
      uniform float zoom;
      uniform float zoomExponent;
      uniform float rotation;
      uniform float warp;
      uniform float warpAnimSpeed;
      uniform float centerX;
      uniform float centerY;
      uniform float scaleX;
      uniform float scaleY;
      uniform float translateX;
      uniform float translateY;
      uniform float time;
      uniform float trebleAtt;
      uniform float sourceOffsetX;
      uniform float sourceOffsetY;
      uniform float explicitLength;
      varying float vAlpha;
      ${PROCEDURAL_FIELD_SHADER_CHUNK}

      void main() {
        vec2 source = clamp(
          sourcePosition.xy + vec2(sourceOffsetX, sourceOffsetY),
          vec2(-1.0),
          vec2(1.0)
        );
        vec2 current = milkdropTransformPoint(source);
        vec2 delta = clamp((current - source) * 1.35, vec2(-0.24), vec2(0.24));
        float magnitude = length(delta);
        if (explicitLength > 0.0001 && magnitude > 0.0001) {
          delta = delta / magnitude * explicitLength;
          magnitude = length(delta);
        }
        vec2 renderPoint = mix(
          current - delta * 0.45,
          current + delta,
          endpointWeight
        );
        vAlpha = alpha * clamp(0.75 + magnitude * 2.2, 0.0, 1.0) * step(0.002, magnitude);
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

function createProceduralWaveMaterial() {
  return new ShaderMaterial({
    uniforms: {
      mode: { value: 0 },
      centerX: { value: 0 },
      centerY: { value: 0 },
      scale: { value: 0.34 },
      mystery: { value: 0 },
      signalTime: { value: 0 },
      beatPulse: { value: 0 },
      trebleAtt: { value: 0 },
      tint: { value: new Color(1, 1, 1) },
      alpha: { value: 1 },
    },
    transparent: true,
    vertexShader: `
      attribute float sampleT;
      attribute float sampleValue;
      attribute float sampleVelocity;
      uniform float mode;
      uniform float centerX;
      uniform float centerY;
      uniform float scale;
      uniform float mystery;
      uniform float signalTime;
      uniform float beatPulse;
      uniform float trebleAtt;

      vec2 milkdropWavePoint(float t, float sampleValue, float velocity) {
        float centeredSample = sampleValue - 0.5;
        float mysteryPhase = mystery * 3.141592653589793;
        float x = 0.0;
        float y = 0.0;

        if (mode < 0.5) {
          x = -1.1 + t * 2.2;
          y =
            centerY +
            sin(t * 3.141592653589793 * 2.0 + signalTime * (0.55 + mystery)) *
              (0.06 + trebleAtt * 0.08) +
            centeredSample * scale * 1.7 +
            velocity * 0.12;
        } else if (mode < 1.5) {
          float angle =
            t * 3.141592653589793 * 2.0 +
            signalTime * 0.32 +
            centeredSample * 0.8 +
            velocity * 2.5;
          float radius =
            0.22 +
            sampleValue * scale +
            beatPulse * 0.08 +
            sin(t * 3.141592653589793 * 4.0 + signalTime) * 0.015;
          x = centerX + cos(angle) * radius;
          y = centerY + sin(angle) * radius;
        } else if (mode < 2.5) {
          float angle =
            t * 3.141592653589793 * 5.0 +
            signalTime * (0.4 + mystery * 0.2) +
            centeredSample * 0.65;
          float radius =
            0.08 + t * 0.6 + sampleValue * scale * 0.6 + velocity * 0.12;
          x = centerX + cos(angle) * radius;
          y = centerY + sin(angle) * radius;
        } else if (mode < 3.5) {
          float angle = t * 3.141592653589793 * 2.0 + signalTime * 0.22;
          float spoke =
            0.2 +
            sampleValue * scale * 1.05 +
            sin(t * 3.141592653589793 * 12.0 + mysteryPhase) * 0.05 +
            velocity * 0.09;
          float pinch = 0.55 + cos(t * 3.141592653589793 * 6.0 + signalTime) * 0.2;
          x = centerX + cos(angle) * spoke;
          y = centerY + sin(angle) * spoke * pinch;
        } else if (mode < 4.5) {
          x =
            centerX +
            (sampleValue - 0.5) * scale * 1.85 +
            sin(t * 3.141592653589793 * 10.0 + signalTime * 0.5) * 0.04;
          y = 1.08 - t * 2.16 + velocity * 0.22;
        } else if (mode < 5.5) {
          float angle = t * 3.141592653589793 * 2.0 + signalTime * 0.18;
          float xAmp = 0.26 + sampleValue * scale * 0.75;
          float yAmp = 0.18 + sampleValue * scale;
          x =
            centerX +
            sin(angle * (2.0 + mystery * 0.6)) * xAmp +
            cos(angle * 4.0 + mysteryPhase) * 0.04 +
            velocity * 0.16;
          y =
            centerY +
            sin(angle * (3.0 + mystery * 0.5) + 3.141592653589793 / 2.0) * yAmp;
        } else if (mode < 6.5) {
          float band = (sampleValue - 0.5) * scale * 1.4;
          x = -1.05 + t * 2.1;
          y =
            centerY +
            (mod(floor(t * 512.0), 2.0) < 0.5 ? band : -band) +
            sin(t * 3.141592653589793 * 8.0 + signalTime * 0.55) * 0.03 +
            velocity * 0.18;
        } else {
          float angle = t * 3.141592653589793 * 2.0 + signalTime * (0.24 + mystery * 0.1);
          float petals = 3.0 + floor(clamp(mystery * 3.0, 0.0, 3.0) + 0.5);
          float radius =
            0.12 +
            (0.2 + sampleValue * scale * 0.9) *
              cos(petals * angle + mysteryPhase) +
            velocity * 0.14;
          x = centerX + cos(angle) * radius;
          y = centerY + sin(angle) * radius;
        }

        return vec2(x, y);
      }

      void main() {
        vec2 point = milkdropWavePoint(sampleT, sampleValue, sampleVelocity);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 0.24, 1.0);
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

function createProceduralCustomWaveMaterial() {
  return new ShaderMaterial({
    uniforms: {
      centerX: { value: 0 },
      centerY: { value: 0 },
      scaling: { value: 1 },
      mystery: { value: 0 },
      signalTime: { value: 0 },
      spectrum: { value: 0 },
      tint: { value: new Color(1, 1, 1) },
      alpha: { value: 1 },
    },
    transparent: true,
    vertexShader: `
      attribute float sampleT;
      attribute float sampleValue;
      uniform float centerX;
      uniform float centerY;
      uniform float scaling;
      uniform float mystery;
      uniform float signalTime;
      uniform float spectrum;

      void main() {
        float x = centerX + (-1.0 + sampleT * 2.0) * 0.85;
        float baseY =
          centerY +
          (sampleValue - 0.5) *
            0.55 *
            scaling *
            (1.0 + mystery * 0.25);
        float orbitalY =
          centerY +
          sin(sampleT * 3.141592653589793 * 2.0 * (1.0 + mystery) + signalTime) *
            0.18 *
            scaling;
        float y = mix(orbitalY, baseY, spectrum);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y, 0.28, 1.0);
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
  setSharedGeometryBounds(geometry, { radius: PROCEDURAL_MESH_BOUNDS_RADIUS });
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
  setSharedGeometryBounds(geometry, {
    radius: PROCEDURAL_MOTION_VECTOR_BOUNDS_RADIUS,
  });
  proceduralMotionVectorGeometryCache.set(cacheKey, geometry);
  return geometry;
}

function getProceduralWaveGeometry(sampleCount: number) {
  const safeCount = Math.max(2, Math.round(sampleCount));
  const cached = proceduralWaveGeometryCache.get(safeCount);
  if (cached) {
    return cached;
  }

  const positions = new Array(safeCount * 3).fill(0);
  const sampleT = Array.from(
    { length: safeCount },
    (_, index) => index / Math.max(1, safeCount - 1),
  );

  const geometry = markSharedGeometry(new BufferGeometry());
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('sampleT', new Float32BufferAttribute(sampleT, 1));
  setSharedGeometryBounds(geometry, { radius: PROCEDURAL_WAVE_BOUNDS_RADIUS });
  proceduralWaveGeometryCache.set(safeCount, geometry);
  return geometry;
}

function createProceduralWaveObjectGeometry(sampleCount: number) {
  const geometry = getProceduralWaveGeometry(sampleCount).clone();
  setGeometryBoundingSphere(
    geometry,
    new Vector3(0, 0, 0),
    PROCEDURAL_WAVE_BOUNDS_RADIUS,
  );
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
    zoomExponent,
    rotation,
    warp,
    warpAnimSpeed,
    centerX,
    centerY,
    scaleX,
    scaleY,
    translateX,
    translateY,
    time,
    trebleAtt,
    tint,
    alpha,
  }: MilkdropProceduralFieldTransformVisual & {
    time: number;
    trebleAtt: number;
    tint: { r: number; g: number; b: number };
    alpha: number;
  },
) {
  material.uniforms.zoom.value = zoom;
  material.uniforms.zoomExponent.value = zoomExponent;
  material.uniforms.rotation.value = rotation;
  material.uniforms.warp.value = warp;
  material.uniforms.warpAnimSpeed.value = warpAnimSpeed;
  material.uniforms.centerX.value = centerX;
  material.uniforms.centerY.value = centerY;
  material.uniforms.scaleX.value = scaleX;
  material.uniforms.scaleY.value = scaleY;
  material.uniforms.translateX.value = translateX;
  material.uniforms.translateY.value = translateY;
  material.uniforms.time.value = time;
  material.uniforms.trebleAtt.value = trebleAtt;
  material.uniforms.tint.value.setRGB(tint.r, tint.g, tint.b);
  material.uniforms.alpha.value = alpha;
}

function syncProceduralWaveObject(
  object: Line | undefined,
  wave: MilkdropProceduralWaveVisual,
) {
  const next =
    object ??
    new Line(
      createProceduralWaveObjectGeometry(wave.sampleCount),
      createProceduralWaveMaterial(),
    );
  if (!(next.material instanceof ShaderMaterial)) {
    if ('material' in next) {
      disposeMaterial(next.material);
    }
    next.material = createProceduralWaveMaterial();
  }

  const sampleTAttribute = next.geometry.getAttribute('sampleT');
  if (
    !(
      sampleTAttribute instanceof Float32BufferAttribute &&
      sampleTAttribute.array.length === wave.sampleCount
    )
  ) {
    if (!isSharedGeometry(next.geometry)) {
      disposeGeometry(next.geometry);
    }
    next.geometry = createProceduralWaveObjectGeometry(wave.sampleCount);
  }

  const material = next.material as ShaderMaterial;
  material.uniforms.mode.value = wave.mode;
  material.uniforms.centerX.value = wave.centerX;
  material.uniforms.centerY.value = wave.centerY;
  material.uniforms.scale.value = wave.scale;
  material.uniforms.mystery.value = wave.mystery;
  material.uniforms.signalTime.value = wave.time;
  material.uniforms.beatPulse.value = wave.beatPulse;
  material.uniforms.trebleAtt.value = wave.trebleAtt;
  material.uniforms.tint.value.setRGB(wave.color.r, wave.color.g, wave.color.b);
  material.uniforms.alpha.value = wave.alpha;
  material.blending = wave.additive ? AdditiveBlending : NormalBlending;
  return next;
}

function syncProceduralCustomWaveObject(
  object: Line | undefined,
  wave: MilkdropProceduralCustomWaveVisual,
) {
  const next =
    object ??
    new Line(
      createProceduralWaveObjectGeometry(wave.sampleCount),
      createProceduralCustomWaveMaterial(),
    );
  if (!(next.material instanceof ShaderMaterial)) {
    if ('material' in next) {
      disposeMaterial(next.material);
    }
    next.material = createProceduralCustomWaveMaterial();
  }

  const sampleTAttribute = next.geometry.getAttribute('sampleT');
  if (
    !(
      sampleTAttribute instanceof Float32BufferAttribute &&
      sampleTAttribute.array.length === wave.sampleCount
    )
  ) {
    if (!isSharedGeometry(next.geometry)) {
      disposeGeometry(next.geometry);
    }
    next.geometry = createProceduralWaveObjectGeometry(wave.sampleCount);
  }

  const material = next.material as ShaderMaterial;
  material.uniforms.centerX.value = wave.centerX;
  material.uniforms.centerY.value = wave.centerY;
  material.uniforms.scaling.value = wave.scaling;
  material.uniforms.mystery.value = wave.mystery;
  material.uniforms.signalTime.value = wave.time;
  material.uniforms.spectrum.value = wave.spectrum ? 1 : 0;
  material.uniforms.tint.value.setRGB(wave.color.r, wave.color.g, wave.color.b);
  material.uniforms.alpha.value = wave.alpha;
  material.blending = wave.additive ? AdditiveBlending : NormalBlending;
  return next;
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
    const attribute = new Float32BufferAttribute(positions, 3);
    attribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', attribute);
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
  const group = markAlwaysOnscreen(new Group());
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

  const fill = markAlwaysOnscreen(
    new Mesh(
      new ShapeGeometry(fillShape),
      new MeshBasicMaterial({
        transparent: true,
        opacity: Math.max(0.08, border.alpha * 0.45) * alphaMultiplier,
        side: DoubleSide,
      }),
    ),
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
  outline.frustumCulled = false;
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
  accent.frustumCulled = false;
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

function createLineObject(
  positions: number[],
  color: MilkdropColor,
  alpha: number,
  additive: boolean,
) {
  const object = markAlwaysOnscreen(
    new Line(
      new BufferGeometry(),
      new LineBasicMaterial({
        transparent: true,
        opacity: alpha,
        ...(additive ? { blending: AdditiveBlending } : {}),
      }),
    ),
  );
  ensureGeometryPositions(object.geometry, positions);
  setMaterialColor(object.material, color, alpha);
  object.position.z = 0.24;
  return object;
}

function syncLineObject(
  existing: Line | undefined,
  {
    positions,
    color,
    alpha,
    additive,
  }: {
    positions: number[];
    color: MilkdropColor;
    alpha: number;
    additive: boolean;
  },
  alphaMultiplier: number,
) {
  if (!(existing instanceof Line) || existing instanceof LineLoop) {
    if (existing) {
      disposeObject(existing);
    }
    return createLineObject(
      positions,
      color,
      alpha * alphaMultiplier,
      additive,
    );
  }

  ensureGeometryPositions(existing.geometry, positions);
  const material = existing.material as LineBasicMaterial;
  material.blending = additive ? AdditiveBlending : NormalBlending;
  setMaterialColor(material, color, alpha * alphaMultiplier);
  existing.position.z = 0.24;
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
  private readonly syncWebGPUProceduralWaveObject: ProceduralWaveSync | null;
  private readonly syncWebGPUProceduralCustomWaveObject: ProceduralCustomWaveSync | null;
  readonly backend: 'webgl' | 'webgpu';
  private readonly behavior: MilkdropBackendBehavior;
  private readonly createFeedbackManager: MilkdropFeedbackManagerFactory | null;
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
  private readonly feedback: MilkdropFeedbackManager | null;
  private webgpuDescriptorPlan: MilkdropWebGpuDescriptorPlan | null = null;

  constructor({
    scene,
    camera,
    renderer,
    backend,
    behavior,
    createFeedbackManager,
    syncWebGPUProceduralWaveObject,
    syncWebGPUProceduralCustomWaveObject,
  }: {
    scene: Scene;
    camera: Camera;
    renderer: RendererLike | null;
    backend: 'webgl' | 'webgpu';
    behavior: MilkdropBackendBehavior;
    createFeedbackManager: MilkdropFeedbackManagerFactory | null;
    syncWebGPUProceduralWaveObject: ProceduralWaveSync | null;
    syncWebGPUProceduralCustomWaveObject: ProceduralCustomWaveSync | null;
  }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.backend = backend;
    this.behavior = behavior;
    this.createFeedbackManager = createFeedbackManager;
    this.syncWebGPUProceduralWaveObject = syncWebGPUProceduralWaveObject;
    this.syncWebGPUProceduralCustomWaveObject =
      syncWebGPUProceduralCustomWaveObject;
    this.root.frustumCulled = false;

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
        ? preset.ir.compatibility.gpuDescriptorPlans.webgpu
        : null;
  }

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
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as MilkdropWaveVisual;
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
    }
    trimGroupChildren(group, waves.length);
  }

  private renderProceduralWaveGroup(
    group: Group,
    waves: MilkdropProceduralWaveVisual[],
    signals: MilkdropRuntimeSignals,
  ) {
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as MilkdropProceduralWaveVisual;
      const existing = group.children[index] as Line | undefined;
      const synced =
        this.backend === 'webgpu' && this.syncWebGPUProceduralWaveObject
          ? this.syncWebGPUProceduralWaveObject(existing, wave, signals)
          : syncProceduralWaveObject(existing, wave);
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
    signals: MilkdropRuntimeSignals,
  ) {
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index] as MilkdropProceduralCustomWaveVisual;
      const existing = group.children[index] as Line | undefined;
      const synced =
        this.backend === 'webgpu' && this.syncWebGPUProceduralCustomWaveObject
          ? this.syncWebGPUProceduralCustomWaveObject(existing, wave, signals)
          : syncProceduralCustomWaveObject(existing, wave);
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
    group: Group,
    shapes: MilkdropShapeVisual[],
    alphaMultiplier = 1,
  ) {
    for (let index = 0; index < shapes.length; index += 1) {
      const shape = shapes[index] as MilkdropShapeVisual;
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
    }
    trimGroupChildren(group, shapes.length);
  }

  private renderBorderGroup(
    group: Group,
    borders: MilkdropBorderVisual[],
    alphaMultiplier = 1,
  ) {
    for (let index = 0; index < borders.length; index += 1) {
      const border = borders[index] as MilkdropBorderVisual;
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
    }
    trimGroupChildren(group, borders.length);
  }

  private renderLineVisualGroup(
    group: Group,
    lines: Array<{
      positions: number[];
      color: MilkdropColor;
      alpha: number;
      additive?: boolean;
    }>,
    alphaMultiplier = 1,
  ) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as {
        positions: number[];
        color: MilkdropColor;
        alpha: number;
        additive?: boolean;
      };
      const existing = group.children[index] as Line | undefined;
      const synced = syncLineObject(
        existing,
        {
          positions: line.positions,
          color: line.color,
          alpha: line.alpha,
          additive: line.additive ?? false,
        },
        alphaMultiplier,
      );
      if (!existing) {
        group.add(synced);
      } else if (synced !== existing) {
        group.remove(existing);
        group.add(synced);
      }
    }
    trimGroupChildren(group, lines.length);
  }

  private renderMesh(
    mesh: MilkdropRenderPayload['frameState']['mesh'],
    gpuGeometry: MilkdropGpuGeometryHints,
    signals: MilkdropRenderPayload['frameState']['signals'],
  ) {
    const proceduralMesh =
      this.backend === 'webgpu' &&
      this.webgpuDescriptorPlan?.proceduralMesh !== null
        ? gpuGeometry.meshField
        : null;
    if (proceduralMesh) {
      if (!(this.meshLines.material instanceof ShaderMaterial)) {
        disposeMaterial(this.meshLines.material);
        this.meshLines.material = createProceduralMeshMaterial();
      }
      this.meshLines.geometry = getProceduralMeshGeometry(
        proceduralMesh.density,
      );
      syncProceduralFieldUniforms(this.meshLines.material as ShaderMaterial, {
        ...proceduralMesh,
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
      this.backend === 'webgpu' &&
      this.webgpuDescriptorPlan?.proceduralMesh?.supportsMotionVectors
        ? payload.gpuGeometry.motionVectorField
        : null;
    if (proceduralField) {
      clearGroup(this.motionVectorCpuGroup);
      this.proceduralMotionVectors.visible = true;
      if (!(this.proceduralMotionVectors.material instanceof ShaderMaterial)) {
        disposeMaterial(this.proceduralMotionVectors.material);
        this.proceduralMotionVectors.material =
          createProceduralMotionVectorMaterial();
      }
      this.proceduralMotionVectors.geometry = getProceduralMotionVectorGeometry(
        proceduralField.countX,
        proceduralField.countY,
      );
      syncProceduralFieldUniforms(
        this.proceduralMotionVectors.material as ShaderMaterial,
        {
          ...proceduralField,
          time: payload.signals.time,
          trebleAtt: payload.signals.trebleAtt,
          tint: {
            r: Math.min(Math.max(payload.variables.mv_r ?? 1, 0), 1),
            g: Math.min(Math.max(payload.variables.mv_g ?? 1, 0), 1),
            b: Math.min(Math.max(payload.variables.mv_b ?? 1, 0), 1),
          },
          alpha:
            Math.min(
              Math.max(
                payload.variables.mv_a ?? 0.35,
                proceduralField.legacyControls ? 0 : 0.02,
              ),
              1,
            ) * alphaMultiplier,
        },
      );
      const proceduralMaterial = this.proceduralMotionVectors
        .material as ShaderMaterial;
      proceduralMaterial.uniforms.sourceOffsetX.value =
        proceduralField.sourceOffsetX;
      proceduralMaterial.uniforms.sourceOffsetY.value =
        proceduralField.sourceOffsetY;
      proceduralMaterial.uniforms.explicitLength.value =
        proceduralField.explicitLength;
      proceduralMaterial.uniforms.legacyControls.value =
        proceduralField.legacyControls ? 1 : 0;
      return;
    }

    this.proceduralMotionVectors.visible = false;
    this.renderLineVisualGroup(
      this.motionVectorCpuGroup,
      payload.motionVectors,
      alphaMultiplier,
    );
  }

  private buildFeedbackCompositeState(
    frameState: MilkdropRenderPayload['frameState'],
  ): MilkdropFeedbackCompositeState {
    const controls = frameState.post.shaderControls;
    const shaderPrograms = frameState.post.shaderPrograms;
    const plannedShaderExecution =
      this.backend === 'webgpu'
        ? this.webgpuDescriptorPlan?.feedback?.shaderExecution
        : null;
    const usesDirectShaderPrograms =
      plannedShaderExecution === 'direct'
        ? true
        : plannedShaderExecution === 'controls'
          ? false
          : (shaderPrograms.warp?.execution.supportedBackends.includes(
              this.backend,
            ) ??
              false) ||
            (shaderPrograms.comp?.execution.supportedBackends.includes(
              this.backend,
            ) ??
              false);
    return {
      shaderExecution: usesDirectShaderPrograms ? 'direct' : 'controls',
      shaderPrograms,
      mixAlpha: frameState.post.videoEchoEnabled
        ? frameState.post.videoEchoAlpha + controls.mixAlpha
        : controls.mixAlpha,
      zoom: frameState.post.videoEchoEnabled
        ? frameState.post.videoEchoZoom + controls.warpScale * 0.04
        : 1,
      videoEchoOrientation: frameState.post.videoEchoEnabled
        ? frameState.post.videoEchoOrientation
        : 0,
      brighten: frameState.post.brighten ? 1 : 0,
      darken: frameState.post.darken ? 1 : 0,
      darkenCenter: frameState.post.darkenCenter ? 1 : 0,
      solarize: frameState.post.solarize ? 1 : 0,
      invert: frameState.post.invert ? 1 : 0,
      gammaAdj: frameState.post.gammaAdj,
      textureWrap: frameState.post.textureWrap ? 1 : 0,
      feedbackTexture: frameState.post.feedbackTexture ? 1 : 0,
      warpScale: controls.warpScale,
      offsetX: controls.offsetX,
      offsetY: controls.offsetY,
      rotation: controls.rotation,
      zoomMul: controls.zoom,
      saturation: controls.saturation,
      contrast: controls.contrast,
      colorScale: {
        r: controls.colorScale.r,
        g: controls.colorScale.g,
        b: controls.colorScale.b,
      },
      hueShift: controls.hueShift,
      brightenBoost: controls.brightenBoost,
      invertBoost: controls.invertBoost,
      solarizeBoost: controls.solarizeBoost,
      tint: {
        r: controls.tint.r,
        g: controls.tint.g,
        b: controls.tint.b,
      },
      overlayTextureSource: getShaderTextureSourceId(
        controls.textureLayer.source,
      ),
      overlayTextureMode: getShaderTextureBlendModeId(
        controls.textureLayer.mode,
      ),
      overlayTextureSampleDimension: getShaderSampleDimensionId(
        controls.textureLayer.sampleDimension,
      ),
      overlayTextureInvert: controls.textureLayer.inverted ? 1 : 0,
      overlayTextureAmount: controls.textureLayer.amount,
      overlayTextureScale: {
        x: controls.textureLayer.scaleX,
        y: controls.textureLayer.scaleY,
      },
      overlayTextureOffset: {
        x: controls.textureLayer.offsetX,
        y: controls.textureLayer.offsetY,
      },
      overlayTextureVolumeSliceZ: controls.textureLayer.volumeSliceZ ?? 0,
      warpTextureSource: getShaderTextureSourceId(controls.warpTexture.source),
      warpTextureSampleDimension: getShaderSampleDimensionId(
        controls.warpTexture.sampleDimension,
      ),
      warpTextureAmount: controls.warpTexture.amount,
      warpTextureScale: {
        x: controls.warpTexture.scaleX,
        y: controls.warpTexture.scaleY,
      },
      warpTextureOffset: {
        x: controls.warpTexture.offsetX,
        y: controls.warpTexture.offsetY,
      },
      warpTextureVolumeSliceZ: controls.warpTexture.volumeSliceZ ?? 0,
      signalBass: frameState.signals.bass,
      signalMid: frameState.signals.mid,
      signalTreb: frameState.signals.treb,
      signalBeat: frameState.signals.beatPulse,
      signalEnergy: frameState.signals.weightedEnergy,
      signalTime: frameState.signals.time,
    };
  }

  render(payload: MilkdropRenderPayload) {
    const backgroundMaterial = this.background.material as MeshBasicMaterial;
    setMaterialColor(backgroundMaterial, payload.frameState.background, 1);

    this.renderMesh(
      payload.frameState.mesh,
      payload.frameState.gpuGeometry,
      payload.frameState.signals,
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
      this.renderProceduralWaveGroup(
        this.mainWaveGroup,
        [payload.frameState.gpuGeometry.mainWave],
        payload.frameState.signals,
      );
    } else {
      this.renderWaveGroup(this.mainWaveGroup, [payload.frameState.mainWave]);
    }
    if (
      canUseProceduralCustomWaves &&
      payload.frameState.gpuGeometry.customWaves.length > 0
    ) {
      this.renderProceduralCustomWaveGroup(
        this.customWaveGroup,
        payload.frameState.gpuGeometry.customWaves,
        payload.frameState.signals,
      );
    } else {
      this.renderWaveGroup(
        this.customWaveGroup,
        payload.frameState.customWaves,
      );
    }
    if (
      canUseProceduralTrailWaves &&
      payload.frameState.gpuGeometry.trailWaves.length > 0
    ) {
      this.renderProceduralWaveGroup(
        this.trailGroup,
        payload.frameState.gpuGeometry.trailWaves,
        payload.frameState.signals,
      );
    } else {
      this.renderLineVisualGroup(this.trailGroup, payload.frameState.trails);
    }
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
    this.renderLineVisualGroup(
      this.blendMotionVectorGroup,
      blend?.motionVectors ?? [],
      blend?.alpha ?? 0,
    );

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
    this.feedback?.dispose();
    this.scene.remove(this.root);
  }
}

export function createMilkdropRendererAdapterCore(
  config: MilkdropRendererAdapterConfig,
) {
  const {
    scene,
    camera,
    renderer,
    backend,
    preset,
    behavior,
    createFeedbackManager,
  } = config;
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
    syncWebGPUProceduralWaveObject:
      config.syncWebGPUProceduralWaveObject ?? null,
    syncWebGPUProceduralCustomWaveObject:
      config.syncWebGPUProceduralCustomWaveObject ?? null,
  });
  if (preset) {
    adapter.setPreset(preset);
  }
  return adapter;
}

export const createMilkdropRendererAdapter = createMilkdropRendererAdapterCore;
