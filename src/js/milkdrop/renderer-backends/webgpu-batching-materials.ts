import type { Material, Texture } from 'three';
import { DataTexture, DoubleSide } from 'three';
// @ts-expect-error - 'three/webgpu' is available at runtime but not under the repo's current moduleResolution.
import { NodeMaterial, TSL } from 'three/webgpu';
import type {
  ShapeBatchMaterialFactory,
  ShapeFillBatchMaterial,
} from '../renderer-adapter-webgpu-batching';

// NodeMaterial/TSL twins of the GLSL ShaderMaterials in
// renderer-adapter-webgpu-batching.ts, for the native WebGPU renderer (which
// cannot compile GLSL — see the compatibility note at the top of
// webgpu-procedural-materials.ts). The instanced-attribute layouts, z values,
// and per-fragment math must stay in lockstep with the GLSL sources; the
// batch classes upload identical buffers to both.
const {
  attribute,
  cameraProjectionMatrix,
  clamp,
  cos,
  float,
  fract,
  length,
  max,
  mix,
  modelViewMatrix,
  positionGeometry,
  sin,
  step,
  texture,
  uniform,
  vec2,
  vec4,
} = TSL;

// WebGPU requires every declared sampler binding to have a real texture, so
// untextured fills sample this 1x1 white texture (the instanceFillControl.y
// flag zeroes its contribution — same as the GLSL path, which only flips
// that flag when a texture exists).
let fallbackShapeTexture: DataTexture | null = null;

function getFallbackShapeTexture(): DataTexture {
  if (!fallbackShapeTexture) {
    fallbackShapeTexture = new DataTexture(
      new Uint8Array([255, 255, 255, 255]),
      1,
      1,
    );
    fallbackShapeTexture.needsUpdate = true;
  }
  return fallbackShapeTexture;
}

function applyFlatBatchMaterialFlags(material: Material) {
  material.transparent = true;
  material.depthWrite = false;
  material.side = DoubleSide;
  // Flat z-layered 2D geometry: skip three.js's transparent+DoubleSide
  // two-pass render (it bumps material.needsUpdate twice per object per
  // frame, forcing per-frame pipeline churn on every material) — same
  // rationale as the GLSL batching materials (commit 1a533a1d).
  material.forceSinglePass = true;
  // The GLSL ShaderMaterials bypass tone mapping/output color transforms
  // entirely; keep the NodeMaterial output equally raw so batched shapes
  // match the unbatched native path.
  material.toneMapped = false;
}

function rotate2d(
  value: { x: TslNode; y: TslNode },
  cosR: TslNode,
  sinR: TslNode,
) {
  return vec2(
    value.x.mul(cosR).sub(value.y.mul(sinR)),
    value.x.mul(sinR).add(value.y.mul(cosR)),
  );
}

type TslNode = {
  x: TslNode;
  y: TslNode;
  z: TslNode;
  w: TslNode;
  rgb: TslNode;
  a: TslNode;
  value: unknown;
  mul: (other: unknown) => TslNode;
  add: (other: unknown) => TslNode;
  sub: (other: unknown) => TslNode;
  div: (other: unknown) => TslNode;
  sample: (uv: unknown) => TslNode;
  [key: string]: unknown;
};

function createTslShapeFillMaterial(): ShapeFillBatchMaterial {
  const shapeTextureNode = texture(getFallbackShapeTexture()) as TslNode;
  const textureAspectY = uniform(1) as TslNode;

  const transform = attribute('instanceTransform', 'vec4') as TslNode;
  const primary = attribute('instancePrimaryColorAlpha', 'vec4') as TslNode;
  const secondary = attribute('instanceSecondaryColorAlpha', 'vec4') as TslNode;
  const fillControl = attribute('instanceFillControl', 'vec4') as TslNode;

  const local = positionGeometry.xy as TslNode;
  const cosR = cos(transform.w) as TslNode;
  const sinR = sin(transform.w) as TslNode;
  const rotated = rotate2d(
    { x: local.x.mul(transform.z), y: local.y.mul(transform.z) },
    cosR,
    sinR,
  ) as TslNode;

  const material = new NodeMaterial();
  applyFlatBatchMaterialFlags(material);
  material.vertexNode = cameraProjectionMatrix
    .mul(modelViewMatrix)
    .mul(vec4(rotated.add(transform.xy), 0.14, 1.0));

  const gradientBlend = clamp(length(local), 0.0, 1.0).mul(fillControl.x);
  const baseColor = mix(primary, secondary, gradientBlend) as TslNode;
  const texCos = cos(fillControl.w) as TslNode;
  const texSin = sin(fillControl.w) as TslNode;
  const texRotated = rotate2d({ x: local.x, y: local.y }, texCos, texSin);
  const zoom = max(fillControl.z, 0.0001) as TslNode;
  const sampleUv = vec2(
    float(0.5).add(texRotated.x.mul(0.5).mul(textureAspectY).div(zoom)),
    float(0.5).add(texRotated.y.mul(0.5).div(zoom)),
  );
  const sampled = shapeTextureNode.sample(fract(sampleUv)) as TslNode;
  const texturedColor = vec4(
    sampled.rgb.mul(baseColor.rgb),
    baseColor.a.mul(sampled.a),
  );
  material.colorNode = mix(baseColor, texturedColor, step(0.5, fillControl.y));

  return Object.assign(material as Material, {
    batchUniforms: {
      shapeTexture: {
        get value(): Texture | null {
          const current = shapeTextureNode.value as Texture;
          return current === fallbackShapeTexture ? null : current;
        },
        set value(next: Texture | null) {
          shapeTextureNode.value = next ?? getFallbackShapeTexture();
        },
      },
      textureAspectY: textureAspectY as unknown as { value: number },
    },
  }) as ShapeFillBatchMaterial;
}

function createTslShapeRingMaterial(layerZ: number): Material {
  const unitCorner = attribute('unitCorner', 'vec2') as TslNode;
  const innerWeight = attribute('innerWeight', 'float') as TslNode;
  const transform = attribute('instanceTransform', 'vec4') as TslNode;
  const colorAlpha = attribute('instanceColorAlpha', 'vec4') as TslNode;
  const scales = attribute('instanceScales', 'vec2') as TslNode;

  const localScale = mix(scales.x, scales.y, innerWeight).mul(
    transform.z,
  ) as TslNode;
  const cosR = cos(transform.w) as TslNode;
  const sinR = sin(transform.w) as TslNode;
  const rotated = rotate2d(
    { x: unitCorner.x.mul(localScale), y: unitCorner.y.mul(localScale) },
    cosR,
    sinR,
  ) as TslNode;

  const material = new NodeMaterial();
  applyFlatBatchMaterialFlags(material);
  material.vertexNode = cameraProjectionMatrix
    .mul(modelViewMatrix)
    .mul(vec4(rotated.add(transform.xy), layerZ, 1.0));
  material.colorNode = colorAlpha;
  return material as Material;
}

function createTslBorderMaterial(): Material {
  const unitCorner = attribute('unitCorner', 'vec2') as TslNode;
  const innerWeight = attribute('innerWeight', 'float') as TslNode;
  const insets = attribute('instanceInsets', 'vec4') as TslNode;
  const colorAlpha = attribute('instanceColorAlpha', 'vec4') as TslNode;

  const outerScale = float(1.0).sub(insets.y) as TslNode;
  const innerScale = float(1.0).sub(insets.z) as TslNode;
  const scale = mix(outerScale, innerScale, innerWeight).mul(
    insets.w,
  ) as TslNode;

  const material = new NodeMaterial();
  applyFlatBatchMaterialFlags(material);
  material.vertexNode = cameraProjectionMatrix
    .mul(modelViewMatrix)
    .mul(vec4(unitCorner.mul(scale), insets.x, 1.0));
  material.colorNode = colorAlpha;
  return material as Material;
}

export function createNativeWebGpuShapeBatchMaterialFactory(): ShapeBatchMaterialFactory {
  return {
    createShapeFillMaterial: createTslShapeFillMaterial,
    createShapeRingMaterial: createTslShapeRingMaterial,
    createBorderMaterial: createTslBorderMaterial,
  };
}
