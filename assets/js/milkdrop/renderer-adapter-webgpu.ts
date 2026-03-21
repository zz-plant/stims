// biome-ignore-all lint/suspicious/noExplicitAny: TSL node graphs are not fully typed under the repo's current moduleResolution.
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Line,
  Mesh,
  NormalBlending,
  ShaderMaterial,
} from 'three';
// @ts-expect-error - 'three/webgpu' requires moduleResolution: "bundler" or "nodenext", but project uses "node".
// biome-ignore format: keep this import on one line so the TS suppression applies to the module specifier.
import { LineBasicNodeMaterial, StorageBufferAttribute, TSL } from 'three/webgpu';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import { createMilkdropWebGPUFeedbackManager } from './feedback-manager-webgpu.ts';
import type {
  MilkdropRendererAdapterConfig,
  MilkdropRendererBatcher,
} from './renderer-adapter.ts';
import {
  createMilkdropRendererAdapterCore,
  WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
} from './renderer-adapter.ts';
import type {
  MilkdropBorderVisual,
  MilkdropColor,
  MilkdropGpuInteractionTransform,
  MilkdropProceduralAudioSource,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralWaveVisual,
  MilkdropRuntimeSignals,
  MilkdropShapeVisual,
  MilkdropWaveVisual,
} from './types';

export type MilkdropWebGPURendererAdapterConfig = Omit<
  MilkdropRendererAdapterConfig,
  'backend'
>;

type SegmentInstance = {
  startX: number;
  startY: number;
  startZ: number;
  endX: number;
  endY: number;
  endZ: number;
  color: MilkdropColor;
  alpha: number;
  width: number;
};

type ShapeFillInstance = {
  x: number;
  y: number;
  radius: number;
  rotation: number;
  color: MilkdropColor;
  alpha: number;
};

type ShapeRingInstance = ShapeFillInstance & {
  outerScale: number;
  innerScale: number;
};

type BorderRingInstance = {
  inset: number;
  outerInset: number;
  innerInset: number;
  scale: number;
  z: number;
  color: MilkdropColor;
  alpha: number;
};

const SEGMENT_QUAD_GEOMETRY = createSegmentQuadGeometry();
const BORDER_RING_GEOMETRY = createBorderRingGeometry();
const polygonFillGeometryCache = new Map<number, BufferGeometry>();
const polygonRingGeometryCache = new Map<number, InstancedBufferGeometry>();

const {
  Fn,
  If,
  abs,
  attribute,
  clamp,
  cos,
  float,
  floor,
  int,
  max,
  min,
  mix,
  select,
  sin,
  storage,
  uniform,
  vec2,
  vec3,
  vec4,
  vertexIndex,
} = TSL;

const proceduralWaveGeometryCache = new Map<number, BufferGeometry>();

function sampleProceduralAudioSource(
  signals: MilkdropRuntimeSignals,
  source: MilkdropProceduralAudioSource,
  sampleT: number,
  audioData?: Uint8Array,
) {
  const waveformData = signals.waveformData ?? signals.frequencyData;
  const data =
    audioData ?? (source === 'spectrum' ? signals.frequencyData : waveformData);
  if (data.length === 0) {
    return source === 'spectrum' ? 0 : 0.5;
  }
  const scaledIndex =
    Math.max(0, Math.min(1, sampleT)) * Math.max(0, data.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(data.length - 1, lowerIndex + 1);
  const blend = scaledIndex - lowerIndex;
  const lower = (data[lowerIndex] ?? (source === 'spectrum' ? 0 : 128)) / 255;
  const upper = (data[upperIndex] ?? (source === 'spectrum' ? 0 : 128)) / 255;
  return lower + (upper - lower) * blend;
}

function getProceduralWaveLineGeometry(sampleCount: number) {
  const safeCount = Math.max(2, Math.round(sampleCount));
  const cached = proceduralWaveGeometryCache.get(safeCount);
  if (cached) {
    return cached;
  }
  const positions = new Float32Array(safeCount * 3);
  const sampleT = Array.from(
    { length: safeCount },
    (_, index) => index / Math.max(1, safeCount - 1),
  );
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('sampleT', new Float32BufferAttribute(sampleT, 1));
  proceduralWaveGeometryCache.set(safeCount, geometry);
  return geometry;
}

function createProceduralAudioBuffer(sampleCount: number) {
  return new StorageBufferAttribute(Math.max(2, Math.round(sampleCount)), 2);
}

function updateProceduralAudioBuffer(
  buffer: StorageBufferAttribute,
  sampleCount: number,
  source: MilkdropProceduralAudioSource,
  signals: MilkdropRuntimeSignals,
  audioData?: Uint8Array,
) {
  const safeCount = Math.max(2, Math.round(sampleCount));
  const array = buffer.array as Float32Array;
  for (let index = 0; index < safeCount; index += 1) {
    const offset = index * 2;
    const nextValue = sampleProceduralAudioSource(
      signals,
      source,
      index / Math.max(1, safeCount - 1),
      audioData,
    );
    const previousValue = array[offset] ?? nextValue;
    array[offset] = nextValue;
    array[offset + 1] = previousValue;
  }
  buffer.needsUpdate = true;
}

type ProceduralNodeUniforms = {
  mode?: any;
  centerX: any;
  centerY: any;
  scale: any;
  mystery: any;
  audioIsSpectrum: any;
  colorR: any;
  colorG: any;
  colorB: any;
  alpha: any;
  interactionOffsetX: any;
  interactionOffsetY: any;
  interactionRotation: any;
  interactionScale: any;
  interactionAlpha: any;
};

function applyInteractionNode(point: any, uniforms: ProceduralNodeUniforms) {
  return Fn(() => {
    const scaled = point.mul(uniforms.interactionScale).toVar();
    const cosRot = cos(uniforms.interactionRotation);
    const sinRot = sin(uniforms.interactionRotation);
    return vec2(
      scaled.x
        .mul(cosRot)
        .sub(scaled.y.mul(sinRot))
        .add(uniforms.interactionOffsetX),
      scaled.x
        .mul(sinRot)
        .add(scaled.y.mul(cosRot))
        .add(uniforms.interactionOffsetY),
    );
  })();
}

function createProceduralNodeUniforms(includeMode: boolean) {
  return {
    ...(includeMode ? { mode: uniform(0) } : {}),
    centerX: uniform(0),
    centerY: uniform(0),
    scale: uniform(1),
    mystery: uniform(0),
    audioIsSpectrum: uniform(0),
    colorR: uniform(1),
    colorG: uniform(1),
    colorB: uniform(1),
    alpha: uniform(1),
    interactionOffsetX: uniform(0),
    interactionOffsetY: uniform(0),
    interactionRotation: uniform(0),
    interactionScale: uniform(1),
    interactionAlpha: uniform(1),
  } satisfies ProceduralNodeUniforms;
}

function createProceduralWaveNodeMaterial(audioBuffer: StorageBufferAttribute) {
  const uniforms = createProceduralNodeUniforms(true);
  const sampleNode = storage(
    audioBuffer,
    'vec2',
    audioBuffer.count,
  ).toReadOnly();
  const material = new LineBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  material.positionNode = Fn(() => {
    const mode = uniforms.mode ?? uniform(0);
    const sampleT = attribute('sampleT', 'float').toVar();
    const sampleIndex = int(vertexIndex).toVar();
    const lastIndex = int(audioBuffer.count - 1);
    const previousIndex = max(sampleIndex.sub(int(1)), int(0));
    const nextIndex = min(sampleIndex.add(int(1)), lastIndex);
    const samplePair = sampleNode.element(sampleIndex).toVar();
    const prevPair = sampleNode.element(previousIndex).toVar();
    const nextPair = sampleNode.element(nextIndex).toVar();
    const smoothing = float(0.38).add(uniforms.mystery.mul(0.18)).toVar();
    const sampleValue = mix(samplePair.y, samplePair.x, smoothing).toVar();
    const previousSample = mix(samplePair.y, samplePair.y, smoothing).toVar();
    const previousValue = mix(prevPair.y, prevPair.x, smoothing).toVar();
    const nextValue = mix(nextPair.y, nextPair.x, smoothing).toVar();
    const velocity = sampleValue.sub(previousSample).toVar();
    const slope = nextValue.sub(previousValue).mul(0.5).toVar();
    const momentum = mix(velocity, slope, float(0.55)).toVar();
    const centeredSample = sampleValue.sub(0.5).toVar();
    const mysteryPhase = uniforms.mystery.mul(Math.PI).toVar();
    const angle = sampleT.mul(Math.PI * 2).toVar();
    const x = float(0).toVar();
    const y = float(0).toVar();

    If(mode.lessThan(0.5), () => {
      x.assign(sampleT.mul(2.2).sub(1.1));
      y.assign(
        uniforms.centerY
          .add(
            sin(
              angle.mul(1.0 + uniforms.mystery.mul(2.0)).add(mysteryPhase),
            ).mul(0.06),
          )
          .add(centeredSample.mul(uniforms.scale).mul(1.7))
          .add(momentum.mul(0.12)),
      );
    })
      .ElseIf(mode.lessThan(1.5), () => {
        const circleAngle = angle
          .add(centeredSample.mul(0.8))
          .add(momentum.mul(2.5))
          .toVar();
        const radius = float(0.22)
          .add(sampleValue.mul(uniforms.scale))
          .add(sin(angle.mul(2.0).add(mysteryPhase)).mul(0.02))
          .toVar();
        x.assign(uniforms.centerX.add(cos(circleAngle).mul(radius)));
        y.assign(uniforms.centerY.add(sin(circleAngle).mul(radius)));
      })
      .ElseIf(mode.lessThan(2.5), () => {
        const spiralAngle = angle
          .mul(2.5 + uniforms.mystery.mul(1.5))
          .add(centeredSample.mul(0.65))
          .toVar();
        const radius = float(0.08)
          .add(sampleT.mul(0.6))
          .add(sampleValue.mul(uniforms.scale).mul(0.6))
          .add(momentum.mul(0.12))
          .toVar();
        x.assign(uniforms.centerX.add(cos(spiralAngle).mul(radius)));
        y.assign(uniforms.centerY.add(sin(spiralAngle).mul(radius)));
      })
      .ElseIf(mode.lessThan(3.5), () => {
        const spoke = float(0.2)
          .add(sampleValue.mul(uniforms.scale).mul(1.05))
          .add(sin(angle.mul(6.0).add(mysteryPhase)).mul(0.05))
          .add(momentum.mul(0.09))
          .toVar();
        const pinch = float(0.55)
          .add(cos(angle.mul(3.0).add(mysteryPhase)).mul(0.2))
          .toVar();
        x.assign(uniforms.centerX.add(cos(angle).mul(spoke)));
        y.assign(uniforms.centerY.add(sin(angle).mul(spoke).mul(pinch)));
      })
      .ElseIf(mode.lessThan(4.5), () => {
        x.assign(
          uniforms.centerX
            .add(centeredSample.mul(uniforms.scale).mul(1.85))
            .add(sin(angle.mul(5.0).add(mysteryPhase)).mul(0.04)),
        );
        y.assign(float(1.08).sub(sampleT.mul(2.16)).add(momentum.mul(0.22)));
      })
      .ElseIf(mode.lessThan(5.5), () => {
        const xAmp = float(0.26)
          .add(sampleValue.mul(uniforms.scale).mul(0.75))
          .toVar();
        const yAmp = float(0.18).add(sampleValue.mul(uniforms.scale)).toVar();
        x.assign(
          uniforms.centerX
            .add(sin(angle.mul(2.0 + uniforms.mystery.mul(0.6))).mul(xAmp))
            .add(cos(angle.mul(4.0).add(mysteryPhase)).mul(0.04))
            .add(momentum.mul(0.16)),
        );
        y.assign(
          uniforms.centerY.add(
            sin(
              angle.mul(3.0 + uniforms.mystery.mul(0.5)).add(Math.PI / 2),
            ).mul(yAmp),
          ),
        );
      })
      .ElseIf(mode.lessThan(6.5), () => {
        const band = centeredSample.mul(uniforms.scale).mul(1.4).toVar();
        const direction = select(
          sampleIndex.mod(int(2)).equal(int(0)),
          float(1),
          float(-1),
        );
        x.assign(sampleT.mul(2.1).sub(1.05));
        y.assign(
          uniforms.centerY
            .add(direction.mul(band))
            .add(sin(angle.mul(4.0).add(mysteryPhase)).mul(0.03))
            .add(momentum.mul(0.18)),
        );
      })
      .Else(() => {
        const petalCount = float(3)
          .add(floor(clamp(uniforms.mystery.mul(3.0), 0.0, 3.0).add(0.5)))
          .toVar();
        const radius = float(0.12)
          .add(
            float(0.2)
              .add(sampleValue.mul(uniforms.scale).mul(0.9))
              .mul(cos(petalCount.mul(angle).add(mysteryPhase))),
          )
          .add(momentum.mul(0.14))
          .toVar();
        x.assign(uniforms.centerX.add(cos(angle).mul(radius)));
        y.assign(uniforms.centerY.add(sin(angle).mul(radius)));
      });

    const point = applyInteractionNode(vec2(x, y), uniforms);
    return vec3(point, float(0.24).add(abs(momentum).mul(0.04)));
  })();
  material.colorNode = vec4(
    uniforms.colorR,
    uniforms.colorG,
    uniforms.colorB,
    uniforms.alpha.mul(uniforms.interactionAlpha),
  );
  return { material, uniforms };
}

function createProceduralCustomWaveNodeMaterial(
  audioBuffer: StorageBufferAttribute,
) {
  const uniforms = createProceduralNodeUniforms(false);
  const sampleNode = storage(
    audioBuffer,
    'vec2',
    audioBuffer.count,
  ).toReadOnly();
  const material = new LineBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  material.positionNode = Fn(() => {
    const sampleT = attribute('sampleT', 'float').toVar();
    const sampleIndex = int(vertexIndex).toVar();
    const lastIndex = int(audioBuffer.count - 1);
    const previousIndex = max(sampleIndex.sub(int(1)), int(0));
    const nextIndex = min(sampleIndex.add(int(1)), lastIndex);
    const samplePair = sampleNode.element(sampleIndex).toVar();
    const prevPair = sampleNode.element(previousIndex).toVar();
    const nextPair = sampleNode.element(nextIndex).toVar();
    const smoothing = float(0.42).add(uniforms.mystery.mul(0.16)).toVar();
    const sampleValue = mix(samplePair.y, samplePair.x, smoothing).toVar();
    const previousValue = samplePair.y.toVar();
    const neighborSlope = nextPair.x.sub(prevPair.x).mul(0.5).toVar();
    const velocity = sampleValue.sub(previousValue).toVar();
    const x = uniforms.centerX.add(sampleT.mul(2).sub(1).mul(0.85)).toVar();
    const baseY = uniforms.centerY
      .add(
        sampleValue
          .sub(0.5)
          .mul(0.55)
          .mul(uniforms.scale)
          .mul(float(1).add(uniforms.mystery.mul(0.25))),
      )
      .toVar();
    const orbitalY = uniforms.centerY
      .add(sampleValue.sub(0.5).mul(0.4).mul(uniforms.scale))
      .add(
        sin(
          sampleT
            .mul(Math.PI * 2)
            .mul(float(1).add(uniforms.mystery))
            .add(uniforms.mystery.mul(Math.PI)),
        )
          .mul(0.18)
          .mul(uniforms.scale),
      )
      .add(mix(velocity, neighborSlope, float(0.5)).mul(0.12))
      .toVar();
    const y = mix(orbitalY, baseY, uniforms.audioIsSpectrum).toVar();
    const point = applyInteractionNode(vec2(x, y), uniforms);
    return vec3(point, 0.28);
  })();
  material.colorNode = vec4(
    uniforms.colorR,
    uniforms.colorG,
    uniforms.colorB,
    uniforms.alpha.mul(uniforms.interactionAlpha),
  );
  return { material, uniforms };
}

class ProceduralWaveLineObject {
  readonly line: Line;
  readonly sampleCount: number;
  readonly audioBuffer: StorageBufferAttribute;
  readonly uniforms: ProceduralNodeUniforms;

  constructor(sampleCount: number, custom = false) {
    this.sampleCount = Math.max(2, Math.round(sampleCount));
    this.audioBuffer = createProceduralAudioBuffer(this.sampleCount);
    const built = custom
      ? createProceduralCustomWaveNodeMaterial(this.audioBuffer)
      : createProceduralWaveNodeMaterial(this.audioBuffer);
    this.uniforms = built.uniforms;
    this.line = new Line(
      getProceduralWaveLineGeometry(this.sampleCount).clone(),
      built.material,
    );
    this.line.frustumCulled = false;
  }

  syncCommon(
    wave: MilkdropProceduralWaveVisual | MilkdropProceduralCustomWaveVisual,
    signals: MilkdropRuntimeSignals,
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    updateProceduralAudioBuffer(
      this.audioBuffer,
      wave.sampleCount,
      wave.audioSource,
      signals,
      wave.audioData,
    );
    this.uniforms.centerX.value = wave.centerX;
    this.uniforms.centerY.value = wave.centerY;
    this.uniforms.scale.value = wave.scale;
    this.uniforms.mystery.value = wave.mystery;
    this.uniforms.audioIsSpectrum.value =
      wave.audioSource === 'spectrum' ? 1 : 0;
    this.uniforms.colorR.value = wave.color.r;
    this.uniforms.colorG.value = wave.color.g;
    this.uniforms.colorB.value = wave.color.b;
    this.uniforms.alpha.value = wave.alpha;
    this.uniforms.interactionOffsetX.value = interaction?.offsetX ?? 0;
    this.uniforms.interactionOffsetY.value = interaction?.offsetY ?? 0;
    this.uniforms.interactionRotation.value = interaction?.rotation ?? 0;
    this.uniforms.interactionScale.value = interaction?.scale ?? 1;
    this.uniforms.interactionAlpha.value = interaction?.alphaMultiplier ?? 1;
    (this.line.material as LineBasicNodeMaterial).blending = wave.additive
      ? AdditiveBlending
      : NormalBlending;
  }

  dispose() {
    disposeGeometry(this.line.geometry);
    disposeMaterial(this.line.material);
  }
}

class ProceduralWaveTarget {
  readonly group = new Group();
  private readonly custom: boolean;
  private readonly objects: ProceduralWaveLineObject[] = [];

  constructor(custom = false) {
    this.custom = custom;
  }

  sync(
    waves: Array<
      MilkdropProceduralWaveVisual | MilkdropProceduralCustomWaveVisual
    >,
    signals: MilkdropRuntimeSignals,
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    for (let index = 0; index < waves.length; index += 1) {
      const wave = waves[index];
      if (!wave) {
        continue;
      }
      let target = this.objects[index];
      if (!target || target.sampleCount !== wave.sampleCount) {
        target?.dispose();
        if (target) {
          this.group.remove(target.line);
        }
        target = new ProceduralWaveLineObject(wave.sampleCount, this.custom);
        this.objects[index] = target;
        this.group.add(target.line);
      }
      if ('mode' in wave && target.uniforms.mode) {
        target.uniforms.mode.value = wave.mode;
      }
      target.syncCommon(wave, signals, interaction);
    }
    while (this.objects.length > waves.length) {
      const target = this.objects.pop();
      if (!target) {
        continue;
      }
      this.group.remove(target.line);
      target.dispose();
    }
  }

  dispose() {
    for (const target of this.objects) {
      target.dispose();
    }
    this.objects.length = 0;
    this.group.removeFromParent();
  }
}

function createSegmentQuadGeometry() {
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      [0, -1, 0, 1, -1, 0, 0, 1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0],
      3,
    ),
  );
  geometry.setAttribute(
    'segmentCoord',
    new Float32BufferAttribute([0, -1, 1, -1, 0, 1, 0, 1, 1, -1, 1, 1], 2),
  );
  return geometry;
}

function createBorderRingGeometry() {
  const geometry = new InstancedBufferGeometry();
  const unitCorner: number[] = [];
  const innerWeight: number[] = [];
  const corners: Array<[number, number]> = [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (let index = 0; index < corners.length; index += 1) {
    const current = corners[index] as [number, number];
    const next = corners[(index + 1) % corners.length] as [number, number];
    unitCorner.push(
      current[0],
      current[1],
      next[0],
      next[1],
      current[0],
      current[1],
      current[0],
      current[1],
      next[0],
      next[1],
      next[0],
      next[1],
    );
    innerWeight.push(0, 0, 1, 1, 0, 1);
  }
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      new Array((unitCorner.length / 2) * 3).fill(0),
      3,
    ),
  );
  geometry.setAttribute(
    'unitCorner',
    new Float32BufferAttribute(unitCorner, 2),
  );
  geometry.setAttribute(
    'innerWeight',
    new Float32BufferAttribute(innerWeight, 1),
  );
  return geometry;
}

function getUnitPolygonFillGeometry(sides: number) {
  const safeSides = Math.max(3, Math.round(sides));
  const cached = polygonFillGeometryCache.get(safeSides);
  if (cached) {
    return cached;
  }
  const positions: number[] = [];
  for (let index = 0; index < safeSides; index += 1) {
    const currentAngle = (index / safeSides) * Math.PI * 2;
    const nextAngle = ((index + 1) / safeSides) * Math.PI * 2;
    positions.push(
      0,
      0,
      0,
      Math.cos(currentAngle),
      Math.sin(currentAngle),
      0,
      Math.cos(nextAngle),
      Math.sin(nextAngle),
      0,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  polygonFillGeometryCache.set(safeSides, geometry);
  return geometry;
}

function getUnitPolygonRingGeometry(sides: number) {
  const safeSides = Math.max(3, Math.round(sides));
  const cached = polygonRingGeometryCache.get(safeSides);
  if (cached) {
    return cached;
  }
  const geometry = new InstancedBufferGeometry();
  const unitCorner: number[] = [];
  const innerWeight: number[] = [];
  for (let index = 0; index < safeSides; index += 1) {
    const currentAngle = (index / safeSides) * Math.PI * 2;
    const nextAngle = ((index + 1) / safeSides) * Math.PI * 2;
    const current: [number, number] = [
      Math.cos(currentAngle),
      Math.sin(currentAngle),
    ];
    const next: [number, number] = [Math.cos(nextAngle), Math.sin(nextAngle)];
    unitCorner.push(
      current[0],
      current[1],
      next[0],
      next[1],
      current[0],
      current[1],
      current[0],
      current[1],
      next[0],
      next[1],
      next[0],
      next[1],
    );
    innerWeight.push(0, 0, 1, 1, 0, 1);
  }
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(
      new Array((unitCorner.length / 2) * 3).fill(0),
      3,
    ),
  );
  geometry.setAttribute(
    'unitCorner',
    new Float32BufferAttribute(unitCorner, 2),
  );
  geometry.setAttribute(
    'innerWeight',
    new Float32BufferAttribute(innerWeight, 1),
  );
  polygonRingGeometryCache.set(safeSides, geometry);
  return geometry;
}

function cloneAsInstancedGeometry(geometry: BufferGeometry) {
  return new InstancedBufferGeometry().copy(
    geometry as unknown as InstancedBufferGeometry,
  ) as InstancedBufferGeometry;
}

function ensureInstancedAttribute(
  geometry: InstancedBufferGeometry,
  name: string,
  itemSize: number,
  count: number,
) {
  const existing = geometry.getAttribute(name);
  const requiredLength = Math.max(1, count * itemSize);
  if (
    existing instanceof InstancedBufferAttribute &&
    existing.itemSize === itemSize &&
    existing.array.length === requiredLength
  ) {
    return existing;
  }
  const attribute = new InstancedBufferAttribute(
    new Float32Array(requiredLength),
    itemSize,
  );
  attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
  return attribute;
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

function appendPolylineSegments(
  target: SegmentInstance[],
  positions: number[],
  color: MilkdropColor,
  alpha: number,
  width: number,
) {
  for (let index = 0; index + 5 < positions.length; index += 3) {
    target.push({
      startX: positions[index] ?? 0,
      startY: positions[index + 1] ?? 0,
      startZ: positions[index + 2] ?? 0.24,
      endX: positions[index + 3] ?? 0,
      endY: positions[index + 4] ?? 0,
      endZ: positions[index + 5] ?? 0.24,
      color,
      alpha,
      width,
    });
  }
}

class InstancedSegmentBatch {
  readonly group = new Group();
  private readonly normalMesh = this.createMesh(NormalBlending);
  private readonly additiveMesh = this.createMesh(AdditiveBlending);

  constructor() {
    this.group.add(this.normalMesh, this.additiveMesh);
  }

  private createMesh(
    blending: typeof NormalBlending | typeof AdditiveBlending,
  ) {
    return new Mesh(
      SEGMENT_QUAD_GEOMETRY.clone(),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        blending,
        vertexShader: `
          attribute vec2 segmentCoord;
          attribute vec3 instanceStart;
          attribute vec3 instanceEnd;
          attribute vec4 instanceColorAlpha;
          attribute float instanceHalfWidth;
          varying vec4 vColor;

          void main() {
            vec2 delta = instanceEnd.xy - instanceStart.xy;
            float lengthDelta = length(delta);
            vec2 direction = lengthDelta > 0.000001 ? delta / lengthDelta : vec2(1.0, 0.0);
            vec2 normal = vec2(-direction.y, direction.x);
            vec2 base = mix(instanceStart.xy, instanceEnd.xy, segmentCoord.x);
            vec2 point = base + normal * segmentCoord.y * instanceHalfWidth;
            float z = mix(instanceStart.z, instanceEnd.z, segmentCoord.x);
            vColor = instanceColorAlpha;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(point, z, 1.0);
          }
        `,
        fragmentShader: `
          varying vec4 vColor;
          void main() {
            gl_FragColor = vColor;
          }
        `,
      }),
    );
  }

  syncSplit(
    normalInstances: SegmentInstance[],
    additiveInstances: SegmentInstance[],
  ) {
    this.syncMesh(this.normalMesh, normalInstances);
    this.syncMesh(this.additiveMesh, additiveInstances);
  }

  private syncMesh(mesh: Mesh, instances: SegmentInstance[]) {
    const geometry = mesh.geometry as InstancedBufferGeometry;
    geometry.instanceCount = instances.length;
    mesh.visible = instances.length > 0;
    const start = ensureInstancedAttribute(
      geometry,
      'instanceStart',
      3,
      instances.length,
    );
    const end = ensureInstancedAttribute(
      geometry,
      'instanceEnd',
      3,
      instances.length,
    );
    const colorAlpha = ensureInstancedAttribute(
      geometry,
      'instanceColorAlpha',
      4,
      instances.length,
    );
    const halfWidth = ensureInstancedAttribute(
      geometry,
      'instanceHalfWidth',
      1,
      instances.length,
    );

    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index] as SegmentInstance;
      start.setXYZ(index, instance.startX, instance.startY, instance.startZ);
      end.setXYZ(index, instance.endX, instance.endY, instance.endZ);
      colorAlpha.setXYZW(
        index,
        instance.color.r,
        instance.color.g,
        instance.color.b,
        instance.alpha,
      );
      halfWidth.setX(index, instance.width * 0.5);
    }
    start.needsUpdate = true;
    end.needsUpdate = true;
    colorAlpha.needsUpdate = true;
    halfWidth.needsUpdate = true;
  }

  dispose() {
    [this.normalMesh, this.additiveMesh].forEach((mesh) => {
      disposeGeometry(mesh.geometry);
      disposeMaterial(mesh.material);
    });
  }
}

class InstancedBorderBatch {
  readonly group = new Group();
  private readonly fillMesh = this.createMesh(0.285);
  private readonly outlineMesh = this.createMesh(0.3);
  private readonly accentMesh = this.createMesh(0.31);

  constructor() {
    this.group.add(this.fillMesh, this.outlineMesh, this.accentMesh);
  }

  private createMesh(_defaultZ: number) {
    return new Mesh(
      BORDER_RING_GEOMETRY.clone(),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        vertexShader: `
          attribute vec2 unitCorner;
          attribute float innerWeight;
          attribute vec4 instanceInsets;
          attribute vec4 instanceColorAlpha;
          varying vec4 vColor;

          void main() {
            float outerScale = 1.0 - 2.0 * instanceInsets.y;
            float innerScale = 1.0 - 2.0 * instanceInsets.z;
            float scale = mix(outerScale, innerScale, innerWeight) * instanceInsets.w;
            vec2 point = unitCorner * scale;
            vColor = instanceColorAlpha;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(point, instanceInsets.x, 1.0);
          }
        `,
        fragmentShader: `
          varying vec4 vColor;
          void main() {
            gl_FragColor = vColor;
          }
        `,
      }),
    );
  }

  sync(borders: MilkdropBorderVisual[], alphaMultiplier: number) {
    const fills: BorderRingInstance[] = [];
    const outlines: BorderRingInstance[] = [];
    const accents: BorderRingInstance[] = [];
    for (const border of borders) {
      const inset = border.key === 'outer' ? border.size : border.size + 0.08;
      fills.push({
        inset,
        outerInset: 0,
        innerInset: inset,
        scale: 1,
        z: 0.285,
        color: border.color,
        alpha: Math.max(0.08, border.alpha * 0.45) * alphaMultiplier,
      });
      outlines.push({
        inset,
        outerInset: Math.max(0, inset - 0.0035),
        innerInset: Math.min(0.98, inset + 0.0035),
        scale: 1,
        z: 0.3,
        color: border.color,
        alpha: border.alpha * alphaMultiplier,
      });
      if (border.styled) {
        const scale = border.key === 'outer' ? 0.985 : 1.015;
        accents.push({
          inset,
          outerInset: Math.max(0, inset - 0.003),
          innerInset: Math.min(0.98, inset + 0.003),
          scale,
          z: 0.31,
          color: border.color,
          alpha: Math.max(0.15, border.alpha * 0.55) * alphaMultiplier,
        });
      }
    }
    this.syncMesh(this.fillMesh, fills);
    this.syncMesh(this.outlineMesh, outlines);
    this.syncMesh(this.accentMesh, accents);
  }

  private syncMesh(mesh: Mesh, instances: BorderRingInstance[]) {
    const geometry = mesh.geometry as InstancedBufferGeometry;
    geometry.instanceCount = instances.length;
    mesh.visible = instances.length > 0;
    const insets = ensureInstancedAttribute(
      geometry,
      'instanceInsets',
      4,
      instances.length,
    );
    const colorAlpha = ensureInstancedAttribute(
      geometry,
      'instanceColorAlpha',
      4,
      instances.length,
    );
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index] as BorderRingInstance;
      insets.setXYZW(
        index,
        instance.z,
        instance.outerInset,
        instance.innerInset,
        instance.scale,
      );
      colorAlpha.setXYZW(
        index,
        instance.color.r,
        instance.color.g,
        instance.color.b,
        instance.alpha,
      );
    }
    insets.needsUpdate = true;
    colorAlpha.needsUpdate = true;
  }

  dispose() {
    [this.fillMesh, this.outlineMesh, this.accentMesh].forEach((mesh) => {
      disposeGeometry(mesh.geometry);
      disposeMaterial(mesh.material);
    });
  }
}

class InstancedShapeFillBatch {
  readonly mesh: Mesh;

  constructor(
    sides: number,
    blending: typeof NormalBlending | typeof AdditiveBlending,
  ) {
    this.mesh = new Mesh(
      cloneAsInstancedGeometry(getUnitPolygonFillGeometry(sides)),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending,
        vertexShader: `
          attribute vec4 instanceTransform;
          attribute vec4 instanceColorAlpha;
          varying vec4 vColor;

          void main() {
            float cosR = cos(instanceTransform.w);
            float sinR = sin(instanceTransform.w);
            vec2 scaled = position.xy * instanceTransform.z;
            vec2 rotated = vec2(
              scaled.x * cosR - scaled.y * sinR,
              scaled.x * sinR + scaled.y * cosR
            );
            vColor = instanceColorAlpha;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(
              rotated + instanceTransform.xy,
              0.14,
              1.0
            );
          }
        `,
        fragmentShader: `
          varying vec4 vColor;
          void main() {
            gl_FragColor = vColor;
          }
        `,
      }),
    );
  }

  sync(instances: ShapeFillInstance[]) {
    const geometry = this.mesh.geometry as InstancedBufferGeometry;
    geometry.instanceCount = instances.length;
    this.mesh.visible = instances.length > 0;
    const transform = ensureInstancedAttribute(
      geometry,
      'instanceTransform',
      4,
      instances.length,
    );
    const colorAlpha = ensureInstancedAttribute(
      geometry,
      'instanceColorAlpha',
      4,
      instances.length,
    );
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index] as ShapeFillInstance;
      transform.setXYZW(
        index,
        instance.x,
        instance.y,
        instance.radius,
        instance.rotation,
      );
      colorAlpha.setXYZW(
        index,
        instance.color.r,
        instance.color.g,
        instance.color.b,
        instance.alpha,
      );
    }
    transform.needsUpdate = true;
    colorAlpha.needsUpdate = true;
  }

  dispose() {
    disposeGeometry(this.mesh.geometry);
    disposeMaterial(this.mesh.material);
  }
}

class InstancedShapeRingBatch {
  readonly mesh: Mesh;

  constructor(
    sides: number,
    blending: typeof NormalBlending | typeof AdditiveBlending,
  ) {
    this.mesh = new Mesh(
      getUnitPolygonRingGeometry(sides).clone(),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending,
        vertexShader: `
          attribute vec2 unitCorner;
          attribute float innerWeight;
          attribute vec4 instanceTransform;
          attribute vec4 instanceColorAlpha;
          attribute vec2 instanceScales;
          varying vec4 vColor;

          void main() {
            float localScale = mix(instanceScales.x, instanceScales.y, innerWeight) * instanceTransform.z;
            vec2 scaled = unitCorner * localScale;
            float cosR = cos(instanceTransform.w);
            float sinR = sin(instanceTransform.w);
            vec2 rotated = vec2(
              scaled.x * cosR - scaled.y * sinR,
              scaled.x * sinR + scaled.y * cosR
            );
            vColor = instanceColorAlpha;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(
              rotated + instanceTransform.xy,
              0.16,
              1.0
            );
          }
        `,
        fragmentShader: `
          varying vec4 vColor;
          void main() {
            gl_FragColor = vColor;
          }
        `,
      }),
    );
  }

  sync(instances: ShapeRingInstance[]) {
    const geometry = this.mesh.geometry as InstancedBufferGeometry;
    geometry.instanceCount = instances.length;
    this.mesh.visible = instances.length > 0;
    const transform = ensureInstancedAttribute(
      geometry,
      'instanceTransform',
      4,
      instances.length,
    );
    const colorAlpha = ensureInstancedAttribute(
      geometry,
      'instanceColorAlpha',
      4,
      instances.length,
    );
    const scales = ensureInstancedAttribute(
      geometry,
      'instanceScales',
      2,
      instances.length,
    );
    for (let index = 0; index < instances.length; index += 1) {
      const instance = instances[index] as ShapeRingInstance;
      transform.setXYZW(
        index,
        instance.x,
        instance.y,
        instance.radius,
        instance.rotation,
      );
      colorAlpha.setXYZW(
        index,
        instance.color.r,
        instance.color.g,
        instance.color.b,
        instance.alpha,
      );
      scales.setXY(index, instance.outerScale, instance.innerScale);
    }
    transform.needsUpdate = true;
    colorAlpha.needsUpdate = true;
    scales.needsUpdate = true;
  }

  dispose() {
    disposeGeometry(this.mesh.geometry);
    disposeMaterial(this.mesh.material);
  }
}

class ShapeBatchBucket {
  readonly group = new Group();
  private readonly fill: InstancedShapeFillBatch;
  private readonly outline: InstancedShapeRingBatch;
  private readonly accent: InstancedShapeRingBatch;

  constructor(sides: number, additive: boolean) {
    const blending = additive ? AdditiveBlending : NormalBlending;
    this.fill = new InstancedShapeFillBatch(sides, blending);
    this.outline = new InstancedShapeRingBatch(sides, blending);
    this.accent = new InstancedShapeRingBatch(sides, blending);
    this.group.add(this.fill.mesh, this.outline.mesh, this.accent.mesh);
  }

  sync(shapes: MilkdropShapeVisual[], alphaMultiplier: number) {
    const fillInstances: ShapeFillInstance[] = [];
    const outlineInstances: ShapeRingInstance[] = [];
    const accentInstances: ShapeRingInstance[] = [];
    for (const shape of shapes) {
      const fillColor = getShapeFillFallbackColor(shape);
      fillInstances.push({
        x: shape.x,
        y: shape.y,
        radius: shape.radius,
        rotation: shape.rotation,
        color: fillColor,
        alpha: (fillColor.a ?? 0.4) * alphaMultiplier,
      });
      outlineInstances.push({
        x: shape.x,
        y: shape.y,
        radius: shape.radius,
        rotation: shape.rotation,
        color: shape.borderColor,
        alpha: (shape.borderColor.a ?? 1) * alphaMultiplier,
        outerScale: 1,
        innerScale: 0.965,
      });
      if (shape.thickOutline) {
        accentInstances.push({
          x: shape.x,
          y: shape.y,
          radius: shape.radius,
          rotation: shape.rotation,
          color: shape.borderColor,
          alpha:
            Math.max(0.2, (shape.borderColor.a ?? 1) * 0.45) * alphaMultiplier,
          outerScale: 1.045,
          innerScale: 1.01,
        });
      }
    }
    this.fill.sync(fillInstances);
    this.outline.sync(outlineInstances);
    this.accent.sync(accentInstances);
  }

  dispose() {
    this.fill.dispose();
    this.outline.dispose();
    this.accent.dispose();
  }
}

class ShapeBatchTarget {
  readonly group = new Group();
  private readonly buckets = new Map<string, ShapeBatchBucket>();

  sync(shapes: MilkdropShapeVisual[], alphaMultiplier: number) {
    const grouped = new Map<string, MilkdropShapeVisual[]>();
    for (const shape of shapes) {
      const key = `${shape.sides}:${shape.additive ? 'add' : 'norm'}`;
      const bucket = grouped.get(key) ?? [];
      bucket.push(shape);
      grouped.set(key, bucket);
    }

    for (const [key, bucketShapes] of grouped) {
      let bucket = this.buckets.get(key);
      if (!bucket) {
        const [sides, mode] = key.split(':');
        bucket = new ShapeBatchBucket(Number(sides), mode === 'add');
        this.buckets.set(key, bucket);
        this.group.add(bucket.group);
      }
      bucket.sync(bucketShapes, alphaMultiplier);
    }

    for (const [key, bucket] of [...this.buckets.entries()]) {
      if (grouped.has(key)) {
        continue;
      }
      bucket.dispose();
      this.group.remove(bucket.group);
      this.buckets.delete(key);
    }
  }

  dispose() {
    for (const bucket of this.buckets.values()) {
      bucket.dispose();
    }
    this.buckets.clear();
  }
}

class WebGPUBatchingLayer implements MilkdropRendererBatcher {
  private readonly root = new Group();
  private readonly waveTargets = new Map<string, InstancedSegmentBatch>();
  private readonly proceduralWaveTargets = new Map<
    string,
    ProceduralWaveTarget
  >();
  private readonly shapeTargets = new Map<string, ShapeBatchTarget>();
  private readonly borderTargets = new Map<string, InstancedBorderBatch>();

  attach(root: Group) {
    root.add(this.root);
  }

  private getWaveTarget(key: string) {
    let target = this.waveTargets.get(key);
    if (!target) {
      target = new InstancedSegmentBatch();
      this.waveTargets.set(key, target);
      this.root.add(target.group);
    }
    return target;
  }

  private getProceduralWaveTarget(key: string, custom = false) {
    let target = this.proceduralWaveTargets.get(key);
    if (!target) {
      target = new ProceduralWaveTarget(custom);
      this.proceduralWaveTargets.set(key, target);
      this.root.add(target.group);
    }
    return target;
  }

  private getShapeTarget(key: string) {
    let target = this.shapeTargets.get(key);
    if (!target) {
      target = new ShapeBatchTarget();
      this.shapeTargets.set(key, target);
      this.root.add(target.group);
    }
    return target;
  }

  private getBorderTarget(key: string) {
    let target = this.borderTargets.get(key);
    if (!target) {
      target = new InstancedBorderBatch();
      this.borderTargets.set(key, target);
      this.root.add(target.group);
    }
    return target;
  }

  renderWaveGroup(
    target: string,
    _group: Group,
    waves: MilkdropWaveVisual[],
    alphaMultiplier: number,
  ) {
    if (waves.some((wave) => wave.drawMode === 'dots')) {
      return false;
    }
    const normal: SegmentInstance[] = [];
    const additive: SegmentInstance[] = [];
    for (const wave of waves) {
      const destination = wave.additive ? additive : normal;
      appendPolylineSegments(
        destination,
        wave.positions,
        wave.color,
        wave.alpha * alphaMultiplier,
        0.0025 * Math.max(1, wave.thickness),
      );
    }
    this.getWaveTarget(`wave:${target}`).syncSplit(normal, additive);
    return true;
  }

  renderProceduralWaveGroup(
    target: 'main-wave' | 'trail-waves',
    _group: Group,
    waves: MilkdropProceduralWaveVisual[],
    signals: MilkdropRuntimeSignals,
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    this.getProceduralWaveTarget(`procedural-wave:${target}`).sync(
      waves,
      signals,
      interaction,
    );
    return true;
  }

  renderProceduralCustomWaveGroup(
    _group: Group,
    waves: MilkdropProceduralCustomWaveVisual[],
    signals: MilkdropRuntimeSignals,
    interaction?: MilkdropGpuInteractionTransform | null,
  ) {
    this.getProceduralWaveTarget('procedural-custom-wave', true).sync(
      waves,
      signals,
      interaction,
    );
    return true;
  }

  renderShapeGroup(
    target: string,
    _group: Group,
    shapes: MilkdropShapeVisual[],
    alphaMultiplier: number,
  ) {
    this.getShapeTarget(target).sync(shapes, alphaMultiplier);
    return true;
  }

  renderBorderGroup(
    target: string,
    _group: Group,
    borders: MilkdropBorderVisual[],
    alphaMultiplier: number,
  ) {
    this.getBorderTarget(target).sync(borders, alphaMultiplier);
    return true;
  }

  renderLineVisualGroup(
    target: string,
    _group: Group,
    lines: Array<{
      positions: number[];
      color: MilkdropColor;
      alpha: number;
      additive?: boolean;
    }>,
    alphaMultiplier: number,
  ) {
    const normal: SegmentInstance[] = [];
    const additive: SegmentInstance[] = [];
    for (const line of lines) {
      appendPolylineSegments(
        (line.additive ?? false) ? additive : normal,
        line.positions,
        line.color,
        line.alpha * alphaMultiplier,
        0.0025,
      );
    }
    this.getWaveTarget(`line:${target}`).syncSplit(normal, additive);
    return true;
  }

  dispose() {
    for (const target of this.waveTargets.values()) {
      target.dispose();
    }
    for (const target of this.proceduralWaveTargets.values()) {
      target.dispose();
    }
    for (const target of this.shapeTargets.values()) {
      target.dispose();
    }
    for (const target of this.borderTargets.values()) {
      target.dispose();
    }
    this.waveTargets.clear();
    this.proceduralWaveTargets.clear();
    this.shapeTargets.clear();
    this.borderTargets.clear();
    this.root.removeFromParent();
  }
}

export function createMilkdropWebGPURendererAdapter(
  config: MilkdropWebGPURendererAdapterConfig,
) {
  return createMilkdropRendererAdapterCore({
    ...config,
    backend: 'webgpu',
    behavior: WEBGPU_MILKDROP_BACKEND_BEHAVIOR,
    createFeedbackManager: createMilkdropWebGPUFeedbackManager,
    batcher: new WebGPUBatchingLayer(),
  });
}
