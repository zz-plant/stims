import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
} from 'three';
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
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralWaveVisual,
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
  closeLoop = false,
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
  if (!closeLoop || positions.length < 6) {
    return;
  }
  const lastPointIndex = positions.length - 3;
  target.push({
    startX: positions[lastPointIndex] ?? 0,
    startY: positions[lastPointIndex + 1] ?? 0,
    startZ: positions[lastPointIndex + 2] ?? 0.24,
    endX: positions[0] ?? 0,
    endY: positions[1] ?? 0,
    endZ: positions[2] ?? 0.24,
    color,
    alpha,
    width,
  });
}

function buildProceduralWavePoint(
  wave: MilkdropProceduralWaveVisual,
  sampleT: number,
  sampleValue: number,
  velocity: number,
) {
  const centeredSample = sampleValue - 0.5;
  const mysteryPhase = wave.mystery * Math.PI;
  let x = 0;
  let y = 0;

  if (wave.mode < 0.5) {
    x = -1.1 + sampleT * 2.2;
    y =
      wave.centerY +
      Math.sin(sampleT * Math.PI * 2 + wave.time * (0.55 + wave.mystery)) *
        (0.06 + wave.trebleAtt * 0.08) +
      centeredSample * wave.scale * 1.7 +
      velocity * 0.12;
  } else if (wave.mode < 1.5) {
    const angle =
      sampleT * Math.PI * 2 +
      wave.time * 0.32 +
      centeredSample * 0.8 +
      velocity * 2.5;
    const radius =
      0.22 +
      sampleValue * wave.scale +
      wave.beatPulse * 0.08 +
      Math.sin(sampleT * Math.PI * 4 + wave.time) * 0.015;
    x = wave.centerX + Math.cos(angle) * radius;
    y = wave.centerY + Math.sin(angle) * radius;
  } else if (wave.mode < 2.5) {
    const angle =
      sampleT * Math.PI * 5 +
      wave.time * (0.4 + wave.mystery * 0.2) +
      centeredSample * 0.65;
    const radius =
      0.08 + sampleT * 0.6 + sampleValue * wave.scale * 0.6 + velocity * 0.12;
    x = wave.centerX + Math.cos(angle) * radius;
    y = wave.centerY + Math.sin(angle) * radius;
  } else if (wave.mode < 3.5) {
    const angle = sampleT * Math.PI * 2 + wave.time * 0.22;
    const spoke =
      0.2 +
      sampleValue * wave.scale * 1.05 +
      Math.sin(sampleT * Math.PI * 12 + mysteryPhase) * 0.05 +
      velocity * 0.09;
    const pinch = 0.55 + Math.cos(sampleT * Math.PI * 6 + wave.time) * 0.2;
    x = wave.centerX + Math.cos(angle) * spoke;
    y = wave.centerY + Math.sin(angle) * spoke * pinch;
  } else if (wave.mode < 4.5) {
    x =
      wave.centerX +
      (sampleValue - 0.5) * wave.scale * 1.85 +
      Math.sin(sampleT * Math.PI * 10 + wave.time * 0.5) * 0.04;
    y = 1.08 - sampleT * 2.16 + velocity * 0.22;
  } else if (wave.mode < 5.5) {
    const angle = sampleT * Math.PI * 2 + wave.time * 0.18;
    const xAmp = 0.26 + sampleValue * wave.scale * 0.75;
    const yAmp = 0.18 + sampleValue * wave.scale;
    x =
      wave.centerX +
      Math.sin(angle * (2 + wave.mystery * 0.6)) * xAmp +
      Math.cos(angle * 4 + mysteryPhase) * 0.04 +
      velocity * 0.16;
    y =
      wave.centerY +
      Math.sin(angle * (3 + wave.mystery * 0.5) + Math.PI / 2) * yAmp;
  } else if (wave.mode < 6.5) {
    const band = (sampleValue - 0.5) * wave.scale * 1.4;
    x = -1.05 + sampleT * 2.1;
    y =
      wave.centerY +
      (Math.floor(sampleT * 512) % 2 === 0 ? 1 : -1) * band +
      Math.sin(sampleT * Math.PI * 8 + wave.time * 0.55) * 0.03 +
      velocity * 0.18;
  } else {
    const angle =
      sampleT * Math.PI * 2 + wave.time * (0.24 + wave.mystery * 0.1);
    const petals =
      3 + Math.floor(Math.min(Math.max(wave.mystery * 3, 0), 3) + 0.5);
    const radius =
      0.12 +
      (0.2 + sampleValue * wave.scale * 0.9) *
        Math.cos(petals * angle + mysteryPhase) +
      velocity * 0.14;
    x = wave.centerX + Math.cos(angle) * radius;
    y = wave.centerY + Math.sin(angle) * radius;
  }

  return { x, y };
}

function appendProceduralWaveSegments(
  target: SegmentInstance[],
  wave: MilkdropProceduralWaveVisual,
) {
  let previous: { x: number; y: number } | null = null;
  const width = 0.0025 * Math.max(1, wave.thickness);
  for (let index = 0; index < wave.samples.length; index += 1) {
    const sampleT = index / Math.max(1, wave.samples.length - 1);
    const point = buildProceduralWavePoint(
      wave,
      sampleT,
      wave.samples[index] ?? 0,
      wave.velocities[index] ?? 0,
    );
    if (previous) {
      target.push({
        startX: previous.x,
        startY: previous.y,
        startZ: 0.24,
        endX: point.x,
        endY: point.y,
        endZ: 0.24,
        color: wave.color,
        alpha: wave.alpha,
        width,
      });
    }
    previous = point;
  }
}

function appendProceduralCustomWaveSegments(
  target: SegmentInstance[],
  wave: MilkdropProceduralCustomWaveVisual,
) {
  let previous: { x: number; y: number } | null = null;
  for (let index = 0; index < wave.samples.length; index += 1) {
    const sampleT = index / Math.max(1, wave.samples.length - 1);
    const sampleValue = wave.samples[index] ?? 0;
    const x = wave.centerX + (-1 + sampleT * 2) * 0.85;
    const baseY =
      wave.centerY +
      (sampleValue - 0.5) * 0.55 * wave.scaling * (1 + wave.mystery * 0.25);
    const orbitalY =
      wave.centerY +
      Math.sin(sampleT * Math.PI * 2 * (1 + wave.mystery) + wave.time) *
        0.18 *
        wave.scaling;
    const point = {
      x,
      y: wave.spectrum ? baseY : orbitalY,
    };
    if (previous) {
      target.push({
        startX: previous.x,
        startY: previous.y,
        startZ: 0.28,
        endX: point.x,
        endY: point.y,
        endZ: 0.28,
        color: wave.color,
        alpha: wave.alpha,
        width: 0.003,
      });
    }
    previous = point;
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
        wave.closed,
      );
    }
    this.getWaveTarget(`wave:${target}`).syncSplit(normal, additive);
    return true;
  }

  renderProceduralWaveGroup(
    target: string,
    _group: Group,
    waves: MilkdropProceduralWaveVisual[],
  ) {
    const normal: SegmentInstance[] = [];
    const additive: SegmentInstance[] = [];
    for (const wave of waves) {
      appendProceduralWaveSegments(wave.additive ? additive : normal, wave);
    }
    this.getWaveTarget(`procedural-wave:${target}`).syncSplit(normal, additive);
    return true;
  }

  renderProceduralCustomWaveGroup(
    _group: Group,
    waves: MilkdropProceduralCustomWaveVisual[],
  ) {
    const normal: SegmentInstance[] = [];
    const additive: SegmentInstance[] = [];
    for (const wave of waves) {
      appendProceduralCustomWaveSegments(
        wave.additive ? additive : normal,
        wave,
      );
    }
    this.getWaveTarget('procedural-custom-wave').syncSplit(normal, additive);
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
    for (const target of this.shapeTargets.values()) {
      target.dispose();
    }
    for (const target of this.borderTargets.values()) {
      target.dispose();
    }
    this.waveTargets.clear();
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
