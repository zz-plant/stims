// biome-ignore-all lint/suspicious/noExplicitAny: TSL node graphs are not fully typed under the repo's current moduleResolution.
import {
  AdditiveBlending,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  Line,
  LinearFilter,
  NormalBlending,
  RedFormat,
  Sphere,
  Vector3,
} from 'three';
// @ts-expect-error - 'three/tsl' requires moduleResolution: "bundler" or "nodenext", but project uses "node".
import { NodeMaterial, TSL } from 'three/webgpu';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createMilkdropWebGPUFeedbackManager } from './feedback-manager-webgpu.ts';
import type { MilkdropRendererAdapterConfig } from './renderer-adapter.ts';
import {
  createMilkdropRendererAdapterCore,
  WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
} from './renderer-adapter.ts';
import type {
  MilkdropProceduralAudioSource,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralWaveVisual,
  MilkdropRuntimeSignals,
} from './types';

const {
  Fn,
  attribute,
  clamp,
  cos,
  float,
  floor,
  fract,
  max,
  mix,
  select,
  sin,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} = TSL;

const PROCEDURAL_WAVE_BOUNDS_RADIUS = Math.SQRT2 * 2.2;
const PI = Math.PI;

type WebGPUProceduralAudioPayload = {
  textureData: Float32Array;
  texture: DataTexture;
};

type ProceduralLineWithAudio = Line & {
  userData: Line['userData'] & {
    milkdropProceduralAudio?: WebGPUProceduralAudioPayload;
  };
};

type ProceduralWaveUniformBag = {
  audioTexture: any;
  sampleCount: any;
  mode: any;
  centerX: any;
  centerY: any;
  scale: any;
  mystery: any;
  signalTime: any;
  beatPulse: any;
  trebleAtt: any;
  deltaMs: any;
  tint: any;
  alpha: any;
};

type ProceduralCustomWaveUniformBag = {
  audioTexture: any;
  sampleCount: any;
  sampleSource: any;
  centerX: any;
  centerY: any;
  scaling: any;
  mystery: any;
  signalTime: any;
  beatPulse: any;
  deltaMs: any;
  spectrum: any;
  tint: any;
  alpha: any;
};

type ProceduralWaveNodeMaterial = NodeMaterial & {
  uniforms: ProceduralWaveUniformBag;
};

type ProceduralCustomWaveNodeMaterial = NodeMaterial & {
  uniforms: ProceduralCustomWaveUniformBag;
};

function createProceduralWaveObjectGeometry(sampleCount: number) {
  const safeCount = Math.max(2, Math.round(sampleCount));
  const positions = new Array(safeCount * 3).fill(0);
  const sampleT = Array.from(
    { length: safeCount },
    (_, index) => index / Math.max(1, safeCount - 1),
  );
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('sampleT', new Float32BufferAttribute(sampleT, 1));
  geometry.boundingSphere = new Sphere(
    new Vector3(0, 0, 0),
    PROCEDURAL_WAVE_BOUNDS_RADIUS,
  );
  return geometry;
}

function resampleAudioValue(
  signals: MilkdropRuntimeSignals,
  sampleT: number,
  _sampleSource: MilkdropProceduralAudioSource,
) {
  const frequencyData = signals.frequencyData;
  if (frequencyData.length === 0) {
    return 0;
  }
  const sampleIndex = Math.min(
    frequencyData.length - 1,
    Math.max(0, Math.round(sampleT * Math.max(0, frequencyData.length - 1))),
  );
  return (frequencyData[sampleIndex] ?? 0) / 255;
}

function createAudioTexture(width: number) {
  const textureData = new Float32Array(Math.max(2, width) * 2);
  const audioTexture = new DataTexture(
    textureData,
    Math.max(2, width),
    2,
    RedFormat,
    FloatType,
  );
  audioTexture.wrapS = ClampToEdgeWrapping;
  audioTexture.wrapT = ClampToEdgeWrapping;
  audioTexture.minFilter = LinearFilter;
  audioTexture.magFilter = LinearFilter;
  audioTexture.generateMipmaps = false;
  audioTexture.needsUpdate = true;
  return {
    textureData,
    texture: audioTexture,
  } satisfies WebGPUProceduralAudioPayload;
}

function ensureAudioPayload(
  object: ProceduralLineWithAudio,
  sampleCount: number,
) {
  const safeCount = Math.max(2, Math.round(sampleCount));
  const existing = object.userData.milkdropProceduralAudio;
  if (existing && existing.texture.image.width === safeCount) {
    return existing;
  }
  existing?.texture.dispose();
  const next = createAudioTexture(safeCount);
  object.userData.milkdropProceduralAudio = next;
  return next;
}

function updateAudioPayload(
  payload: WebGPUProceduralAudioPayload,
  signals: MilkdropRuntimeSignals,
  sampleCount: number,
  sampleSource: MilkdropProceduralAudioSource,
) {
  const safeCount = Math.max(2, Math.round(sampleCount));
  payload.textureData.copyWithin(safeCount, 0, safeCount);
  for (let index = 0; index < safeCount; index += 1) {
    const sampleT = index / Math.max(1, safeCount - 1);
    payload.textureData[index] = resampleAudioValue(
      signals,
      sampleT,
      sampleSource,
    );
  }
  payload.texture.needsUpdate = true;
}

function createWavePointNode(uniforms: ProceduralWaveUniformBag) {
  const sampleTNode = attribute('sampleT', 'float');
  const currentRowUv = vec2(sampleTNode, 0.25);
  const previousRowUv = vec2(sampleTNode, 0.75);
  const currentRaw = texture(uniforms.audioTexture, currentRowUv).r;
  const previousRaw = texture(uniforms.audioTexture, previousRowUv).r;
  const historyBlend = clamp(
    float(0.26)
      .add(uniforms.beatPulse.mul(0.48))
      .add(uniforms.deltaMs.div(120)),
    0.24,
    0.92,
  );
  const sampleValue = mix(previousRaw, currentRaw, historyBlend);
  const velocity = sampleValue.sub(previousRaw);
  const centeredSample = sampleValue.sub(0.5);
  const mysteryPhase = uniforms.mystery.mul(PI);
  const sampleIndex = sampleTNode.mul(
    max(uniforms.sampleCount.sub(1), float(1)),
  );

  return Fn(() => {
    const basePoint = vec2(
      sampleTNode.mul(2.2).sub(1.1),
      uniforms.centerY.add(
        sin(
          sampleTNode
            .mul(PI * 2)
            .add(uniforms.signalTime.mul(uniforms.mystery.add(0.55))),
        )
          .mul(uniforms.trebleAtt.mul(0.08).add(0.06))
          .add(centeredSample.mul(uniforms.scale).mul(1.7))
          .add(velocity.mul(0.12)),
      ),
    );

    const mode1Angle = sampleTNode
      .mul(PI * 2)
      .add(uniforms.signalTime.mul(0.32))
      .add(centeredSample.mul(0.8))
      .add(velocity.mul(2.5));
    const mode1Radius = float(0.22)
      .add(sampleValue.mul(uniforms.scale))
      .add(uniforms.beatPulse.mul(0.08))
      .add(sin(sampleTNode.mul(PI * 4).add(uniforms.signalTime)).mul(0.015));
    const mode1Point = vec2(
      uniforms.centerX.add(cos(mode1Angle).mul(mode1Radius)),
      uniforms.centerY.add(sin(mode1Angle).mul(mode1Radius)),
    );

    const mode2Angle = sampleTNode
      .mul(PI * 5)
      .add(uniforms.signalTime.mul(uniforms.mystery.mul(0.2).add(0.4)))
      .add(centeredSample.mul(0.65));
    const mode2Radius = float(0.08)
      .add(sampleTNode.mul(0.6))
      .add(sampleValue.mul(uniforms.scale).mul(0.6))
      .add(velocity.mul(0.12));
    const mode2Point = vec2(
      uniforms.centerX.add(cos(mode2Angle).mul(mode2Radius)),
      uniforms.centerY.add(sin(mode2Angle).mul(mode2Radius)),
    );

    const mode3Angle = sampleTNode
      .mul(PI * 2)
      .add(uniforms.signalTime.mul(0.22));
    const mode3Spoke = float(0.2)
      .add(sampleValue.mul(uniforms.scale).mul(1.05))
      .add(sin(sampleTNode.mul(PI * 12).add(mysteryPhase)).mul(0.05))
      .add(velocity.mul(0.09));
    const mode3Pinch = cos(sampleTNode.mul(PI * 6).add(uniforms.signalTime))
      .mul(0.2)
      .add(0.55);
    const mode3Point = vec2(
      uniforms.centerX.add(cos(mode3Angle).mul(mode3Spoke)),
      uniforms.centerY.add(sin(mode3Angle).mul(mode3Spoke).mul(mode3Pinch)),
    );

    const mode4Point = vec2(
      uniforms.centerX
        .add(sampleValue.sub(0.5).mul(uniforms.scale).mul(1.85))
        .add(
          sin(sampleTNode.mul(PI * 10).add(uniforms.signalTime.mul(0.5))).mul(
            0.04,
          ),
        ),
      sampleTNode.mul(-2.16).add(1.08).add(velocity.mul(0.22)),
    );

    const mode5Angle = sampleTNode
      .mul(PI * 2)
      .add(uniforms.signalTime.mul(0.18));
    const mode5Point = vec2(
      uniforms.centerX
        .add(
          sin(mode5Angle.mul(uniforms.mystery.mul(0.6).add(2))).mul(
            sampleValue.mul(uniforms.scale).mul(0.75).add(0.26),
          ),
        )
        .add(cos(mode5Angle.mul(4).add(mysteryPhase)).mul(0.04))
        .add(velocity.mul(0.16)),
      uniforms.centerY.add(
        sin(mode5Angle.mul(uniforms.mystery.mul(0.5).add(3)).add(PI / 2)).mul(
          sampleValue.mul(uniforms.scale).add(0.18),
        ),
      ),
    );

    const mode6Band = sampleValue.sub(0.5).mul(uniforms.scale).mul(1.4);
    const mode6Point = vec2(
      sampleTNode.mul(2.1).sub(1.05),
      uniforms.centerY
        .add(
          select(
            fract(sampleIndex.mul(0.5)).lessThan(0.25),
            mode6Band,
            mode6Band.negate(),
          ),
        )
        .add(
          sin(sampleTNode.mul(PI * 8).add(uniforms.signalTime.mul(0.55))).mul(
            0.03,
          ),
        )
        .add(velocity.mul(0.18)),
    );

    const mode7Angle = sampleTNode
      .mul(PI * 2)
      .add(uniforms.signalTime.mul(uniforms.mystery.mul(0.1).add(0.24)));
    const mode7Petals = floor(
      clamp(uniforms.mystery.mul(3), 0, 3).add(0.5),
    ).add(3);
    const mode7Radius = float(0.12)
      .add(
        sampleValue
          .mul(uniforms.scale)
          .mul(0.9)
          .add(0.2)
          .mul(cos(mode7Petals.mul(mode7Angle).add(mysteryPhase))),
      )
      .add(velocity.mul(0.14));
    const mode7Point = vec2(
      uniforms.centerX.add(cos(mode7Angle).mul(mode7Radius)),
      uniforms.centerY.add(sin(mode7Angle).mul(mode7Radius)),
    );

    return select(
      uniforms.mode.lessThan(0.5),
      basePoint,
      select(
        uniforms.mode.lessThan(1.5),
        mode1Point,
        select(
          uniforms.mode.lessThan(2.5),
          mode2Point,
          select(
            uniforms.mode.lessThan(3.5),
            mode3Point,
            select(
              uniforms.mode.lessThan(4.5),
              mode4Point,
              select(
                uniforms.mode.lessThan(5.5),
                mode5Point,
                select(uniforms.mode.lessThan(6.5), mode6Point, mode7Point),
              ),
            ),
          ),
        ),
      ),
    );
  })();
}

function createProceduralWaveMaterial() {
  const uniforms = {
    audioTexture: uniform(createAudioTexture(2).texture),
    sampleCount: uniform(2),
    mode: uniform(0),
    centerX: uniform(0),
    centerY: uniform(0),
    scale: uniform(0.34),
    mystery: uniform(0),
    signalTime: uniform(0),
    beatPulse: uniform(0),
    trebleAtt: uniform(0),
    deltaMs: uniform(16.67),
    tint: uniform(new Vector3(1, 1, 1)),
    alpha: uniform(1),
  } satisfies ProceduralWaveUniformBag;

  const material = new NodeMaterial() as ProceduralWaveNodeMaterial;
  material.uniforms = uniforms;
  material.transparent = true;
  material.lights = false;
  material.fog = false;
  material.positionNode = vec3(createWavePointNode(uniforms), 0.24);
  material.colorNode = uniforms.tint;
  material.opacityNode = uniforms.alpha;
  return material;
}

function createProceduralCustomWaveMaterial() {
  const sampleTNode = attribute('sampleT', 'float');
  const uniforms = {
    audioTexture: uniform(createAudioTexture(2).texture),
    sampleCount: uniform(2),
    sampleSource: uniform(0),
    centerX: uniform(0),
    centerY: uniform(0),
    scaling: uniform(1),
    mystery: uniform(0),
    signalTime: uniform(0),
    beatPulse: uniform(0),
    deltaMs: uniform(16.67),
    spectrum: uniform(0),
    tint: uniform(new Vector3(1, 1, 1)),
    alpha: uniform(1),
  } satisfies ProceduralCustomWaveUniformBag;

  const currentRaw = texture(uniforms.audioTexture, vec2(sampleTNode, 0.25)).r;
  const previousRaw = texture(uniforms.audioTexture, vec2(sampleTNode, 0.75)).r;
  const selectedCurrent = mix(
    currentRaw,
    currentRaw,
    step(0.5, uniforms.sampleSource),
  );
  const selectedPrevious = mix(
    previousRaw,
    previousRaw,
    step(0.5, uniforms.sampleSource),
  );
  const historyBlend = clamp(
    float(0.26)
      .add(uniforms.beatPulse.mul(0.48))
      .add(uniforms.deltaMs.div(120)),
    0.24,
    0.92,
  );
  const sampleValue = mix(selectedPrevious, selectedCurrent, historyBlend);
  const baseY = uniforms.centerY.add(
    sampleValue
      .sub(0.5)
      .mul(0.55)
      .mul(uniforms.scaling)
      .mul(uniforms.mystery.mul(0.25).add(1)),
  );
  const orbitalY = uniforms.centerY.add(
    sin(
      sampleTNode
        .mul(PI * 2)
        .mul(uniforms.mystery.add(1))
        .add(uniforms.signalTime),
    )
      .mul(0.18)
      .mul(uniforms.scaling),
  );

  const material = new NodeMaterial() as ProceduralCustomWaveNodeMaterial;
  material.uniforms = uniforms;
  material.transparent = true;
  material.lights = false;
  material.fog = false;
  material.positionNode = vec3(
    uniforms.centerX.add(sampleTNode.mul(2).sub(1).mul(0.85)),
    mix(orbitalY, baseY, uniforms.spectrum),
    0.28,
  );
  material.colorNode = uniforms.tint;
  material.opacityNode = uniforms.alpha;
  return material;
}

function ensureWaveGeometry(object: Line, sampleCount: number) {
  const sampleTAttribute = object.geometry.getAttribute('sampleT');
  if (
    sampleTAttribute instanceof Float32BufferAttribute &&
    sampleTAttribute.array.length === sampleCount
  ) {
    return;
  }
  disposeGeometry(object.geometry);
  object.geometry = createProceduralWaveObjectGeometry(sampleCount);
}

export function syncWebGPUProceduralWaveObject(
  object: Line | undefined,
  wave: MilkdropProceduralWaveVisual,
  signals: MilkdropRuntimeSignals,
) {
  const next =
    (object as ProceduralLineWithAudio | undefined) ??
    new Line(
      createProceduralWaveObjectGeometry(wave.sampleCount),
      createProceduralWaveMaterial(),
    );

  if (
    !(next.material instanceof NodeMaterial) ||
    !('uniforms' in next.material)
  ) {
    disposeMaterial(next.material);
    next.material = createProceduralWaveMaterial();
  }

  ensureWaveGeometry(next, wave.sampleCount);
  const payload = ensureAudioPayload(next, wave.sampleCount);
  updateAudioPayload(payload, signals, wave.sampleCount, wave.sampleSource);

  const material = next.material as ProceduralWaveNodeMaterial;
  material.uniforms.audioTexture.value = payload.texture;
  material.uniforms.sampleCount.value = wave.sampleCount;
  material.uniforms.mode.value = wave.mode;
  material.uniforms.centerX.value = wave.centerX;
  material.uniforms.centerY.value = wave.centerY;
  material.uniforms.scale.value = wave.scale;
  material.uniforms.mystery.value = wave.mystery;
  material.uniforms.signalTime.value = wave.time;
  material.uniforms.beatPulse.value = wave.beatPulse;
  material.uniforms.trebleAtt.value = wave.trebleAtt;
  material.uniforms.deltaMs.value = signals.deltaMs;
  material.uniforms.tint.value.set(wave.color.r, wave.color.g, wave.color.b);
  material.uniforms.alpha.value = wave.alpha;
  material.blending = wave.additive ? AdditiveBlending : NormalBlending;
  return next;
}

export function syncWebGPUProceduralCustomWaveObject(
  object: Line | undefined,
  wave: MilkdropProceduralCustomWaveVisual,
  signals: MilkdropRuntimeSignals,
) {
  const next =
    (object as ProceduralLineWithAudio | undefined) ??
    new Line(
      createProceduralWaveObjectGeometry(wave.sampleCount),
      createProceduralCustomWaveMaterial(),
    );

  if (
    !(next.material instanceof NodeMaterial) ||
    !('uniforms' in next.material)
  ) {
    disposeMaterial(next.material);
    next.material = createProceduralCustomWaveMaterial();
  }

  ensureWaveGeometry(next, wave.sampleCount);
  const payload = ensureAudioPayload(next, wave.sampleCount);
  updateAudioPayload(payload, signals, wave.sampleCount, wave.sampleSource);

  const material = next.material as ProceduralCustomWaveNodeMaterial;
  material.uniforms.audioTexture.value = payload.texture;
  material.uniforms.sampleCount.value = wave.sampleCount;
  material.uniforms.sampleSource.value =
    wave.sampleSource === 'spectrum' ? 1 : 0;
  material.uniforms.centerX.value = wave.centerX;
  material.uniforms.centerY.value = wave.centerY;
  material.uniforms.scaling.value = wave.scaling;
  material.uniforms.mystery.value = wave.mystery;
  material.uniforms.signalTime.value = wave.time;
  material.uniforms.beatPulse.value = signals.beatPulse;
  material.uniforms.deltaMs.value = signals.deltaMs;
  material.uniforms.spectrum.value = wave.spectrum ? 1 : 0;
  material.uniforms.tint.value.set(wave.color.r, wave.color.g, wave.color.b);
  material.uniforms.alpha.value = wave.alpha;
  material.blending = wave.additive ? AdditiveBlending : NormalBlending;
  return next;
}

export type MilkdropWebGPURendererAdapterConfig = Omit<
  MilkdropRendererAdapterConfig,
  'backend'
>;

export function createMilkdropWebGPURendererAdapter(
  config: MilkdropWebGPURendererAdapterConfig,
) {
  return createMilkdropRendererAdapterCore({
    ...config,
    backend: 'webgpu',
    behavior: WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
    createFeedbackManager: createMilkdropWebGPUFeedbackManager,
    syncWebGPUProceduralWaveObject,
    syncWebGPUProceduralCustomWaveObject,
  });
}
