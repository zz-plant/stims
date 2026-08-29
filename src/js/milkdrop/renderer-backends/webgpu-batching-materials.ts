import type { Material, Texture } from 'three';
import { DataTexture, DoubleSide } from 'three';
import { NodeMaterial, TSL } from 'three/webgpu';
import type {
  ShapeBatchMaterialFactory,
  ShapeFillBatchMaterial,
} from '../renderer-adapter-webgpu-batching';
import {
  type TslNode,
  typedAttribute,
} from '../renderer-helpers/tsl-node-types.ts';

// NodeMaterial/TSL twins of the GLSL ShaderMaterials in
// renderer-adapter-webgpu-batching.ts, for the native WebGPU renderer (which
// cannot compile GLSL — see the compatibility note at the top of
// webgpu-procedural-materials.ts). The instanced-attribute layouts, z values,
// and per-fragment math must stay in lockstep with the GLSL sources; the
// batch classes upload identical buffers to both.
const {
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
  value: { x: TslNode<'float'>; y: TslNode<'float'> },
  cosR: TslNode<'float'>,
  sinR: TslNode<'float'>,
) {
  return vec2(
    value.x.mul(cosR).sub(value.y.mul(sinR)),
    value.x.mul(sinR).add(value.y.mul(cosR)),
  );
}

function createTslShapeFillMaterial(): ShapeFillBatchMaterial {
  const shapeTextureNode = texture(getFallbackShapeTexture());
  const textureAspectY = uniform(1);

  const transform = typedAttribute('instanceTransform', 'vec4');
  const primary = typedAttribute('instancePrimaryColorAlpha', 'vec4');
  const secondary = typedAttribute('instanceSecondaryColorAlpha', 'vec4');
  const fillControl = typedAttribute('instanceFillControl', 'vec4');

  const local = positionGeometry.xy;
  const cosR = cos(transform.w);
  const sinR = sin(transform.w);
  const rotated = rotate2d(
    { x: local.x.mul(transform.z), y: local.y.mul(transform.z) },
    cosR,
    sinR,
  );

  const material = new NodeMaterial();
  applyFlatBatchMaterialFlags(material);
  material.vertexNode = cameraProjectionMatrix
    .mul(modelViewMatrix)
    .mul(vec4(rotated.add(transform.xy), 0.14, 1.0));

  const gradientBlend = clamp(length(local), 0.0, 1.0).mul(fillControl.x);
  const baseColor = mix(primary, secondary, gradientBlend);
  const texCos = cos(fillControl.w);
  const texSin = sin(fillControl.w);
  const texRotated = rotate2d({ x: local.x, y: local.y }, texCos, texSin);
  const zoom = max(fillControl.z, 0.0001);
  const sampleUv = vec2(
    float(0.5).add(texRotated.x.mul(0.5).mul(textureAspectY).div(zoom)),
    float(0.5).add(texRotated.y.mul(0.5).div(zoom)),
  );
  const sampled = shapeTextureNode.sample(fract(sampleUv));
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
  const unitCorner = typedAttribute('unitCorner', 'vec2');
  const innerWeight = typedAttribute('innerWeight', 'float');
  const transform = typedAttribute('instanceTransform', 'vec4');
  const colorAlpha = typedAttribute('instanceColorAlpha', 'vec4');
  const scales = typedAttribute('instanceScales', 'vec2');

  const localScale = mix(scales.x, scales.y, innerWeight).mul(transform.z);
  const cosR = cos(transform.w);
  const sinR = sin(transform.w);
  const rotated = rotate2d(
    { x: unitCorner.x.mul(localScale), y: unitCorner.y.mul(localScale) },
    cosR,
    sinR,
  );

  const material = new NodeMaterial();
  applyFlatBatchMaterialFlags(material);
  material.vertexNode = cameraProjectionMatrix
    .mul(modelViewMatrix)
    .mul(vec4(rotated.add(transform.xy), layerZ, 1.0));
  material.colorNode = colorAlpha;
  return material as Material;
}

function createTslBorderMaterial(): Material {
  const unitCorner = typedAttribute('unitCorner', 'vec2');
  const innerWeight = typedAttribute('innerWeight', 'float');
  const insets = typedAttribute('instanceInsets', 'vec4');
  const colorAlpha = typedAttribute('instanceColorAlpha', 'vec4');

  const outerScale = float(1.0).sub(insets.y);
  const innerScale = float(1.0).sub(insets.z);
  const scale = mix(outerScale, innerScale, innerWeight).mul(insets.w);

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
