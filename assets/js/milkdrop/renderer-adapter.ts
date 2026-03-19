import type { Camera, Scene } from 'three';
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HalfFloatType,
  Line,
  LinearFilter,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  OrthographicCamera,
  Path,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Sphere,
  Scene as ThreeScene,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import type {
  MilkdropBorderVisual,
  MilkdropCompiledPreset,
  MilkdropRendererAdapter,
  MilkdropRenderPayload,
  MilkdropShapeVisual,
  MilkdropWaveVisual,
} from './types';

type RendererLike = {
  getSize?: (target: Vector2) => Vector2;
  render: (scene: Scene, camera: Camera) => void;
  setRenderTarget?: (target: WebGLRenderTarget | null) => void;
};

type FeedbackBackendProfile = {
  currentFrameBoost: number;
  feedbackSoftness: number;
  resolutionScale: number;
  samples: number;
};

const SHARED_GEOMETRY_FLAG = 'milkdropSharedGeometry';
const SHARED_BOUNDS_RADIUS = 4;
const FULLSCREEN_QUAD_GEOMETRY = markSharedGeometry(new PlaneGeometry(2, 2));
const BACKGROUND_GEOMETRY = markSharedGeometry(new PlaneGeometry(6.4, 6.4));
const polygonFillGeometryCache = new Map<number, ShapeGeometry>();
const polygonOutlineGeometryCache = new Map<number, BufferGeometry>();

function getFeedbackBackendProfile(
  backend: 'webgl' | 'webgpu',
): FeedbackBackendProfile {
  return backend === 'webgpu'
    ? {
        currentFrameBoost: 0.1,
        feedbackSoftness: 0.65,
        resolutionScale: 1.1,
        samples: 4,
      }
    : {
        currentFrameBoost: 0,
        feedbackSoftness: 0,
        resolutionScale: 0.85,
        samples: 0,
      };
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
  const cached = polygonOutlineGeometryCache.get(safeSides);
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
  polygonOutlineGeometryCache.set(safeSides, geometry);
  return geometry;
}

function isFeedbackCapableRenderer(
  renderer: RendererLike | null,
): renderer is RendererLike & {
  getSize: (target: Vector2) => Vector2;
  setRenderTarget: (target: WebGLRenderTarget | null) => void;
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

function createFeedbackRenderTarget(
  width: number,
  height: number,
  backend: 'webgl' | 'webgpu',
) {
  const profile = getFeedbackBackendProfile(backend);
  const resolutionScale = profile.resolutionScale;
  const scaledWidth = Math.max(1, Math.round(width * resolutionScale));
  const scaledHeight = Math.max(1, Math.round(height * resolutionScale));
  const target = new WebGLRenderTarget(scaledWidth, scaledHeight, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    ...(backend === 'webgpu'
      ? {
          type: HalfFloatType,
        }
      : {}),
  });
  target.samples = profile.samples;
  return target;
}

function createWaveObject(
  wave: MilkdropWaveVisual | null,
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

  const ObjectType = wave.closed ? LineLoop : Line;
  const object = new ObjectType(
    new BufferGeometry(),
    new LineBasicMaterial({
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

function createShapeObject(shape: MilkdropShapeVisual, alphaMultiplier = 1) {
  const group = new Group();
  const fillMaterial = shape.secondaryColor
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
        color: new Color(shape.color.r, shape.color.g, shape.color.b),
        opacity: (shape.color.a ?? 0.4) * alphaMultiplier,
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
    const accentBorder = new LineLoop(
      getUnitPolygonOutlineGeometry(shape.sides),
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

  const border = new LineLoop(
    getUnitPolygonOutlineGeometry(shape.sides),
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
  alphaMultiplier: number,
) {
  const wantsGradient = Boolean(shape.secondaryColor);
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
    mesh.material = new MeshBasicMaterial({
      color: new Color(shape.color.r, shape.color.g, shape.color.b),
      opacity: (shape.color.a ?? 0.4) * alphaMultiplier,
      transparent: true,
      side: DoubleSide,
      ...(shape.additive ? { blending: AdditiveBlending } : {}),
    });
  }

  const material = mesh.material as MeshBasicMaterial;
  material.blending = shape.additive ? AdditiveBlending : NormalBlending;
  setMaterialColor(
    material,
    shape.color,
    (shape.color.a ?? 0.4) * alphaMultiplier,
  );
}

function syncShapeOutline(
  object: LineLoop,
  shape: MilkdropShapeVisual,
  alphaMultiplier: number,
  opacity: number,
) {
  if (object.geometry !== getUnitPolygonOutlineGeometry(shape.sides)) {
    object.geometry = getUnitPolygonOutlineGeometry(shape.sides);
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
    return createShapeObject(shape, alphaMultiplier);
  }

  const fill = existing.children[0];
  const accent = existing.children[1];
  const border = existing.children[wantsAccent ? 2 : 1];

  if (
    !(fill instanceof Mesh) ||
    !(border instanceof LineLoop) ||
    (wantsAccent && !(accent instanceof LineLoop))
  ) {
    disposeObject(existing);
    return createShapeObject(shape, alphaMultiplier);
  }

  if (fill.geometry !== getUnitPolygonFillGeometry(shape.sides)) {
    fill.geometry = getUnitPolygonFillGeometry(shape.sides);
  }
  fill.position.set(shape.x, shape.y, fillZ);
  fill.scale.set(shape.radius, shape.radius, 1);
  fill.rotation.z = shape.rotation;
  syncShapeFillMaterial(fill, shape, alphaMultiplier);

  if (wantsAccent && accent instanceof LineLoop) {
    syncShapeOutline(
      accent,
      shape,
      alphaMultiplier,
      Math.max(0.2, (shape.borderColor.a ?? 1) * 0.45),
    );
    accent.scale.set(shape.radius * 1.045, shape.radius * 1.045, 1);
    accent.position.z = accentZ;
  }

  syncShapeOutline(border, shape, alphaMultiplier, shape.borderColor.a ?? 1);
  border.position.z = borderZ;

  if (!wantsAccent && accent) {
    disposeObject(accent as { children?: unknown[] });
    existing.remove(accent);
  } else if (wantsAccent && !(accent instanceof LineLoop)) {
    const nextAccent = new LineLoop(
      getUnitPolygonOutlineGeometry(shape.sides),
      new LineBasicMaterial({
        transparent: true,
      }),
    );
    existing.add(nextAccent);
    syncShapeOutline(
      nextAccent,
      shape,
      alphaMultiplier,
      Math.max(0.2, (shape.borderColor.a ?? 1) * 0.45),
    );
    nextAccent.scale.set(shape.radius * 1.045, shape.radius * 1.045, 1);
    nextAccent.position.z = accentZ;
  }

  return existing;
}

function createBorderObject(border: MilkdropBorderVisual, alphaMultiplier = 1) {
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const left = -1 + inset * 2;
  const right = 1 - inset * 2;
  const top = 1 - inset * 2;
  const bottom = -1 + inset * 2;
  const positions = [
    left,
    top,
    0.3,
    right,
    top,
    0.3,
    right,
    top,
    0.3,
    right,
    bottom,
    0.3,
    right,
    bottom,
    0.3,
    left,
    bottom,
    0.3,
    left,
    bottom,
    0.3,
    left,
    top,
    0.3,
  ];
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

  const outline = new LineLoop(
    new BufferGeometry(),
    new LineBasicMaterial({
      transparent: true,
      opacity: border.alpha * alphaMultiplier,
    }),
  );
  ensureGeometryPositions(outline.geometry, positions);
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

  const accent = new LineLoop(
    new BufferGeometry(),
    new LineBasicMaterial({
      transparent: true,
      opacity: Math.max(0.15, border.alpha * 0.55) * alphaMultiplier,
    }),
  );
  ensureGeometryPositions(accent.geometry, positions);
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
  alphaMultiplier: number,
) {
  ensureGeometryPositions(object.geometry, wave.positions);
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
  alphaMultiplier: number,
) {
  const wantsPoints = wave.drawMode === 'dots';
  const wantsLoop = wave.closed && !wantsPoints;
  const matches =
    !!existing &&
    ((wantsPoints && existing instanceof Points) ||
      (wantsLoop && existing instanceof LineLoop) ||
      (!wantsPoints && !wantsLoop && existing instanceof Line));

  if (!matches) {
    if (existing) {
      disposeObject(existing);
    }
    const created = createWaveObject(wave, alphaMultiplier);
    return created;
  }

  updateWaveObject(existing, wave, alphaMultiplier);
  return existing;
}

function updateBorderLine(
  object: LineLoop,
  border: MilkdropBorderVisual,
  alphaMultiplier: number,
) {
  const inset = border.key === 'outer' ? border.size : border.size + 0.08;
  const left = -1 + inset * 2;
  const right = 1 - inset * 2;
  const top = 1 - inset * 2;
  const bottom = -1 + inset * 2;
  const previousInset = object.userData.borderInset as number | undefined;
  if (previousInset !== inset) {
    ensureGeometryPositions(object.geometry, [
      left,
      top,
      0.3,
      right,
      top,
      0.3,
      right,
      bottom,
      0.3,
      left,
      bottom,
      0.3,
    ]);
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
  alphaMultiplier: number,
) {
  if (!(existing instanceof Group)) {
    if (existing) {
      disposeObject(existing);
    }
    return createBorderObject(border, alphaMultiplier);
  }

  const fill = existing.children[0];
  const outline = existing.children[1];
  const accent = existing.children[2];
  const wantsAccent = border.styled;
  if (
    !(fill instanceof Mesh) ||
    !(outline instanceof LineLoop) ||
    (wantsAccent && !(accent instanceof LineLoop))
  ) {
    disposeObject(existing);
    return createBorderObject(border, alphaMultiplier);
  }

  updateBorderFill(fill, border, alphaMultiplier);
  updateBorderLine(outline, border, alphaMultiplier);
  outline.position.z = 0.3;
  if (wantsAccent && accent instanceof LineLoop) {
    updateBorderLine(accent, border, alphaMultiplier);
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

class FeedbackManager {
  readonly compositeScene = new ThreeScene();
  readonly presentScene = new ThreeScene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
  readonly compositeMaterial: ShaderMaterial;
  readonly presentMaterial: MeshBasicMaterial;
  readonly sceneTarget: WebGLRenderTarget;
  readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  readonly resolutionScale: number;
  readonly profile: FeedbackBackendProfile;
  private index = 0;

  constructor(width: number, height: number, backend: 'webgl' | 'webgpu') {
    this.camera.position.z = 1;
    this.profile = getFeedbackBackendProfile(backend);
    this.resolutionScale = this.profile.resolutionScale;
    this.sceneTarget = createFeedbackRenderTarget(width, height, backend);
    this.targets = [
      createFeedbackRenderTarget(width, height, backend),
      createFeedbackRenderTarget(width, height, backend),
    ];
    this.compositeMaterial = new ShaderMaterial({
      uniforms: {
        currentTex: { value: this.sceneTarget.texture },
        previousTex: { value: this.targets[0].texture },
        mixAlpha: { value: 0.18 },
        zoom: { value: 1.02 },
        brighten: { value: 0 },
        darken: { value: 0 },
        solarize: { value: 0 },
        invert: { value: 0 },
        gammaAdj: { value: 1 },
        textureWrap: { value: 0 },
        feedbackTexture: { value: 0 },
        warpScale: { value: 0 },
        offsetX: { value: 0 },
        offsetY: { value: 0 },
        rotation: { value: 0 },
        zoomMul: { value: 1 },
        saturation: { value: 1 },
        contrast: { value: 1 },
        colorScale: { value: new Color(1, 1, 1) },
        hueShift: { value: 0 },
        brightenBoost: { value: 0 },
        invertBoost: { value: 0 },
        solarizeBoost: { value: 0 },
        tint: { value: new Color(1, 1, 1) },
        feedbackSoftness: { value: this.profile.feedbackSoftness },
        currentFrameBoost: { value: this.profile.currentFrameBoost },
        texelSize: {
          value: new Vector2(
            1 / Math.max(1, this.sceneTarget.width),
            1 / Math.max(1, this.sceneTarget.height),
          ),
        },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D currentTex;
        uniform sampler2D previousTex;
        uniform float mixAlpha;
        uniform float zoom;
        uniform float brighten;
        uniform float darken;
        uniform float solarize;
        uniform float invert;
        uniform float gammaAdj;
        uniform float textureWrap;
        uniform float feedbackTexture;
        uniform float warpScale;
        uniform float offsetX;
        uniform float offsetY;
        uniform float rotation;
        uniform float zoomMul;
        uniform float saturation;
        uniform float contrast;
        uniform vec3 colorScale;
        uniform float hueShift;
        uniform float brightenBoost;
        uniform float invertBoost;
        uniform float solarizeBoost;
        uniform vec3 tint;
        uniform float feedbackSoftness;
        uniform float currentFrameBoost;
        uniform vec2 texelSize;
        varying vec2 vUv;

        vec3 hueRotate(vec3 color, float angle) {
          float s = sin(angle);
          float c = cos(angle);
          mat3 mat = mat3(
            0.213 + c * 0.787 - s * 0.213,
            0.715 - c * 0.715 - s * 0.715,
            0.072 - c * 0.072 + s * 0.928,
            0.213 - c * 0.213 + s * 0.143,
            0.715 + c * 0.285 + s * 0.140,
            0.072 - c * 0.072 - s * 0.283,
            0.213 - c * 0.213 - s * 0.787,
            0.715 - c * 0.715 + s * 0.715,
            0.072 + c * 0.928 + s * 0.072
          );
          return clamp(mat * color, 0.0, 1.0);
        }

        vec3 applySaturation(vec3 color, float amount) {
          float luminance = dot(color, vec3(0.299, 0.587, 0.114));
          return mix(vec3(luminance), color, amount);
        }

        vec3 applyContrast(vec3 color, float amount) {
          return clamp((color - 0.5) * amount + 0.5, 0.0, 1.0);
        }

        vec2 sampleUv(vec2 uv, float wrapMode) {
          return wrapMode > 0.5 ? fract(uv) : clamp(uv, 0.0, 1.0);
        }

        vec2 applyFeedbackWarp(vec2 uv, float amount, float rotationAmount) {
          vec2 centered = uv - 0.5;
          float radius = length(centered);
          float angle = atan(centered.y, centered.x);
          float spiral = sin(radius * 18.0 - angle * 4.0) * amount * 0.08;
          angle += spiral + rotationAmount * 0.22;
          radius *= 1.0 + cos(angle * 3.0 + radius * 10.0) * amount * 0.05;
          return vec2(cos(angle), sin(angle)) * radius + 0.5;
        }

        void main() {
          vec2 centeredUv = vUv - 0.5;
          float rotSin = sin(rotation);
          float rotCos = cos(rotation);
          vec2 rotatedUv = vec2(
            centeredUv.x * rotCos - centeredUv.y * rotSin,
            centeredUv.x * rotSin + centeredUv.y * rotCos
          );
          vec2 transformedUv = rotatedUv / max(zoomMul, 0.0001) + vec2(offsetX, offsetY);
          vec2 currentUv = applyFeedbackWarp(
            transformedUv + 0.5,
            warpScale,
            rotation
          );
          vec2 prevUv = applyFeedbackWarp(
            (currentUv - 0.5) / max(zoom, 0.0001) + 0.5,
            warpScale * 0.8,
            rotation * 0.6
          );
          vec4 current = texture2D(currentTex, sampleUv(currentUv, textureWrap));
          vec4 previous = texture2D(previousTex, sampleUv(prevUv, textureWrap));
          vec3 previousColor = previous.rgb;
          if (feedbackSoftness > 0.01) {
            vec2 sampleOffset = texelSize * (0.75 + feedbackSoftness * 0.5);
            vec3 softened = (
              previous.rgb +
              texture2D(previousTex, sampleUv(prevUv + vec2(sampleOffset.x, 0.0), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv - vec2(sampleOffset.x, 0.0), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv + vec2(0.0, sampleOffset.y), textureWrap)).rgb +
              texture2D(previousTex, sampleUv(prevUv - vec2(0.0, sampleOffset.y), textureWrap)).rgb
            ) / 5.0;
            previousColor = mix(
              previousColor,
              softened,
              clamp(feedbackSoftness * 0.45, 0.0, 0.5)
            );
          }
          vec3 color = mix(
            current.rgb,
            previousColor,
            clamp(mixAlpha + feedbackTexture * 0.2, 0.0, 1.0)
          );
          color = mix(color, current.rgb, clamp(currentFrameBoost, 0.0, 0.3));
          if (brighten > 0.01 || brightenBoost > 0.01) {
            color = min(vec3(1.0), color * (1.0 + 0.18 + brightenBoost * 0.35));
          }
          if (darken > 0.5) {
            color = color * 0.82;
          }
          if (solarize > 0.01 || solarizeBoost > 0.01) {
            color = mix(color, abs(color - 0.5) * 1.5, clamp(max(solarize, solarizeBoost), 0.0, 1.0));
          }
          if (invert > 0.01 || invertBoost > 0.01) {
            color = mix(color, 1.0 - color, clamp(max(invert, invertBoost), 0.0, 1.0));
          }
          color = hueRotate(color, hueShift);
          color = applySaturation(color, saturation);
          color = applyContrast(color, contrast);
          color *= colorScale;
          color *= tint;
          color = pow(max(color, vec3(0.0)), vec3(1.0 / max(gammaAdj, 0.0001)));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.presentMaterial = new MeshBasicMaterial({
      map: this.targets[0].texture,
    });
    const quad = new Mesh(FULLSCREEN_QUAD_GEOMETRY, this.compositeMaterial);
    const presentQuad = new Mesh(
      FULLSCREEN_QUAD_GEOMETRY,
      this.presentMaterial,
    );
    this.compositeScene.add(quad);
    this.presentScene.add(presentQuad);
  }

  get readTarget() {
    return this.targets[this.index];
  }

  get writeTarget() {
    return this.targets[(this.index + 1) % 2];
  }

  swap() {
    this.index = (this.index + 1) % 2;
    this.presentMaterial.map = this.readTarget.texture;
    this.compositeMaterial.uniforms.previousTex.value = this.readTarget.texture;
  }

  resize(width: number, height: number) {
    const scaledWidth = Math.max(1, Math.round(width * this.resolutionScale));
    const scaledHeight = Math.max(1, Math.round(height * this.resolutionScale));
    this.sceneTarget.setSize(scaledWidth, scaledHeight);
    this.targets.forEach((target) => target.setSize(scaledWidth, scaledHeight));
    this.compositeMaterial.uniforms.texelSize.value.set(
      1 / Math.max(1, scaledWidth),
      1 / Math.max(1, scaledHeight),
    );
  }

  dispose() {
    this.sceneTarget.dispose();
    this.targets.forEach((target) => target.dispose());
    disposeMaterial(this.compositeMaterial);
    disposeMaterial(this.presentMaterial);
    this.compositeScene.clear();
    this.presentScene.clear();
  }
}

class ThreeMilkdropAdapter implements MilkdropRendererAdapter {
  readonly backend: 'webgl' | 'webgpu';
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
  private readonly meshLines = new Line(
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
  private readonly blendWaveGroup = new Group();
  private readonly blendCustomWaveGroup = new Group();
  private readonly blendShapeGroup = new Group();
  private readonly blendBorderGroup = new Group();
  private readonly blendMotionVectorGroup = new Group();
  private readonly feedback: FeedbackManager | null;
  private readonly colorScaleScratch = new Color(1, 1, 1);
  private readonly tintScratch = new Color(1, 1, 1);

  constructor({
    scene,
    camera,
    renderer,
    backend,
  }: {
    scene: Scene;
    camera: Camera;
    renderer: RendererLike | null;
    backend: 'webgl' | 'webgpu';
  }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.backend = backend;

    this.background.position.z = -1.2;
    this.meshLines.position.z = -0.3;
    this.root.add(this.background);
    this.root.add(this.meshLines);
    this.root.add(this.mainWaveGroup);
    this.root.add(this.customWaveGroup);
    this.root.add(this.trailGroup);
    this.root.add(this.shapesGroup);
    this.root.add(this.borderGroup);
    this.root.add(this.motionVectorGroup);
    this.root.add(this.blendWaveGroup);
    this.root.add(this.blendCustomWaveGroup);
    this.root.add(this.blendShapeGroup);
    this.root.add(this.blendBorderGroup);
    this.root.add(this.blendMotionVectorGroup);

    if (isFeedbackCapableRenderer(renderer)) {
      const size = renderer.getSize(new Vector2());
      this.feedback = new FeedbackManager(
        Math.max(1, Math.round(size.x)),
        Math.max(1, Math.round(size.y)),
        backend,
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
      const synced = syncWaveObject(existing, wave, alphaMultiplier);
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
      const synced = syncShapeObject(existing, shape, alphaMultiplier);
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
      const synced = syncBorderObject(existing, border, alphaMultiplier);
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

  render(payload: MilkdropRenderPayload) {
    const backgroundMaterial = this.background.material as MeshBasicMaterial;
    setMaterialColor(backgroundMaterial, payload.frameState.background, 1);

    const meshMaterial = this.meshLines.material as LineBasicMaterial;
    ensureGeometryPositions(
      this.meshLines.geometry,
      payload.frameState.mesh.positions,
    );
    setMaterialColor(
      meshMaterial,
      payload.frameState.mesh.color,
      payload.frameState.mesh.alpha,
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
    this.renderWaveGroup(
      this.motionVectorGroup,
      payload.frameState.motionVectors.map((vector) => ({
        ...vector,
        drawMode: 'line',
        pointSize: 1,
      })),
    );

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
    disposeGeometry(this.meshLines.geometry);
    disposeMaterial(this.meshLines.material);
    this.feedback?.dispose();
    this.scene.remove(this.root);
  }
}

export function createMilkdropRendererAdapter({
  scene,
  camera,
  renderer,
  backend,
}: {
  scene: Scene;
  camera: Camera;
  renderer?: RendererLike | null;
  backend: 'webgl' | 'webgpu';
}) {
  return new ThreeMilkdropAdapter({
    scene,
    camera,
    renderer: renderer ?? null,
    backend,
  });
}
