import type { Group, Line, LineLoop, Material, Mesh, Texture } from 'three';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  LineBasicMaterial,
  MeshBasicMaterial,
  NormalBlending,
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

type ShapeFillHelpers = {
  getShapeFillFallbackColor: (
    shape: MilkdropShapeVisual,
  ) => MilkdropShapeVisual['color'];
  getShapeTexture: () => Texture | null;
};

type ShapeOutlineLayerObject = Line | LineLoop;

const THICK_SHAPE_PASS_OFFSET = 1 / 1024;

function shouldUseShapeShaderFill(
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  texture: Texture | null,
) {
  return (
    (behavior.supportsShapeShaderFill &&
      Boolean(shape.secondaryColor) &&
      behavior.supportsShapeGradient) ||
    (behavior.supportsShapeShaderFill && shape.textured && texture !== null)
  );
}

function getTextureAspectY(texture: Texture | null) {
  const image = texture?.image as
    | { width?: number; height?: number }
    | undefined;
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (width > 0 && height > 0) {
    return height / width;
  }
  return 1;
}

function getShapeOutlineOffsets(shape: MilkdropShapeVisual) {
  if (!shape.thickOutline) {
    return [{ x: 0, y: 0 }];
  }

  return [
    { x: 0, y: 0 },
    { x: THICK_SHAPE_PASS_OFFSET, y: 0 },
    { x: THICK_SHAPE_PASS_OFFSET, y: THICK_SHAPE_PASS_OFFSET },
    { x: 0, y: THICK_SHAPE_PASS_OFFSET },
  ];
}

function syncShapeShaderUniforms(
  material: ShaderMaterial,
  shape: MilkdropShapeVisual,
  texture: Texture | null,
  alphaMultiplier: number,
) {
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
  material.uniforms.shapeTexture.value = texture;
  material.uniforms.useGradient.value = shape.secondaryColor ? 1 : 0;
  material.uniforms.textured.value = shape.textured && texture ? 1 : 0;
  material.uniforms.textureZoom.value = Math.max(
    0.0001,
    shape.textureZoom ?? 1,
  );
  material.uniforms.textureAngle.value = shape.textureAngle ?? 0;
  material.uniforms.textureAspectY.value = getTextureAspectY(texture);
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
        value: texture,
      },
      textureAspectY: {
        value: getTextureAspectY(texture),
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
      uniform sampler2D shapeTexture;
      uniform float textureAspectY;
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
          vec2 rotated = rotate2d(vLocal, textureAngle);
          vec2 sampleUv =
            vec2(
              0.5 +
                0.5 * rotated.x * textureAspectY / max(textureZoom, 0.0001),
              1.0 -
                (0.5 - 0.5 * rotated.y / max(textureZoom, 0.0001))
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
    return createShapeFillShaderMaterial(shape, texture, alphaMultiplier);
  }

  const fillColor = helpers.getShapeFillFallbackColor(shape);
  return new MeshBasicMaterial({
    color: new Color(fillColor.r, fillColor.g, fillColor.b),
    opacity: (fillColor.a ?? 0.4) * alphaMultiplier,
    transparent: true,
    side: DoubleSide,
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
    if (!(existingMaterial instanceof ShaderMaterial)) {
      helpers.disposeMaterial(existingMaterial);
      mesh.material = createShapeFillShaderMaterial(
        shape,
        texture,
        alphaMultiplier,
      );
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
  behavior: MilkdropBackendBehavior,
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
