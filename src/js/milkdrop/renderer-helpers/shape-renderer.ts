import type { Group, Line, LineLoop, Material, Mesh, Texture } from 'three';
import {
  AdditiveBlending,
  Color,
  DataTexture,
  DoubleSide,
  LineBasicMaterial,
  MeshBasicMaterial,
  NormalBlending,
  RGBAFormat,
  ShaderMaterial,
  Group as ThreeGroup,
  Line as ThreeLine,
  LineLoop as ThreeLineLoop,
  Mesh as ThreeMesh,
} from 'three';
import type {
  MilkdropBackendBehavior,
  MilkdropRendererBatcher,
} from '../renderer-adapter';
import type { MilkdropShapeVisual } from '../types';
import { MILKDROP_THICK_SHAPE_PASS_OFFSET } from './primitive-rasterization-metrics';
import {
  getWebGpuHelperMaterialsSync,
  isWebGpuNodeMaterial,
} from './webgpu-materials-loader';

type MilkdropRenderBackend = 'webgl' | 'webgpu';

type ShapeFillHelpers = {
  backend: MilkdropRenderBackend;
  getShapeFillFallbackColor: (
    shape: MilkdropShapeVisual,
  ) => MilkdropShapeVisual['color'];
  getShapeTexture: () => Texture | null;
};

type ShapeOutlineLayerObject = Line | LineLoop;

function shouldUseShapeShaderFill(
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  _texture: Texture | null,
) {
  return (
    (behavior.supportsShapeShaderFill &&
      Boolean(shape.secondaryColor) &&
      behavior.supportsShapeGradient) ||
    (behavior.supportsShapeShaderFill && shape.textured)
  );
}

const STATIC_SINGLE_OUTLINE_OFFSET = [{ x: 0, y: 0 }];
const REUSABLE_THICK_OUTLINE_OFFSETS = [
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
];

function getShapeOutlineOffsets(shape: MilkdropShapeVisual) {
  if (!shape.thickOutline) {
    return STATIC_SINGLE_OUTLINE_OFFSET;
  }

  const thickness = shape.borderColor.a ?? 1;
  const offset = MILKDROP_THICK_SHAPE_PASS_OFFSET * thickness * 0.5;

  REUSABLE_THICK_OUTLINE_OFFSETS[0].x = 0;
  REUSABLE_THICK_OUTLINE_OFFSETS[0].y = 0;
  REUSABLE_THICK_OUTLINE_OFFSETS[1].x = offset;
  REUSABLE_THICK_OUTLINE_OFFSETS[1].y = 0;
  REUSABLE_THICK_OUTLINE_OFFSETS[2].x = offset;
  REUSABLE_THICK_OUTLINE_OFFSETS[2].y = offset;
  REUSABLE_THICK_OUTLINE_OFFSETS[3].x = 0;
  REUSABLE_THICK_OUTLINE_OFFSETS[3].y = offset;

  return REUSABLE_THICK_OUTLINE_OFFSETS;
}

// A texture node must always hold a real texture on the WebGPU path (WGSL
// bindings cannot be null), so an untextured shape samples this 1x1 white
// placeholder with the `textured` uniform at 0. Also assigned on the WebGL
// path for symmetry — sampling white with textured=0 is a no-op there too.
let shapeFillPlaceholderTexture: Texture | null = null;

function getShapeFillPlaceholderTexture(): Texture {
  if (!shapeFillPlaceholderTexture) {
    const placeholder = new DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
      RGBAFormat,
    );
    placeholder.needsUpdate = true;
    shapeFillPlaceholderTexture = placeholder;
  }
  return shapeFillPlaceholderTexture;
}

function syncShapeShaderUniforms(
  material: ShaderMaterial,
  shape: MilkdropShapeVisual,
  texture: Texture | null,
  alphaMultiplier: number,
) {
  // Both WebGL ShaderMaterials and WebGPU NodeMaterials need sRGB→linear
  // conversion here because the renderer's outputColorSpace = SRGBColorSpace
  // re-encodes colors during output. Without this, the encoder treats sRGB
  // input as linear and applies a second gamma curve, producing darker fills.
  const primaryColor = toLinearColor(shape.color);
  const secondaryColor = toLinearColor(
    shape.secondaryColor ?? { r: 0, g: 0, b: 0 },
  );
  material.uniforms.primaryColor.value.setRGB(
    primaryColor.r,
    primaryColor.g,
    primaryColor.b,
  );
  material.uniforms.secondaryColor.value.setRGB(
    secondaryColor.r,
    secondaryColor.g,
    secondaryColor.b,
  );
  material.uniforms.primaryAlpha.value =
    (shape.color.a ?? 0.4) * alphaMultiplier;
  material.uniforms.secondaryAlpha.value =
    (shape.secondaryColor?.a ?? 0) * alphaMultiplier;
  material.uniforms.shapeTexture.value =
    texture ?? getShapeFillPlaceholderTexture();
  material.uniforms.useGradient.value = shape.secondaryColor ? 1 : 0;
  material.uniforms.textured.value = shape.textured && texture ? 1 : 0;
  material.uniforms.textureZoom.value = Math.max(
    0.0001,
    shape.textureZoom ?? 1,
  );
  material.uniforms.textureAngle.value = shape.textureAngle ?? 0;
}

function toLinearColor(color: { r: number; g: number; b: number }) {
  return new Color(color.r, color.g, color.b).convertSRGBToLinear();
}

// The WebGPU path needs a NodeMaterial (WebGPURenderer's NodeBuilder throws
// on plain ShaderMaterial), while the WebGL path keeps the original GLSL
// ShaderMaterial — this helper runs on both backends, mirroring the pattern
// in particle-field-renderer.ts. NodeMaterial/TSL come from the lazy toolkit
// (webgpu-materials-loader.ts) so 'three/webgpu' stays out of the shared
// boot-path chunk; the WebGPU adapter registers it before this runs.
function createShapeFillNodeMaterial(
  shape: MilkdropShapeVisual,
  texture: Texture | null,
  alphaMultiplier: number,
) {
  const { NodeMaterial, TSL } = getWebGpuHelperMaterialsSync();
  const {
    cameraProjectionMatrix,
    clamp: tslClamp,
    float,
    fract,
    mix,
    modelViewMatrix,
    positionGeometry,
    texture: tslTexture,
    uniform,
    vec2,
    vec4,
  } = TSL;
  const uniforms = {
    primaryColor: uniform(toLinearColor(shape.color)),
    secondaryColor: uniform(
      shape.secondaryColor
        ? toLinearColor(shape.secondaryColor)
        : new Color(0, 0, 0),
    ),
    primaryAlpha: uniform((shape.color.a ?? 0.4) * alphaMultiplier),
    secondaryAlpha: uniform((shape.secondaryColor?.a ?? 0) * alphaMultiplier),
    shapeTexture: tslTexture(texture ?? getShapeFillPlaceholderTexture()),
    useGradient: uniform(shape.secondaryColor ? 1 : 0),
    textured: uniform(shape.textured && texture ? 1 : 0),
    textureZoom: uniform(Math.max(0.0001, shape.textureZoom ?? 1)),
    textureAngle: uniform(shape.textureAngle ?? 0),
  };

  const vLocal = positionGeometry.xy;
  const blend = tslClamp(vLocal.length(), 0.0, 1.0).mul(uniforms.useGradient);
  const tint = mix(uniforms.primaryColor, uniforms.secondaryColor, blend);
  const baseAlpha = mix(uniforms.primaryAlpha, uniforms.secondaryAlpha, blend);

  const zoom = uniforms.textureZoom.max(0.0001);
  const scaled = vLocal.div(zoom);
  const angleSin = uniforms.textureAngle.sin();
  const angleCos = uniforms.textureAngle.cos();
  const rotated = vec2(
    scaled.x.mul(angleCos).sub(scaled.y.mul(angleSin)),
    scaled.x.mul(angleSin).add(scaled.y.mul(angleCos)),
  );
  const sampleUv = fract(rotated.mul(0.5).add(0.5));
  const sampled = uniforms.shapeTexture.sample(sampleUv);

  // Branchless equivalent of the GLSL `if (textured > 0.5)` block: the
  // placeholder texture keeps the sample well-defined when untextured.
  const color = mix(tint, sampled.rgb.mul(tint), uniforms.textured);
  const alpha = baseAlpha.mul(mix(float(1.0), sampled.a, uniforms.textured));

  const material = new NodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;
  if (shape.additive) {
    material.blending = AdditiveBlending;
  }
  material.vertexNode = cameraProjectionMatrix
    .mul(modelViewMatrix)
    .mul(vec4(positionGeometry, 1.0));
  material.colorNode = vec4(color, alpha);
  return Object.assign(material, { uniforms }) as unknown as ShaderMaterial;
}

function isShapeFillShaderMaterialForBackend(
  material: unknown,
  backend: MilkdropRenderBackend,
) {
  return backend === 'webgpu'
    ? isWebGpuNodeMaterial(material)
    : material instanceof ShaderMaterial;
}

function createShapeFillShaderMaterial(
  shape: MilkdropShapeVisual,
  texture: Texture | null,
  alphaMultiplier: number,
) {
  const material = new ShaderMaterial({
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
      shapeTexture: {
        value: texture ?? getShapeFillPlaceholderTexture(),
      },
      useGradient: {
        value: shape.secondaryColor ? 1 : 0,
      },
      textured: {
        value: shape.textured && texture ? 1 : 0,
      },
      textureZoom: {
        value: Math.max(0.0001, shape.textureZoom ?? 1),
      },
      textureAngle: {
        value: shape.textureAngle ?? 0,
      },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    // Flat z-layered 2D geometry: skip three.js's transparent+DoubleSide
    // two-pass render (it bumps material.needsUpdate twice per object per
    // frame, forcing getParameters/getProgram churn on every material).
    forceSinglePass: true,
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
      uniform sampler2D shapeTexture;
      uniform float useGradient;
      uniform float textured;
      uniform float textureZoom;
      uniform float textureAngle;
      varying vec2 vLocal;

      vec2 rotate2d(vec2 value, float angle) {
        float s = sin(angle);
        float c = cos(angle);
        return vec2(
          value.x * c - value.y * s,
          value.x * s + value.y * c
        );
      }

      void main() {
        float blend = clamp(length(vLocal), 0.0, 1.0);
        vec3 tint = mix(primaryColor, secondaryColor, blend * useGradient);
        float alpha = mix(primaryAlpha, secondaryAlpha, blend * useGradient);
        vec3 color = tint;

        if (textured > 0.5) {
          float zoom = max(textureZoom, 0.0001);
          vec2 scaled = vLocal / zoom;
          vec2 rotated = rotate2d(scaled, textureAngle);
          vec2 sampleUv = vec2(
            0.5 + 0.5 * rotated.x,
            0.5 + 0.5 * rotated.y
          );
          vec4 sampled = texture2D(shapeTexture, fract(sampleUv));
          color = sampled.rgb * tint;
          alpha *= sampled.a;
        }

        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  syncShapeShaderUniforms(material, shape, texture, alphaMultiplier);
  return material;
}

function createShapeFillMaterial(
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  helpers: ShapeFillHelpers,
  alphaMultiplier: number,
) {
  const texture = helpers.getShapeTexture();
  if (shouldUseShapeShaderFill(shape, behavior, texture)) {
    return helpers.backend === 'webgpu'
      ? createShapeFillNodeMaterial(shape, texture, alphaMultiplier)
      : createShapeFillShaderMaterial(shape, texture, alphaMultiplier);
  }

  const fillColor = helpers.getShapeFillFallbackColor(shape);
  return new MeshBasicMaterial({
    color: new Color(fillColor.r, fillColor.g, fillColor.b),
    opacity: (fillColor.a ?? 0.4) * alphaMultiplier,
    transparent: true,
    side: DoubleSide,
    // Flat z-layered 2D geometry: skip three.js's transparent+DoubleSide
    // two-pass render (it bumps material.needsUpdate twice per object per
    // frame, forcing getParameters/getProgram churn on every material).
    forceSinglePass: true,
    ...(shape.additive ? { blending: AdditiveBlending } : {}),
  });
}

function createShapeOutlineLayerObject(
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  helpers: {
    getUnitPolygonOutlineGeometry: (sides: number) => ThreeLine['geometry'];
    getUnitPolygonClosedLineGeometry: (sides: number) => ThreeLine['geometry'];
    setMaterialColor: (
      material: LineBasicMaterial,
      color: MilkdropShapeVisual['color'],
      alpha: number,
    ) => void;
  },
  alphaMultiplier: number,
  opacity: number,
  offsetX: number,
  offsetY: number,
) {
  const nextGeometry = behavior.useLineLoopPrimitives
    ? helpers.getUnitPolygonOutlineGeometry(shape.sides)
    : helpers.getUnitPolygonClosedLineGeometry(shape.sides);
  const object = new (
    behavior.useLineLoopPrimitives ? ThreeLineLoop : ThreeLine
  )(
    nextGeometry,
    new LineBasicMaterial({
      color: new Color(
        shape.borderColor.r,
        shape.borderColor.g,
        shape.borderColor.b,
      ),
      opacity: opacity * alphaMultiplier,
      transparent: true,
      ...(shape.additive ? { blending: AdditiveBlending } : {}),
    }),
  );
  object.position.set(shape.x + offsetX, shape.y + offsetY, 0.16);
  object.scale.set(shape.radius, shape.radius, 1);
  object.rotation.z = shape.rotation;
  helpers.setMaterialColor(
    object.material as LineBasicMaterial,
    shape.borderColor,
    opacity * alphaMultiplier,
  );
  return object;
}

function syncShapeOutlineLayerObject(
  existing: ShapeOutlineLayerObject | undefined,
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  helpers: {
    getUnitPolygonOutlineGeometry: (sides: number) => ThreeLine['geometry'];
    getUnitPolygonClosedLineGeometry: (sides: number) => ThreeLine['geometry'];
    setMaterialColor: (
      material: LineBasicMaterial,
      color: MilkdropShapeVisual['color'],
      alpha: number,
    ) => void;
  },
  alphaMultiplier: number,
  opacity: number,
  offsetX: number,
  offsetY: number,
) {
  const expectsLoop = behavior.useLineLoopPrimitives;
  const matches =
    !!existing &&
    ((expectsLoop && existing instanceof ThreeLineLoop) ||
      (!expectsLoop && existing instanceof ThreeLine));

  if (!matches) {
    return createShapeOutlineLayerObject(
      shape,
      behavior,
      helpers,
      alphaMultiplier,
      opacity,
      offsetX,
      offsetY,
    );
  }

  const nextGeometry = expectsLoop
    ? helpers.getUnitPolygonOutlineGeometry(shape.sides)
    : helpers.getUnitPolygonClosedLineGeometry(shape.sides);
  if (existing.geometry !== nextGeometry) {
    existing.geometry = nextGeometry;
  }
  existing.position.set(shape.x + offsetX, shape.y + offsetY, 0.16);
  existing.scale.set(shape.radius, shape.radius, 1);
  existing.rotation.z = shape.rotation;
  const material = existing.material as LineBasicMaterial;
  material.blending = shape.additive ? AdditiveBlending : NormalBlending;
  helpers.setMaterialColor(
    material,
    shape.borderColor,
    opacity * alphaMultiplier,
  );
  return existing;
}

function syncShapeOutlineGroup(
  existing: Group | undefined,
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  helpers: {
    disposeObject?: (object: { children?: unknown[] }) => void;
    getUnitPolygonOutlineGeometry: (sides: number) => ThreeLine['geometry'];
    getUnitPolygonClosedLineGeometry: (sides: number) => ThreeLine['geometry'];
    setMaterialColor: (
      material: LineBasicMaterial,
      color: MilkdropShapeVisual['color'],
      alpha: number,
    ) => void;
  },
  alphaMultiplier: number,
  opacity: number,
) {
  const group = existing instanceof ThreeGroup ? existing : new ThreeGroup();
  if (group !== existing && existing) {
    helpers.disposeObject?.(existing);
  }

  const offsets = getShapeOutlineOffsets(shape);
  for (let index = 0; index < offsets.length; index += 1) {
    const offset = offsets[index] as { x: number; y: number };
    const current = group.children[index] as
      | ShapeOutlineLayerObject
      | undefined;
    const synced = syncShapeOutlineLayerObject(
      current,
      shape,
      behavior,
      {
        getUnitPolygonOutlineGeometry: helpers.getUnitPolygonOutlineGeometry,
        getUnitPolygonClosedLineGeometry:
          helpers.getUnitPolygonClosedLineGeometry,
        setMaterialColor: helpers.setMaterialColor,
      },
      alphaMultiplier,
      opacity,
      offset.x,
      offset.y,
    );
    if (!current) {
      group.add(synced);
    } else if (synced !== current) {
      group.remove(current);
      helpers.disposeObject?.(current);
      group.add(synced);
    }
  }

  for (
    let index = group.children.length - 1;
    index >= offsets.length;
    index -= 1
  ) {
    const child = group.children[index];
    group.remove(child);
    helpers.disposeObject?.(child as { children?: unknown[] });
  }

  return group;
}

export function createShapeObject(
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  helpers: ShapeFillHelpers & {
    getUnitPolygonFillGeometry: (sides: number) => ThreeMesh['geometry'];
    getUnitPolygonOutlineGeometry: (sides: number) => ThreeLine['geometry'];
    getUnitPolygonClosedLineGeometry: (sides: number) => ThreeLine['geometry'];
  },
  alphaMultiplier = 1,
) {
  const group = new ThreeGroup();
  const fill = new ThreeMesh(
    helpers.getUnitPolygonFillGeometry(shape.sides),
    createShapeFillMaterial(shape, behavior, helpers, alphaMultiplier),
  );
  fill.position.set(shape.x, shape.y, 0.14);
  fill.scale.set(shape.radius, shape.radius, 1);
  fill.rotation.z = shape.rotation;
  group.add(fill);

  const borderGroup = syncShapeOutlineGroup(
    undefined,
    shape,
    behavior,
    {
      disposeObject: () => {},
      getUnitPolygonOutlineGeometry: helpers.getUnitPolygonOutlineGeometry,
      getUnitPolygonClosedLineGeometry:
        helpers.getUnitPolygonClosedLineGeometry,
      setMaterialColor: () => {},
    },
    alphaMultiplier,
    shape.borderColor.a ?? 1,
  );
  group.add(borderGroup);

  return group;
}

export function syncShapeFillMaterial(
  mesh: Mesh,
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  helpers: ShapeFillHelpers & {
    disposeMaterial: (
      material: Material | Material[] | null | undefined,
    ) => void;
    setMaterialColor: (
      material: MeshBasicMaterial,
      color: MilkdropShapeVisual['color'],
      alpha: number,
    ) => void;
  },
  alphaMultiplier: number,
) {
  const texture = helpers.getShapeTexture();
  const wantsShaderFill = shouldUseShapeShaderFill(shape, behavior, texture);
  const existingMaterial = mesh.material;

  if (wantsShaderFill) {
    if (
      !isShapeFillShaderMaterialForBackend(existingMaterial, helpers.backend)
    ) {
      helpers.disposeMaterial(existingMaterial);
      mesh.material =
        helpers.backend === 'webgpu'
          ? createShapeFillNodeMaterial(shape, texture, alphaMultiplier)
          : createShapeFillShaderMaterial(shape, texture, alphaMultiplier);
    }

    const material = mesh.material as ShaderMaterial;
    syncShapeShaderUniforms(material, shape, texture, alphaMultiplier);
    material.blending = shape.additive ? AdditiveBlending : NormalBlending;
    return;
  }

  if (!(existingMaterial instanceof MeshBasicMaterial)) {
    helpers.disposeMaterial(existingMaterial);
    const fillColor = helpers.getShapeFillFallbackColor(shape);
    mesh.material = new MeshBasicMaterial({
      color: new Color(fillColor.r, fillColor.g, fillColor.b),
      opacity: (fillColor.a ?? 0.4) * alphaMultiplier,
      transparent: true,
      side: DoubleSide,
      // Flat z-layered 2D geometry: skip three.js's transparent+DoubleSide
      // two-pass render (it bumps material.needsUpdate twice per object per
      // frame, forcing getParameters/getProgram churn on every material).
      forceSinglePass: true,
      ...(shape.additive ? { blending: AdditiveBlending } : {}),
    });
  }

  const material = mesh.material as MeshBasicMaterial;
  material.blending = shape.additive ? AdditiveBlending : NormalBlending;
  const fillColor = helpers.getShapeFillFallbackColor(shape);
  helpers.setMaterialColor(
    material,
    fillColor,
    (fillColor.a ?? 0.4) * alphaMultiplier,
  );
}

export function syncShapeOutline(
  object: Group | undefined,
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  helpers: {
    disposeObject?: (object: { children?: unknown[] }) => void;
    getUnitPolygonOutlineGeometry: (sides: number) => ThreeLine['geometry'];
    getUnitPolygonClosedLineGeometry: (sides: number) => ThreeLine['geometry'];
    setMaterialColor: (
      material: LineBasicMaterial,
      color: MilkdropShapeVisual['color'],
      alpha: number,
    ) => void;
  },
  alphaMultiplier: number,
  opacity: number,
) {
  return syncShapeOutlineGroup(
    object,
    shape,
    behavior,
    helpers,
    alphaMultiplier,
    opacity,
  );
}

export function syncShapeObject(
  existing: Group | undefined,
  shape: MilkdropShapeVisual,
  _behavior: MilkdropBackendBehavior,
  helpers: {
    disposeObject: (object: { children?: unknown[] }) => void;
    createShapeObject: (
      shape: MilkdropShapeVisual,
      alphaMultiplier: number,
    ) => Group;
    syncShapeFillMaterial: (
      mesh: Mesh,
      shape: MilkdropShapeVisual,
      alphaMultiplier: number,
    ) => void;
    syncShapeOutline: (
      object: Group | undefined,
      shape: MilkdropShapeVisual,
      alphaMultiplier: number,
      opacity: number,
    ) => Group;
    getUnitPolygonFillGeometry: (sides: number) => ThreeMesh['geometry'];
  },
  alphaMultiplier: number,
) {
  const fillZ = 0.14;
  const borderZ = 0.16;

  if (!(existing instanceof ThreeGroup)) {
    if (existing) {
      helpers.disposeObject(existing);
    }
    return helpers.createShapeObject(shape, alphaMultiplier);
  }

  const fill = existing.children[0];
  const border = existing.children[1];
  const hasSupportedBorder =
    border instanceof ThreeGroup &&
    (border.children[0] instanceof ThreeLineLoop ||
      border.children[0] instanceof ThreeLine);

  if (!(fill instanceof ThreeMesh) || !hasSupportedBorder) {
    helpers.disposeObject(existing);
    return helpers.createShapeObject(shape, alphaMultiplier);
  }

  if (fill.geometry !== helpers.getUnitPolygonFillGeometry(shape.sides)) {
    fill.geometry = helpers.getUnitPolygonFillGeometry(shape.sides);
  }
  fill.position.set(shape.x, shape.y, fillZ);
  fill.scale.set(shape.radius, shape.radius, 1);
  fill.rotation.z = shape.rotation;
  helpers.syncShapeFillMaterial(fill, shape, alphaMultiplier);

  const outlineGroup = helpers.syncShapeOutline(
    border as Group,
    shape,
    alphaMultiplier,
    shape.borderColor.a ?? 1,
  );
  if (outlineGroup !== border) {
    existing.remove(border);
    existing.add(outlineGroup);
  }
  outlineGroup.position.z = borderZ;

  return existing;
}

export function renderShapeGroup({
  target,
  group,
  shapes,
  alphaMultiplier = 1,
  batcher,
  clearGroup,
  trimGroupChildren,
  syncShapeObject,
}: {
  target: 'shapes' | 'blend-shapes';
  group: Group;
  shapes: MilkdropShapeVisual[];
  alphaMultiplier?: number;
  batcher: MilkdropRendererBatcher | null;
  clearGroup: (group: Group) => void;
  trimGroupChildren: (group: Group, keepCount: number) => void;
  syncShapeObject: (
    existing: Group | undefined,
    shape: MilkdropShapeVisual,
    alphaMultiplier: number,
  ) => Group;
}) {
  if (batcher?.renderShapeGroup?.(target, group, shapes, alphaMultiplier)) {
    clearGroup(group);
    return;
  }
  for (let index = 0; index < shapes.length; index += 1) {
    const shape = shapes[index];
    if (!shape) {
      continue;
    }
    const existing = group.children[index] as Group | undefined;
    const synced = syncShapeObject(existing, shape, alphaMultiplier);
    if (!existing) {
      group.add(synced);
    } else if (synced !== existing) {
      group.remove(existing);
      group.add(synced);
    }
  }
  trimGroupChildren(group, shapes.length);
}
