// biome-ignore-all lint/suspicious/noExplicitAny: TSL node graphs are not fully typed under the repo's current moduleResolution.
import type { Camera, Texture } from 'three';
import {
  Color,
  HalfFloatType,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
} from 'three';
// @ts-expect-error - 'three/tsl' requires moduleResolution: "bundler" or "nodenext", but project uses "node".
import { NodeMaterial, RenderTarget, TSL } from 'three/webgpu';
import { disposeMaterial } from '../utils/three-dispose';
import { WEBGPU_MILKDROP_BACKEND_BEHAVIOR } from './renderer-adapter.ts';
import type {
  MilkdropFeedbackCompositeState,
  MilkdropFeedbackManager,
} from './types';

const {
  abs,
  atan,
  clamp,
  cos,
  dot,
  Fn,
  float,
  floor,
  fract,
  If,
  length,
  mat3,
  max,
  min,
  mix,
  pow,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} = TSL;

const FULLSCREEN_QUAD_GEOMETRY = new PlaneGeometry(2, 2);
const MILKDROP_TEXTURE_FILES = {
  noise: 'seamless_perlin_noise.png',
  simplex: 'simplex_noise_3d.png',
  voronoi: 'voronoi_cellular.png',
  aura: 'colorful_aura_gradient.png',
  caustics: 'water_caustics.png',
  pattern: 'circuit_board_pattern.png',
  fractal: 'crystal_fractal.png',
} as const;

type FeedbackRendererLike = {
  render: (scene: Scene, camera: Camera) => void;
  setRenderTarget: (target: RenderTarget | null) => void;
};

type CompositeUniformBag = Record<string, any>;

function resolveTextureUrl(fileName: string) {
  const baseUrl =
    typeof import.meta.env.BASE_URL === 'string'
      ? import.meta.env.BASE_URL
      : '/';
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}textures/${fileName}`;
}

function configureMilkdropTexture(textureValue: Texture, colorTexture = false) {
  textureValue.wrapS = RepeatWrapping;
  textureValue.wrapT = RepeatWrapping;
  if (colorTexture) {
    textureValue.colorSpace = SRGBColorSpace;
  }
  return textureValue;
}

function loadMilkdropTexture(fileName: string, colorTexture = false) {
  const loaded = new TextureLoader().load(resolveTextureUrl(fileName));
  return configureMilkdropTexture(loaded, colorTexture);
}

function createFeedbackRenderTarget(width: number, height: number) {
  const profile = WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile;
  const resolutionScale = profile.resolutionScale;
  const scaledWidth = Math.max(1, Math.round(width * resolutionScale));
  const scaledHeight = Math.max(1, Math.round(height * resolutionScale));
  const target = new RenderTarget(scaledWidth, scaledHeight, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    type: WEBGPU_MILKDROP_BACKEND_BEHAVIOR.useHalfFloatFeedback
      ? HalfFloatType
      : undefined,
  });
  target.samples = profile.samples;
  return target;
}

function hueRotateNode(colorValue: any, angle: any) {
  return Fn(() => {
    const s = sin(angle);
    const c = cos(angle);
    const rotationMatrix = mat3(
      float(0.213).add(c.mul(0.787)).sub(s.mul(0.213)),
      float(0.715).sub(c.mul(0.715)).sub(s.mul(0.715)),
      float(0.072).sub(c.mul(0.072)).add(s.mul(0.928)),
      float(0.213).sub(c.mul(0.213)).add(s.mul(0.143)),
      float(0.715).add(c.mul(0.285)).add(s.mul(0.14)),
      float(0.072).sub(c.mul(0.072)).sub(s.mul(0.283)),
      float(0.213).sub(c.mul(0.213)).sub(s.mul(0.787)),
      float(0.715).sub(c.mul(0.715)).add(s.mul(0.715)),
      float(0.072).add(c.mul(0.928)).add(s.mul(0.072)),
    );
    return clamp(rotationMatrix.mul(colorValue), vec3(0), vec3(1));
  })();
}

function applySaturationNode(colorValue: any, amount: any) {
  return Fn(() => {
    const luminance = dot(colorValue, vec3(0.299, 0.587, 0.114));
    return mix(vec3(luminance), colorValue, amount);
  })();
}

function applyContrastNode(colorValue: any, amount: any) {
  return clamp(colorValue.sub(0.5).mul(amount).add(0.5), vec3(0), vec3(1));
}

function createSampleUvNode() {
  return Fn(([rawUv, wrapMode]: [any, any]) => {
    const clampedUv = clamp(rawUv, vec2(0), vec2(1));
    const wrappedUv = fract(rawUv);
    return mix(clampedUv, wrappedUv, step(0.5, wrapMode));
  });
}

function createApplyFeedbackWarpNode() {
  return Fn(([sampleUv, amount, rotationAmount]: [any, any, any]) => {
    const centered = sampleUv.sub(0.5);
    const radius = length(centered);
    const angle = atan(centered.y, centered.x);
    const spiral = sin(radius.mul(18).sub(angle.mul(4)))
      .mul(amount)
      .mul(0.08);
    const warpedAngle = angle.add(spiral).add(rotationAmount.mul(0.22));
    const warpedRadius = radius.mul(
      float(1).add(
        cos(warpedAngle.mul(3).add(radius.mul(10)))
          .mul(amount)
          .mul(0.05),
      ),
    );
    return vec2(cos(warpedAngle), sin(warpedAngle)).mul(warpedRadius).add(0.5);
  });
}

function createSampleAuxTextureNode(
  _uniforms: CompositeUniformBag,
  noiseTexNode: ReturnType<typeof texture>,
  simplexTexNode: ReturnType<typeof texture>,
  voronoiTexNode: ReturnType<typeof texture>,
  auraTexNode: ReturnType<typeof texture>,
  causticsTexNode: ReturnType<typeof texture>,
  patternTexNode: ReturnType<typeof texture>,
  fractalTexNode: ReturnType<typeof texture>,
) {
  const sampleAuxTexture2DNode = Fn(([source, sampleUv]: [any, any]) => {
    const wrappedUv = fract(sampleUv);
    const flat = vec4(0.5, 0.5, 0.5, 1);
    return select(
      source.lessThan(0.5),
      flat,
      select(
        source.lessThan(1.5),
        noiseTexNode.sample(wrappedUv),
        select(
          source.lessThan(2.5),
          simplexTexNode.sample(wrappedUv),
          select(
            source.lessThan(3.5),
            voronoiTexNode.sample(wrappedUv),
            select(
              source.lessThan(4.5),
              auraTexNode.sample(wrappedUv),
              select(
                source.lessThan(5.5),
                causticsTexNode.sample(wrappedUv),
                select(
                  source.lessThan(6.5),
                  patternTexNode.sample(wrappedUv),
                  fractalTexNode.sample(wrappedUv),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  });

  const volumeSliceOffsetNode = Fn(
    ([source, zValue, phase]: [any, any, any]) => {
      const wrappedZ = fract(zValue);
      const seedUv = fract(
        vec2(
          wrappedZ.mul(0.137).add(source.mul(0.071)).add(phase.mul(0.19)),
          wrappedZ.mul(0.293).add(source.mul(0.113)).sub(phase.mul(0.17)),
        ),
      );
      const noiseWarp = simplexTexNode.sample(seedUv).rg.sub(0.5);
      const angle = wrappedZ
        .mul(6.28318530718)
        .add(phase)
        .add(source.mul(0.43));
      const radius = float(0.035).add(wrappedZ.mul(0.045));
      return vec2(cos(angle), sin(angle)).mul(radius).add(noiseWarp.mul(0.08));
    },
  );

  return Fn(([source, sampleUv, sampleIs3D, zValue]: [any, any, any, any]) => {
    const slicePosition = fract(zValue).mul(16);
    const sliceA = floor(slicePosition).div(16);
    const sliceB = fract(sliceA.add(1 / 16));
    const sliceMix = fract(slicePosition);
    const sampleA = sampleAuxTexture2DNode(
      source,
      sampleUv.add(volumeSliceOffsetNode(source, sliceA, 0)),
    );
    const sampleB = sampleAuxTexture2DNode(
      source,
      sampleUv.add(volumeSliceOffsetNode(source, sliceB, 1.57079632679)),
    );
    const volumeSample = mix(sampleA, sampleB, sliceMix);
    return select(
      sampleIs3D.lessThan(0.5),
      sampleAuxTexture2DNode(source, sampleUv),
      volumeSample,
    );
  });
}

function createCompositeUniforms(
  sceneTexture: Texture,
  previousTexture: Texture,
  auxTextures: Record<string, Texture>,
) {
  return {
    currentTex: texture(sceneTexture),
    previousTex: texture(previousTexture),
    noiseTex: texture(auxTextures.noise),
    simplexTex: texture(auxTextures.simplex),
    voronoiTex: texture(auxTextures.voronoi),
    auraTex: texture(auxTextures.aura),
    causticsTex: texture(auxTextures.caustics),
    patternTex: texture(auxTextures.pattern),
    fractalTex: texture(auxTextures.fractal),
    mixAlpha: uniform(0.18),
    zoom: uniform(1.02),
    brighten: uniform(0),
    darken: uniform(0),
    solarize: uniform(0),
    invert: uniform(0),
    gammaAdj: uniform(1),
    textureWrap: uniform(0),
    feedbackTexture: uniform(0),
    warpScale: uniform(0),
    offsetX: uniform(0),
    offsetY: uniform(0),
    rotation: uniform(0),
    zoomMul: uniform(1),
    saturation: uniform(1),
    contrast: uniform(1),
    colorScale: uniform(new Color(1, 1, 1)),
    hueShift: uniform(0),
    brightenBoost: uniform(0),
    invertBoost: uniform(0),
    solarizeBoost: uniform(0),
    tint: uniform(new Color(1, 1, 1)),
    feedbackSoftness: uniform(
      WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile.feedbackSoftness,
    ),
    currentFrameBoost: uniform(
      WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile.currentFrameBoost,
    ),
    overlayTextureSource: uniform(0),
    overlayTextureIs3D: uniform(0),
    overlayTextureZ: uniform(0),
    overlayTextureMode: uniform(0),
    overlayTextureAmount: uniform(0),
    overlayTextureScale: uniform(new Vector2(1, 1)),
    overlayTextureOffset: uniform(new Vector2(0, 0)),
    warpTextureSource: uniform(0),
    warpTextureIs3D: uniform(0),
    warpTextureZ: uniform(0),
    warpTextureAmount: uniform(0),
    warpTextureScale: uniform(new Vector2(1, 1)),
    warpTextureOffset: uniform(new Vector2(0, 0)),
    signalBass: uniform(0),
    signalMid: uniform(0),
    signalTreb: uniform(0),
    signalBeat: uniform(0),
    signalEnergy: uniform(0),
    signalTime: uniform(0),
    texelSize: uniform(new Vector2(1, 1)),
  } satisfies CompositeUniformBag;
}

function createCompositeOutputNode(uniforms: CompositeUniformBag) {
  const sampleUvNode = createSampleUvNode();
  const applyFeedbackWarpNode = createApplyFeedbackWarpNode();
  const sampleAuxTextureNode = createSampleAuxTextureNode(
    uniforms,
    uniforms.noiseTex,
    uniforms.simplexTex,
    uniforms.voronoiTex,
    uniforms.auraTex,
    uniforms.causticsTex,
    uniforms.patternTex,
    uniforms.fractalTex,
  );

  return Fn(() => {
    const baseUv = uv();
    const centeredUv = baseUv.sub(0.5);
    const rotationSin = sin(uniforms.rotation);
    const rotationCos = cos(uniforms.rotation);
    const rotatedUv = vec2(
      centeredUv.x.mul(rotationCos).sub(centeredUv.y.mul(rotationSin)),
      centeredUv.x.mul(rotationSin).add(centeredUv.y.mul(rotationCos)),
    );
    const transformedUv = rotatedUv
      .div(max(uniforms.zoomMul, 0.0001))
      .add(vec2(uniforms.offsetX, uniforms.offsetY));

    const currentUv = applyFeedbackWarpNode(
      transformedUv.add(0.5),
      uniforms.warpScale,
      uniforms.rotation,
    ).toVar();
    const previousUv = applyFeedbackWarpNode(
      currentUv.sub(0.5).div(max(uniforms.zoom, 0.0001)).add(0.5),
      uniforms.warpScale.mul(0.8),
      uniforms.rotation.mul(0.6),
    ).toVar();

    const warpTextureMask = step(0.5, uniforms.warpTextureSource).mul(
      step(0.0001, uniforms.warpTextureAmount),
    );
    const warpUv = baseUv
      .mul(uniforms.warpTextureScale)
      .add(uniforms.warpTextureOffset);
    const warpVector = sampleAuxTextureNode(
      uniforms.warpTextureSource,
      warpUv,
      uniforms.warpTextureIs3D,
      uniforms.warpTextureZ.add(uniforms.signalTime.mul(0.1)),
    )
      .rg.sub(0.5)
      .toVar();
    currentUv.addAssign(
      warpVector.mul(uniforms.warpTextureAmount).mul(0.12).mul(warpTextureMask),
    );
    previousUv.addAssign(
      warpVector.mul(uniforms.warpTextureAmount).mul(0.08).mul(warpTextureMask),
    );

    const current = uniforms.currentTex.sample(
      sampleUvNode(currentUv, uniforms.textureWrap),
    );
    const previous = uniforms.previousTex.sample(
      sampleUvNode(previousUv, uniforms.textureWrap),
    );
    const previousColor = previous.rgb.toVar();

    If(uniforms.feedbackSoftness.greaterThan(0.01), () => {
      const sampleOffset = uniforms.texelSize.mul(
        float(0.65).add(uniforms.feedbackSoftness.mul(0.6)),
      );
      const softened = previous.rgb
        .add(
          uniforms.previousTex.sample(
            sampleUvNode(
              previousUv.add(vec2(sampleOffset.x, 0)),
              uniforms.textureWrap,
            ),
          ).rgb,
        )
        .add(
          uniforms.previousTex.sample(
            sampleUvNode(
              previousUv.sub(vec2(sampleOffset.x, 0)),
              uniforms.textureWrap,
            ),
          ).rgb,
        )
        .add(
          uniforms.previousTex.sample(
            sampleUvNode(
              previousUv.add(vec2(0, sampleOffset.y)),
              uniforms.textureWrap,
            ),
          ).rgb,
        )
        .add(
          uniforms.previousTex.sample(
            sampleUvNode(
              previousUv.sub(vec2(0, sampleOffset.y)),
              uniforms.textureWrap,
            ),
          ).rgb,
        )
        .add(
          uniforms.previousTex.sample(
            sampleUvNode(previousUv.add(sampleOffset), uniforms.textureWrap),
          ).rgb,
        )
        .add(
          uniforms.previousTex.sample(
            sampleUvNode(previousUv.sub(sampleOffset), uniforms.textureWrap),
          ).rgb,
        )
        .add(
          uniforms.previousTex.sample(
            sampleUvNode(
              previousUv.add(vec2(sampleOffset.x, sampleOffset.y.mul(-1))),
              uniforms.textureWrap,
            ),
          ).rgb,
        )
        .add(
          uniforms.previousTex.sample(
            sampleUvNode(
              previousUv.add(vec2(sampleOffset.x.mul(-1), sampleOffset.y)),
              uniforms.textureWrap,
            ),
          ).rgb,
        )
        .div(9);
      previousColor.assign(
        mix(
          previousColor,
          softened,
          clamp(uniforms.feedbackSoftness.mul(0.6), 0, 0.65),
        ),
      );
    });

    const color = mix(
      current.rgb,
      previousColor,
      clamp(uniforms.mixAlpha.add(uniforms.feedbackTexture.mul(0.2)), 0, 1),
    ).toVar();
    color.assign(
      mix(color, current.rgb, clamp(uniforms.currentFrameBoost, 0, 0.4)),
    );

    const brightenMask = max(
      step(0.01, uniforms.brighten),
      step(0.01, uniforms.brightenBoost),
    );
    const brightened = min(
      vec3(1),
      color.mul(float(1.18).add(uniforms.brightenBoost.mul(0.35))),
    );
    color.assign(mix(color, brightened, brightenMask));
    color.assign(mix(color, color.mul(0.82), step(0.5, uniforms.darken)));
    color.assign(
      mix(
        color,
        abs(color.sub(0.5)).mul(1.5),
        clamp(max(uniforms.solarize, uniforms.solarizeBoost), 0, 1),
      ),
    );
    color.assign(
      mix(
        color,
        vec3(1).sub(color),
        clamp(max(uniforms.invert, uniforms.invertBoost), 0, 1),
      ),
    );
    color.assign(hueRotateNode(color, uniforms.hueShift));
    color.assign(applySaturationNode(color, uniforms.saturation));
    color.assign(applyContrastNode(color, uniforms.contrast));
    color.assign(color.mul(uniforms.colorScale));
    color.assign(color.mul(uniforms.tint));

    const overlayMask = step(0.5, uniforms.overlayTextureSource)
      .mul(step(0.5, uniforms.overlayTextureMode))
      .mul(step(0.0001, uniforms.overlayTextureAmount));
    const overlayUv = baseUv
      .mul(uniforms.overlayTextureScale)
      .add(uniforms.overlayTextureOffset);
    const overlayColor = sampleAuxTextureNode(
      uniforms.overlayTextureSource,
      overlayUv,
      uniforms.overlayTextureIs3D,
      uniforms.overlayTextureZ.add(uniforms.signalTime.mul(0.1)),
    ).rgb;
    const overlayAmount = clamp(uniforms.overlayTextureAmount, 0, 1.5);
    const overlayMixAmount = clamp(overlayAmount, 0, 1);
    const overlayMix = mix(color, overlayColor, overlayMixAmount);
    const overlayAdd = min(vec3(1), color.add(overlayColor.mul(overlayAmount)));
    const overlayMultiply = color.mul(
      mix(vec3(1), overlayColor, overlayMixAmount),
    );
    const overlayResult = select(
      uniforms.overlayTextureMode.lessThan(2.5),
      overlayMix,
      select(
        uniforms.overlayTextureMode.lessThan(3.5),
        overlayAdd,
        overlayMultiply,
      ),
    );
    color.assign(mix(color, overlayResult, overlayMask));

    const spectralUvA = baseUv
      .mul(
        vec2(
          float(1.4).add(uniforms.signalBass.mul(0.8)),
          float(1.1).add(uniforms.signalMid.mul(0.6)),
        ),
      )
      .add(
        vec2(uniforms.signalTime.mul(0.035), uniforms.signalTime.mul(-0.02)),
      );
    const spectralUvB = baseUv
      .mul(
        vec2(
          float(2).add(uniforms.signalTreb.mul(0.9)),
          float(1.7).add(uniforms.signalBass.mul(0.5)),
        ),
      )
      .sub(
        vec2(uniforms.signalTime.mul(0.018), uniforms.signalTime.mul(-0.026)),
      );
    const spectralA = sampleAuxTextureNode(
      float(2),
      spectralUvA,
      float(0),
      0,
    ).rgb;
    const spectralB = sampleAuxTextureNode(
      float(5),
      spectralUvB,
      float(0),
      0,
    ).rgb;
    const spectralPulse = sin(
      baseUv.x
        .add(baseUv.y)
        .mul(18)
        .add(uniforms.signalTime.mul(2.4))
        .add(uniforms.signalBeat.mul(Math.PI)),
    ).mul(0.15);
    const spectralField = smoothstep(
      0.38,
      0.92,
      dot(mix(spectralA, spectralB, 0.5), vec3(0.3333333)).add(spectralPulse),
    );
    const spectralTint = vec3(
      float(0.35).add(uniforms.signalBass.mul(0.9)),
      float(0.25).add(uniforms.signalMid.mul(0.8)),
      float(0.45).add(uniforms.signalTreb.mul(1.1)),
    );
    color.addAssign(
      spectralTint
        .mul(spectralField)
        .mul(
          float(0.06)
            .add(uniforms.signalEnergy.mul(0.18))
            .add(uniforms.signalBeat.mul(0.08)),
        ),
    );

    const gammaAdjusted = pow(
      max(color, vec3(0)),
      vec3(float(1).div(max(uniforms.gammaAdj, 0.0001))),
    );
    return vec4(gammaAdjusted, 1);
  })();
}

class WebGPUMilkdropFeedbackManager {
  readonly compositeScene = new Scene();
  readonly presentScene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 10);
  readonly compositeMaterial: NodeMaterial & { uniforms: CompositeUniformBag };
  readonly presentMaterial: MeshBasicMaterial;
  readonly sceneTarget: RenderTarget;
  readonly targets: [RenderTarget, RenderTarget];
  readonly resolutionScale =
    WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile.resolutionScale;
  readonly profile = WEBGPU_MILKDROP_BACKEND_BEHAVIOR.feedbackProfile;
  readonly auxTextures: Record<string, Texture>;
  private index = 0;

  constructor(width: number, height: number) {
    this.camera.position.z = 1;
    this.auxTextures = {
      noise: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.noise),
      simplex: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.simplex),
      voronoi: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.voronoi),
      aura: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.aura, true),
      caustics: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.caustics),
      pattern: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.pattern),
      fractal: loadMilkdropTexture(MILKDROP_TEXTURE_FILES.fractal),
    };
    this.sceneTarget = createFeedbackRenderTarget(width, height);
    this.targets = [
      createFeedbackRenderTarget(width, height),
      createFeedbackRenderTarget(width, height),
    ];

    const uniforms = createCompositeUniforms(
      this.sceneTarget.texture,
      this.targets[0].texture,
      this.auxTextures,
    );
    uniforms.texelSize.value.set(
      1 / Math.max(1, this.sceneTarget.width),
      1 / Math.max(1, this.sceneTarget.height),
    );

    const compositeMaterial = new NodeMaterial();
    compositeMaterial.outputNode = createCompositeOutputNode(uniforms);
    compositeMaterial.needsUpdate = true;
    this.compositeMaterial = Object.assign(compositeMaterial, {
      uniforms,
    });

    this.presentMaterial = new MeshBasicMaterial({
      map: this.targets[0].texture,
    });

    const compositeQuad = new Mesh(
      FULLSCREEN_QUAD_GEOMETRY,
      this.compositeMaterial,
    );
    const presentQuad = new Mesh(
      FULLSCREEN_QUAD_GEOMETRY,
      this.presentMaterial,
    );
    this.compositeScene.add(compositeQuad);
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

  applyCompositeState(state: MilkdropFeedbackCompositeState) {
    this.compositeMaterial.uniforms.mixAlpha.value = state.mixAlpha;
    this.compositeMaterial.uniforms.zoom.value = state.zoom;
    this.compositeMaterial.uniforms.brighten.value = state.brighten;
    this.compositeMaterial.uniforms.darken.value = state.darken;
    this.compositeMaterial.uniforms.solarize.value = state.solarize;
    this.compositeMaterial.uniforms.invert.value = state.invert;
    this.compositeMaterial.uniforms.gammaAdj.value = state.gammaAdj;
    this.compositeMaterial.uniforms.textureWrap.value = state.textureWrap;
    this.compositeMaterial.uniforms.feedbackTexture.value =
      state.feedbackTexture;
    this.compositeMaterial.uniforms.warpScale.value = state.warpScale;
    this.compositeMaterial.uniforms.offsetX.value = state.offsetX;
    this.compositeMaterial.uniforms.offsetY.value = state.offsetY;
    this.compositeMaterial.uniforms.rotation.value = state.rotation;
    this.compositeMaterial.uniforms.zoomMul.value = state.zoomMul;
    this.compositeMaterial.uniforms.saturation.value = state.saturation;
    this.compositeMaterial.uniforms.contrast.value = state.contrast;
    this.compositeMaterial.uniforms.colorScale.value.setRGB(
      state.colorScale.r,
      state.colorScale.g,
      state.colorScale.b,
    );
    this.compositeMaterial.uniforms.hueShift.value = state.hueShift;
    this.compositeMaterial.uniforms.brightenBoost.value = state.brightenBoost;
    this.compositeMaterial.uniforms.invertBoost.value = state.invertBoost;
    this.compositeMaterial.uniforms.solarizeBoost.value = state.solarizeBoost;
    this.compositeMaterial.uniforms.tint.value.setRGB(
      state.tint.r,
      state.tint.g,
      state.tint.b,
    );
    this.compositeMaterial.uniforms.overlayTextureSource.value =
      state.overlayTextureSource;
    this.compositeMaterial.uniforms.overlayTextureIs3D.value =
      state.overlayTextureIs3D;
    this.compositeMaterial.uniforms.overlayTextureZ.value =
      state.overlayTextureZ;
    this.compositeMaterial.uniforms.overlayTextureMode.value =
      state.overlayTextureMode;
    this.compositeMaterial.uniforms.overlayTextureAmount.value =
      state.overlayTextureAmount;
    this.compositeMaterial.uniforms.overlayTextureScale.value.set(
      state.overlayTextureScale.x,
      state.overlayTextureScale.y,
    );
    this.compositeMaterial.uniforms.overlayTextureOffset.value.set(
      state.overlayTextureOffset.x,
      state.overlayTextureOffset.y,
    );
    this.compositeMaterial.uniforms.warpTextureSource.value =
      state.warpTextureSource;
    this.compositeMaterial.uniforms.warpTextureIs3D.value =
      state.warpTextureIs3D;
    this.compositeMaterial.uniforms.warpTextureZ.value = state.warpTextureZ;
    this.compositeMaterial.uniforms.warpTextureAmount.value =
      state.warpTextureAmount;
    this.compositeMaterial.uniforms.warpTextureScale.value.set(
      state.warpTextureScale.x,
      state.warpTextureScale.y,
    );
    this.compositeMaterial.uniforms.warpTextureOffset.value.set(
      state.warpTextureOffset.x,
      state.warpTextureOffset.y,
    );
    this.compositeMaterial.uniforms.signalBass.value = state.signalBass;
    this.compositeMaterial.uniforms.signalMid.value = state.signalMid;
    this.compositeMaterial.uniforms.signalTreb.value = state.signalTreb;
    this.compositeMaterial.uniforms.signalBeat.value = state.signalBeat;
    this.compositeMaterial.uniforms.signalEnergy.value = state.signalEnergy;
    this.compositeMaterial.uniforms.signalTime.value = state.signalTime;
  }

  render(renderer: FeedbackRendererLike, scene: Scene, camera: Camera) {
    this.compositeMaterial.uniforms.currentTex.value = this.sceneTarget.texture;
    this.compositeMaterial.uniforms.previousTex.value = this.readTarget.texture;

    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(this.writeTarget);
    renderer.render(this.compositeScene, this.camera);
    this.swap();
    renderer.setRenderTarget(null);
    renderer.render(this.presentScene, this.camera);
    return true;
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
    Object.values(this.auxTextures).forEach((textureValue) => {
      textureValue.dispose();
    });
    disposeMaterial(this.compositeMaterial);
    disposeMaterial(this.presentMaterial);
    this.compositeScene.clear();
    this.presentScene.clear();
  }
}

export function createMilkdropWebGPUFeedbackManager(
  width: number,
  height: number,
) {
  return new WebGPUMilkdropFeedbackManager(
    width,
    height,
  ) as MilkdropFeedbackManager;
}
