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

function shouldUseShapeShaderFill(
  shape: MilkdropShapeVisual,
  behavior: MilkdropBackendBehavior,
  texture: Texture | null,
) {
  return (
    (Boolean(shape.secondaryColor) && behavior.supportsShapeGradient) ||
    (shape.textured && texture !== null)
  );
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
          vec2 sampleUv =
            rotate2d(vLocal, textureAngle) * (0.5 * max(textureZoom, 0.0001)) +
            0.5;
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

  if (shape.thickOutline) {
    const accentBorder = new (
      behavior.useLineLoopPrimitives ? ThreeLineLoop : ThreeLine
    )(
      behavior.useLineLoopPrimitives
        ? helpers.getUnitPolygonOutlineGeometry(shape.sides)
        : helpers.getUnitPolygonClosedLineGeometry(shape.sides),
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

  const border = new (
    behavior.useLineLoopPrimitives ? ThreeLineLoop : ThreeLine
  )(
    behavior.useLineLoopPrimitives
      ? helpers.getUnitPolygonOutlineGeometry(shape.sides)
      : helpers.getUnitPolygonClosedLineGeometry(shape.sides),
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
  object: Line | LineLoop,
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
) {
  const nextGeometry = behavior.useLineLoopPrimitives
    ? helpers.getUnitPolygonOutlineGeometry(shape.sides)
    : helpers.getUnitPolygonClosedLineGeometry(shape.sides);
  if (object.geometry !== nextGeometry) {
    object.geometry = nextGeometry;
  }
  object.position.set(shape.x, shape.y, 0.16);
  object.scale.set(shape.radius, shape.radius, 1);
  object.rotation.z = shape.rotation;
  const material = object.material as LineBasicMaterial;
  material.blending = shape.additive ? AdditiveBlending : NormalBlending;
  helpers.setMaterialColor(
    material,
    shape.borderColor,
    opacity * alphaMultiplier,
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
      object: Line | LineLoop,
      shape: MilkdropShapeVisual,
      alphaMultiplier: number,
      opacity: number,
    ) => void;
    getUnitPolygonFillGeometry: (sides: number) => ThreeMesh['geometry'];
  },
  alphaMultiplier: number,
) {
  const wantsAccent = shape.thickOutline;
  const fillZ = 0.14;
  const accentZ = 0.15;
  const borderZ = 0.16;

  if (!(existing instanceof ThreeGroup)) {
    if (existing) {
      helpers.disposeObject(existing);
    }
    return helpers.createShapeObject(shape, alphaMultiplier);
  }

  const fill = existing.children[0];
  const hadAccent = existing.children.length >= 3;
  const accent = hadAccent ? existing.children[1] : undefined;
  const border = existing.children[hadAccent ? 2 : 1];
  const expectsLoop = behavior.useLineLoopPrimitives;
  const hasSupportedBorder = expectsLoop
    ? border instanceof ThreeLineLoop
    : border instanceof ThreeLine;
  const hasSupportedAccent = expectsLoop
    ? accent instanceof ThreeLineLoop
    : accent instanceof ThreeLine;

  if (
    !(fill instanceof ThreeMesh) ||
    !hasSupportedBorder ||
    (wantsAccent && !hasSupportedAccent)
  ) {
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

  if (
    wantsAccent &&
    (accent instanceof ThreeLineLoop || accent instanceof ThreeLine)
  ) {
    helpers.syncShapeOutline(
      accent,
      shape,
      alphaMultiplier,
      Math.max(0.2, (shape.borderColor.a ?? 1) * 0.45),
    );
    accent.scale.set(shape.radius * 1.045, shape.radius * 1.045, 1);
    accent.position.z = accentZ;
  }

  helpers.syncShapeOutline(
    border as Line | LineLoop,
    shape,
    alphaMultiplier,
    shape.borderColor.a ?? 1,
  );
  border.position.z = borderZ;

  if (!wantsAccent && accent) {
    helpers.disposeObject(accent as { children?: unknown[] });
    existing.remove(accent);
  } else if (
    wantsAccent &&
    !(accent instanceof ThreeLineLoop) &&
    !(accent instanceof ThreeLine)
  ) {
    const nextAccent = new (
      behavior.useLineLoopPrimitives ? ThreeLineLoop : ThreeLine
    )(
      (border as Line | LineLoop).geometry,
      new LineBasicMaterial({
        transparent: true,
      }),
    );
    existing.add(nextAccent);
    helpers.syncShapeOutline(
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
