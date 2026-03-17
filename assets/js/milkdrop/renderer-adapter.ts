import type { Camera, Scene } from 'three';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  Scene as ThreeScene,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import type {
  MilkdropBorderVisual,
  MilkdropCompiledPreset,
  MilkdropPolyline,
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
  material.color = new Color(value.r, value.g, value.b);
  material.opacity = opacity;
  material.transparent = opacity < 1;
}

function ensureGeometryPositions(
  geometry: BufferGeometry,
  positions: number[],
) {
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.computeBoundingSphere();
}

function closePolylinePositions(polyline: MilkdropPolyline) {
  if (!polyline.closed || polyline.positions.length < 3) {
    return polyline.positions;
  }
  return [
    ...polyline.positions,
    polyline.positions[0] as number,
    polyline.positions[1] as number,
    polyline.positions[2] as number,
  ];
}

function clearGroup(group: Group) {
  group.children.slice().forEach((child) => {
    group.remove(child);
    if ('geometry' in child) {
      disposeGeometry((child as Line | Mesh | Points).geometry);
    }
    if ('material' in child) {
      disposeMaterial((child as Line | Mesh | Points).material);
    }
  });
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

  const object = new Line(
    new BufferGeometry(),
    new LineBasicMaterial({
      transparent: true,
      opacity: wave.alpha * alphaMultiplier,
      ...(wave.additive ? { blending: AdditiveBlending } : {}),
    }),
  );
  ensureGeometryPositions(object.geometry, closePolylinePositions(wave));
  setMaterialColor(object.material, wave.color, wave.alpha * alphaMultiplier);
  object.position.z = 0.24;
  return object;
}

function createShapeObject(shape: MilkdropShapeVisual, alphaMultiplier = 1) {
  const group = new Group();
  const vertices: Vector2[] = [];
  for (let index = 0; index < shape.sides; index += 1) {
    const theta =
      (index / shape.sides) * Math.PI * 2 +
      shape.rotation +
      Math.PI / Math.max(3, shape.sides);
    vertices.push(new Vector2(Math.cos(theta), Math.sin(theta)));
  }
  const positions = vertices.flatMap((vertex) => [vertex.x, vertex.y, 0]);
  const firstVertex = vertices[0] ?? new Vector2(1, 0);
  positions.push(firstVertex.x, firstVertex.y, 0);

  const fillShape = new Shape();
  fillShape.moveTo(firstVertex.x, firstVertex.y);
  vertices.slice(1).forEach((vertex) => fillShape.lineTo(vertex.x, vertex.y));
  fillShape.lineTo(firstVertex.x, firstVertex.y);

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

  const fill = new Mesh(new ShapeGeometry(fillShape), fillMaterial);
  fill.position.set(shape.x, shape.y, 0.14);
  fill.scale.set(shape.radius, shape.radius, 1);
  fill.rotation.z = shape.rotation;
  group.add(fill);

  if (shape.thickOutline) {
    const accentBorder = new Line(
      new BufferGeometry(),
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
    ensureGeometryPositions(accentBorder.geometry, positions);
    accentBorder.position.set(shape.x, shape.y, 0.15);
    accentBorder.scale.set(shape.radius * 1.045, shape.radius * 1.045, 1);
    group.add(accentBorder);
  }

  const border = new Line(
    new BufferGeometry(),
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
  ensureGeometryPositions(border.geometry, positions);
  border.position.set(shape.x, shape.y, 0.16);
  border.scale.set(shape.radius, shape.radius, 1);
  group.add(border);

  return group;
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
  const object = new Line(
    new BufferGeometry(),
    new LineBasicMaterial({
      transparent: true,
      opacity: border.alpha * alphaMultiplier,
    }),
  );
  ensureGeometryPositions(object.geometry, positions);
  setMaterialColor(
    object.material,
    border.color,
    border.alpha * alphaMultiplier,
  );
  if (!border.styled) {
    return object;
  }

  const group = new Group();
  group.add(object);
  const accent = new Line(
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

class FeedbackManager {
  readonly compositeScene = new ThreeScene();
  readonly presentScene = new ThreeScene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
  readonly compositeMaterial: ShaderMaterial;
  readonly presentMaterial: MeshBasicMaterial;
  readonly sceneTarget: WebGLRenderTarget;
  readonly targets: [WebGLRenderTarget, WebGLRenderTarget];
  private index = 0;

  constructor(width: number, height: number) {
    this.camera.position.z = 1;
    this.sceneTarget = new WebGLRenderTarget(width, height);
    this.targets = [
      new WebGLRenderTarget(width, height),
      new WebGLRenderTarget(width, height),
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

        void main() {
          vec2 centeredUv = vUv - 0.5;
          float rotSin = sin(rotation);
          float rotCos = cos(rotation);
          vec2 rotatedUv = vec2(
            centeredUv.x * rotCos - centeredUv.y * rotSin,
            centeredUv.x * rotSin + centeredUv.y * rotCos
          );
          vec2 transformedUv = rotatedUv / max(zoomMul, 0.0001) + vec2(offsetX, offsetY);
          vec2 warpUv = transformedUv + 0.5 + vec2(
            sin((vUv.y - 0.5) * 6.2831) * warpScale * 0.04,
            cos((vUv.x - 0.5) * 6.2831) * warpScale * 0.04
          );
          vec2 prevUv = (warpUv - 0.5) / max(zoom, 0.0001) + 0.5;
          if (textureWrap > 0.5) {
            prevUv = fract(prevUv);
          }
          vec4 current = texture2D(currentTex, vUv);
          vec4 previous = texture2D(previousTex, clamp(prevUv, 0.0, 1.0));
          vec3 color = mix(
            current.rgb,
            previous.rgb,
            clamp(mixAlpha + feedbackTexture * 0.2, 0.0, 1.0)
          );
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
    const quad = new Mesh(new PlaneGeometry(2, 2), this.compositeMaterial);
    const presentQuad = new Mesh(new PlaneGeometry(2, 2), this.presentMaterial);
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
    this.sceneTarget.setSize(width, height);
    this.targets.forEach((target) => target.setSize(width, height));
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
    new PlaneGeometry(6.4, 6.4),
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
    clearGroup(group);
    waves.forEach((wave) => {
      const object = createWaveObject(wave, alphaMultiplier);
      if (object) {
        group.add(object);
      }
    });
  }

  private renderShapeGroup(
    group: Group,
    shapes: MilkdropShapeVisual[],
    alphaMultiplier = 1,
  ) {
    clearGroup(group);
    shapes.forEach((shape) => {
      group.add(createShapeObject(shape, alphaMultiplier));
    });
  }

  private renderBorderGroup(
    group: Group,
    borders: MilkdropBorderVisual[],
    alphaMultiplier = 1,
  ) {
    clearGroup(group);
    borders.forEach((border) => {
      group.add(createBorderObject(border, alphaMultiplier));
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
    this.feedback.compositeMaterial.uniforms.colorScale.value = new Color(
      payload.frameState.post.shaderControls.colorScale.r,
      payload.frameState.post.shaderControls.colorScale.g,
      payload.frameState.post.shaderControls.colorScale.b,
    );
    this.feedback.compositeMaterial.uniforms.hueShift.value =
      payload.frameState.post.shaderControls.hueShift;
    this.feedback.compositeMaterial.uniforms.brightenBoost.value =
      payload.frameState.post.shaderControls.brightenBoost;
    this.feedback.compositeMaterial.uniforms.invertBoost.value =
      payload.frameState.post.shaderControls.invertBoost;
    this.feedback.compositeMaterial.uniforms.solarizeBoost.value =
      payload.frameState.post.shaderControls.solarizeBoost;
    this.feedback.compositeMaterial.uniforms.tint.value = new Color(
      payload.frameState.post.shaderControls.tint.r,
      payload.frameState.post.shaderControls.tint.g,
      payload.frameState.post.shaderControls.tint.b,
    );

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
    disposeGeometry(this.background.geometry);
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
