import type { Texture } from 'three';
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
import type { MilkdropRendererBatcher } from './renderer-adapter.ts';
import {
  getUnitPolygonVertices,
  normalizeMilkdropPolygonSides,
} from './renderer-adapter-shared';
import {
  getMilkdropSegmentWidth,
  MILKDROP_CUSTOM_WAVE_Z,
  MILKDROP_THICK_SHAPE_PASS_OFFSET,
  MILKDROP_WAVE_Z,
} from './renderer-helpers/primitive-rasterization-metrics';
import type {
  MilkdropBorderVisual,
  MilkdropColor,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralWaveVisual,
  MilkdropShapeVisual,
  MilkdropWaveVisual,
} from './types';

type ShapeFillInstance = {
  x: number;
  y: number;
  radius: number;
  rotation: number;
  primaryColor: MilkdropColor;
  primaryAlpha: number;
  secondaryColor: MilkdropColor;
  secondaryAlpha: number;
  useGradient: number;
  textured: number;
  textureZoom: number;
  textureAngle: number;
};

type ShapeRingInstance = {
  x: number;
  y: number;
  radius: number;
  rotation: number;
  color: MilkdropColor;
  alpha: number;
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
const SHAPE_OUTLINE_INNER_OFFSET = 0;
const SHAPE_THICK_OUTLINE_OUTER_OFFSET = MILKDROP_THICK_SHAPE_PASS_OFFSET;
const PROJECTM_STEREO_OFFSET = 32 / 512;
const polygonFillGeometryCache = new Map<number, BufferGeometry>();
const polygonRingGeometryCache = new Map<number, InstancedBufferGeometry>();

/**
 * Memory monitoring for WebGPU batching layer.
 * Track allocations to help diagnose memory issues.
 */
const memoryStats = {
  geometryCacheHits: 0,
  geometryCacheMisses: 0,
  bufferReallocations: 0,
  peakBufferSize: { lineData: 0, styleData: 0, controlData: 0, joinData: 0 },
};

/**
 * Buffer pool for reusing Float32Arrays to reduce GC pressure.
 * Maintains a collection of pre-allocated buffers of various sizes.
 */
class Float32BufferPool {
  private pools = new Map<number, Float32Array[]>();
  private allocations = 0;

  acquire(size: number): Float32Array {
    const bucketSize = this.getBucketSize(size);
    const pool = this.pools.get(bucketSize) ?? [];
    if (pool.length > 0) {
      const buffer = pool.pop();
      if (buffer) {
        this.allocations++;
        return buffer;
      }
    }
    this.allocations++;
    return new Float32Array(bucketSize);
  }

  release(buffer: Float32Array): void {
    const bucketSize = buffer.length;
    const pool = this.pools.get(bucketSize) ?? [];
    pool.push(buffer);
    this.pools.set(bucketSize, pool);
  }

  clear(): void {
    this.pools.clear();
    this.allocations = 0;
  }

  getAllocationCount(): number {
    return this.allocations;
  }

  private getBucketSize(requestedSize: number): number {
    if (requestedSize <= 64) return 64;
    if (requestedSize <= 128) return 128;
    if (requestedSize <= 256) return 256;
    if (requestedSize <= 512) return 512;
    if (requestedSize <= 1024) return 1024;
    if (requestedSize <= 2048) return 2048;
    if (requestedSize <= 4096) return 4096;
    if (requestedSize <= 8192) return 8192;
    if (requestedSize <= 16384) return 16384;
    if (requestedSize <= 32768) return 32768;
    if (requestedSize <= 65536) return 65536;
    if (requestedSize <= 131072) return 131072;
    if (requestedSize <= 262144) return 262144;
    if (requestedSize <= 524288) return 524288;
    return 1048576;
  }
}

const globalBufferPool = new Float32BufferPool();

/**
 * Configuration for pre-allocation of upload buffers.
 */
export interface BufferPreallocationConfig {
  initialLineSegments?: number;
  initialStyleSlots?: number;
  initialControlSlots?: number;
  initialJoinSlots?: number;
}

const DEFAULT_PREALLOCATION_REQUIRED = {
  initialLineSegments: 256,
  initialStyleSlots: 256,
  initialControlSlots: 256,
  initialJoinSlots: 256,
} as const;

const DEFAULT_PREALLOCATION: BufferPreallocationConfig =
  DEFAULT_PREALLOCATION_REQUIRED;

let currentPreallocationConfig = { ...DEFAULT_PREALLOCATION };

/**
 * Configure pre-allocation sizes for upload buffers.
 * Call this before creating batching layers to avoid reallocations.
 */
export function configureBufferPreallocation(
  config: BufferPreallocationConfig,
): void {
  currentPreallocationConfig = {
    initialLineSegments:
      config.initialLineSegments ?? DEFAULT_PREALLOCATION.initialLineSegments,
    initialStyleSlots:
      config.initialStyleSlots ?? DEFAULT_PREALLOCATION.initialStyleSlots,
    initialControlSlots:
      config.initialControlSlots ?? DEFAULT_PREALLOCATION.initialControlSlots,
    initialJoinSlots:
      config.initialJoinSlots ?? DEFAULT_PREALLOCATION.initialJoinSlots,
  };
}

/**
 * Get current buffer preallocation configuration.
 */
export function getBufferPreallocationConfig(): Readonly<BufferPreallocationConfig> {
  return { ...currentPreallocationConfig };
}

/**
 * Clear the global buffer pool to free memory.
 */
export function clearBufferPool(): void {
  globalBufferPool.clear();
}

/**
 * Get buffer pool allocation statistics.
 */
export function getBufferPoolStats(): { allocations: number } {
  return { allocations: globalBufferPool.getAllocationCount() };
}

/**
 * Clears static geometry caches to free memory.
 * Call this when disposing the batching layer or between sessions.
 */
export function clearStaticGeometryCaches(): void {
  for (const geometry of polygonFillGeometryCache.values()) {
    disposeGeometry(geometry);
  }
  polygonFillGeometryCache.clear();
  for (const geometry of polygonRingGeometryCache.values()) {
    disposeGeometry(geometry);
  }
  polygonRingGeometryCache.clear();
}

/**
 * Returns current memory statistics for the batching layer.
 */
export function getWebGPUBatchingMemoryStats(): Readonly<{
  geometryCacheHits: number;
  geometryCacheMisses: number;
  bufferReallocations: number;
  peakBufferSize: {
    lineData: number;
    styleData: number;
    controlData: number;
    joinData: number;
  };
}> {
  return { ...memoryStats };
}

/**
 * Resets memory statistics (useful for testing or session tracking).
 */
export function resetWebGPUBatchingMemoryStats(): void {
  memoryStats.geometryCacheHits = 0;
  memoryStats.geometryCacheMisses = 0;
  memoryStats.bufferReallocations = 0;
  memoryStats.peakBufferSize = {
    lineData: 0,
    styleData: 0,
    controlData: 0,
    joinData: 0,
  };
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

function toRadiusNormalizedScale(radius: number, offset: number) {
  const safeRadius = Math.max(0.0001, radius);
  return Math.max(0, safeRadius + offset) / safeRadius;
}

function createShapeRingScales(
  radius: number,
  {
    outerOffset = 0,
    innerOffset = 0,
  }: { outerOffset?: number; innerOffset?: number } = {},
) {
  return {
    outerScale: toRadiusNormalizedScale(radius, outerOffset),
    innerScale: toRadiusNormalizedScale(radius, innerOffset),
  };
}

function getUnitPolygonFillGeometry(sides: number) {
  const safeSides = normalizeMilkdropPolygonSides(sides);
  const cached = polygonFillGeometryCache.get(safeSides);
  if (cached) {
    memoryStats.geometryCacheHits++;
    return cached;
  }
  memoryStats.geometryCacheMisses++;
  const vertices = getUnitPolygonVertices(safeSides);
  const positions: number[] = [];
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    if (!current || !next) {
      continue;
    }
    positions.push(0, 0, 0, current.x, current.y, 0, next.x, next.y, 0);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  polygonFillGeometryCache.set(safeSides, geometry);
  return geometry;
}

function getUnitPolygonRingGeometry(sides: number) {
  const safeSides = normalizeMilkdropPolygonSides(sides);
  const cached = polygonRingGeometryCache.get(safeSides);
  if (cached) {
    memoryStats.geometryCacheHits++;
    return cached;
  }
  memoryStats.geometryCacheMisses++;
  const geometry = new InstancedBufferGeometry();
  const unitCorner: number[] = [];
  const innerWeight: number[] = [];
  const vertices = getUnitPolygonVertices(safeSides);
  for (let index = 0; index < vertices.length; index += 1) {
    const currentVertex = vertices[index];
    const nextVertex = vertices[(index + 1) % vertices.length];
    if (!currentVertex || !nextVertex) {
      continue;
    }
    const current: [number, number] = [currentVertex.x, currentVertex.y];
    const next: [number, number] = [nextVertex.x, nextVertex.y];
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

function getBatchedTargetRenderOrder(key: string) {
  switch (key) {
    case 'wave:main-wave':
    case 'procedural-wave:main-wave':
      return 20;
    case 'wave:custom-wave':
    case 'procedural-custom-wave':
      return 30;
    case 'line:trails':
    case 'procedural-wave:trail-waves':
      return 40;
    case 'shapes':
      return 50;
    case 'borders':
      return 60;
    case 'line:motion-vectors':
      return 70;
    case 'wave:blend-main-wave':
      return 80;
    case 'wave:blend-custom-wave':
      return 90;
    case 'blend-shapes':
      return 100;
    case 'blend-borders':
      return 110;
    case 'line:blend-motion-vectors':
      return 120;
    default:
      return 0;
  }
}

class CompactSegmentUploadBuffer {
  private lineData: Float32Array<ArrayBufferLike>;
  private styleData: Float32Array<ArrayBufferLike>;
  private controlData: Float32Array<ArrayBufferLike>;
  private joinData: Float32Array<ArrayBufferLike>;
  private lineCapacity = 0;
  private styleCapacity = 0;
  private controlCapacity = 0;
  private joinCapacity = 0;
  count = 0;

  constructor() {
    // Pre-allocate buffers based on configuration
    const config = currentPreallocationConfig;
    const defaultConfig = DEFAULT_PREALLOCATION_REQUIRED;
    this.lineCapacity =
      (config.initialLineSegments ?? defaultConfig.initialLineSegments) * 4;
    this.styleCapacity =
      (config.initialStyleSlots ?? defaultConfig.initialStyleSlots) * 4;
    this.controlCapacity =
      (config.initialControlSlots ?? defaultConfig.initialControlSlots) * 3;
    this.joinCapacity =
      (config.initialJoinSlots ?? defaultConfig.initialJoinSlots) * 4;
    this.lineData = new Float32Array(this.lineCapacity);
    this.styleData = new Float32Array(this.styleCapacity);
    this.controlData = new Float32Array(this.controlCapacity);
    this.joinData = new Float32Array(this.joinCapacity);
  }

  reset() {
    this.count = 0;
  }

  getLineData() {
    return this.lineData.subarray(0, this.count * 4);
  }

  getStyleData() {
    return this.styleData.subarray(0, this.count * 4);
  }

  getControlData() {
    return this.controlData.subarray(0, this.count * 3);
  }

  getJoinData() {
    return this.joinData.subarray(0, this.count * 4);
  }

  appendSegment(
    startX: number,
    startY: number,
    startZ: number,
    endX: number,
    endY: number,
    endZ: number,
    color: MilkdropColor,
    alpha: number,
    width: number,
    {
      startExtension = 1,
      endExtension = 1,
      startCap = 1,
      endCap = 1,
    }: {
      startExtension?: number;
      endExtension?: number;
      startCap?: number;
      endCap?: number;
    } = {},
  ) {
    this.ensureCapacity(this.count + 1);
    const lineOffset = this.count * 4;
    this.lineData[lineOffset] = startX;
    this.lineData[lineOffset + 1] = startY;
    this.lineData[lineOffset + 2] = endX - startX;
    this.lineData[lineOffset + 3] = endY - startY;

    const styleOffset = this.count * 4;
    this.styleData[styleOffset] = color.r;
    this.styleData[styleOffset + 1] = color.g;
    this.styleData[styleOffset + 2] = color.b;
    this.styleData[styleOffset + 3] = alpha;

    const controlOffset = this.count * 3;
    this.controlData[controlOffset] = startZ;
    this.controlData[controlOffset + 1] = endZ;
    this.controlData[controlOffset + 2] = width * 0.5;

    const joinOffset = this.count * 4;
    this.joinData[joinOffset] = startExtension;
    this.joinData[joinOffset + 1] = endExtension;
    this.joinData[joinOffset + 2] = startCap;
    this.joinData[joinOffset + 3] = endCap;
    this.count += 1;
  }

  appendPolyline(
    positions: number[],
    color: MilkdropColor,
    alpha: number,
    width: number,
    closeLoop = false,
  ) {
    const pointCount = Math.floor(positions.length / 3);
    const segmentCount = closeLoop ? pointCount : Math.max(0, pointCount - 1);

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const startPointIndex = segmentIndex;
      const endPointIndex = closeLoop
        ? (segmentIndex + 1) % pointCount
        : segmentIndex + 1;
      const previousPointIndex = closeLoop
        ? (startPointIndex - 1 + pointCount) % pointCount
        : startPointIndex - 1;
      const nextPointIndex = closeLoop
        ? (endPointIndex + 1) % pointCount
        : endPointIndex + 1;

      const startX = positions[startPointIndex * 3] ?? 0;
      const startY = positions[startPointIndex * 3 + 1] ?? 0;
      const startZ = positions[startPointIndex * 3 + 2] ?? 0.24;
      const endX = positions[endPointIndex * 3] ?? 0;
      const endY = positions[endPointIndex * 3 + 1] ?? 0;
      const endZ = positions[endPointIndex * 3 + 2] ?? 0.24;

      const currentDirection = normalizeDirection(endX - startX, endY - startY);
      const previousDirection =
        previousPointIndex >= 0
          ? normalizeDirection(
              startX - (positions[previousPointIndex * 3] ?? 0),
              startY - (positions[previousPointIndex * 3 + 1] ?? 0),
            )
          : null;
      const nextDirection =
        nextPointIndex < pointCount
          ? normalizeDirection(
              (positions[nextPointIndex * 3] ?? 0) - endX,
              (positions[nextPointIndex * 3 + 1] ?? 0) - endY,
            )
          : null;

      this.appendSegment(
        startX,
        startY,
        startZ,
        endX,
        endY,
        endZ,
        color,
        alpha,
        width,
        {
          startExtension: computeJoinExtension(
            previousDirection,
            currentDirection,
          ),
          endExtension: computeJoinExtension(currentDirection, nextDirection),
          startCap: !closeLoop && startPointIndex === 0 ? 1 : 0,
          endCap: !closeLoop && endPointIndex === pointCount - 1 ? 1 : 0,
        },
      );
    }
  }

  appendProceduralWave(wave: MilkdropProceduralWaveVisual) {
    const positions: number[] = [];
    const width = getMilkdropSegmentWidth(wave.thickness);
    for (let index = 0; index < wave.samples.length; index += 1) {
      const sampleT = index / Math.max(1, wave.samples.length - 1);
      const point = buildProceduralWavePoint(
        wave,
        sampleT,
        index,
        wave.samples[index] ?? 0,
        wave.velocities[index] ?? 0,
      );
      positions.push(point.x, point.y, MILKDROP_WAVE_Z);
    }
    this.appendPolyline(positions, wave.color, wave.alpha, width, wave.closed);
  }

  appendProceduralCustomWave(wave: MilkdropProceduralCustomWaveVisual) {
    const positions: number[] = [];
    const width = getMilkdropSegmentWidth(wave.thickness);
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
      const pointY = wave.spectrum ? baseY : orbitalY;
      positions.push(x, pointY, MILKDROP_CUSTOM_WAVE_Z);
    }
    this.appendPolyline(positions, wave.color, wave.alpha, width);
  }

  private ensureCapacity(count: number) {
    this.lineData = ensureFloat32Capacity(this.lineData, count * 4, 'lineData');
    this.styleData = ensureFloat32Capacity(
      this.styleData,
      count * 4,
      'styleData',
    );
    this.controlData = ensureFloat32Capacity(
      this.controlData,
      count * 3,
      'controlData',
    );
    this.joinData = ensureFloat32Capacity(this.joinData, count * 4, 'joinData');
  }
}

function ensureFloat32Capacity(
  source: Float32Array<ArrayBufferLike>,
  requiredLength: number,
  bufferType: 'lineData' | 'styleData' | 'controlData' | 'joinData',
) {
  if (source.length >= requiredLength) {
    return source;
  }
  memoryStats.bufferReallocations++;
  const nextLength = Math.max(requiredLength, Math.max(4, source.length * 2));
  const resized = new Float32Array(nextLength);
  resized.set(source);

  // Update peak buffer size tracking
  if (nextLength > memoryStats.peakBufferSize[bufferType]) {
    memoryStats.peakBufferSize[bufferType] = nextLength;
  }

  return resized;
}

function normalizeDirection(dx: number, dy: number) {
  const length = Math.hypot(dx, dy);
  if (length <= 0.000001) {
    return { x: 1, y: 0 };
  }
  return { x: dx / length, y: dy / length };
}

function computeJoinExtension(
  previousDirection: { x: number; y: number } | null,
  nextDirection: { x: number; y: number } | null,
) {
  if (!previousDirection || !nextDirection) {
    return 1;
  }

  const bisectorX = previousDirection.x + nextDirection.x;
  const bisectorY = previousDirection.y + nextDirection.y;
  const bisectorLength = Math.hypot(bisectorX, bisectorY);
  if (bisectorLength <= 0.000001) {
    return 1;
  }

  const normalizedBisectorX = bisectorX / bisectorLength;
  const normalizedBisectorY = bisectorY / bisectorLength;
  const projection =
    normalizedBisectorX * nextDirection.x +
    normalizedBisectorY * nextDirection.y;
  return Math.min(2.5, Math.max(1, 1 / Math.max(0.35, projection)));
}

function buildProceduralWavePoint(
  wave: MilkdropProceduralWaveVisual,
  sampleT: number,
  sampleIndex: number,
  sampleValue: number,
  _velocity: number,
) {
  // sampleValue is in [-1, 1] (from sampleByteData: ((data[i] - 128) / 128)).
  // Do NOT recenter with sampleValue - 0.5.
  let x = 0;
  let y = 0;

  if (wave.mode < 0.5) {
    // Circle — matches CPU path (frame-generation.ts mode 0).
    const angle = sampleT * 6.28318 + wave.time * 0.2;
    const radius = 0.5 + 0.4 * sampleValue + wave.mystery;
    x = wave.centerX + Math.cos(angle) * radius;
    y = wave.centerY + Math.sin(angle) * radius;
  } else if (wave.mode < 1.5) {
    // XYOscillationSpiral — matches CPU path (frame-generation.ts mode 1).
    const sampleR = sampleValue;
    const sampleL = sampleProceduralWaveOffset(
      wave.samples,
      sampleT,
      PROJECTM_STEREO_OFFSET,
    );
    const radius = 0.53 + 0.43 * sampleR + wave.mystery;
    const angle = sampleL * 1.5708 + wave.time * 2.3;
    x = wave.centerX + Math.cos(angle) * radius;
    y = wave.centerY + Math.sin(angle) * radius;
  } else if (wave.mode < 2.5) {
    x = wave.centerX + sampleValue * wave.scale;
    y =
      wave.centerY +
      sampleProceduralWaveOffset(
        wave.samples,
        sampleT,
        PROJECTM_STEREO_OFFSET,
      ) *
        wave.scale;
  } else if (wave.mode < 3.5) {
    x = wave.centerX + sampleValue * wave.scale;
    y =
      wave.centerY +
      sampleProceduralWaveOffset(
        wave.samples,
        sampleT,
        PROJECTM_STEREO_OFFSET,
      ) *
        wave.scale;
  } else if (wave.mode < 4.5) {
    // DerivativeLine (HORIZONTAL) — matches CPU path (frame-generation.ts mode 4).
    const w1 = 0.45 + 0.5 * (wave.mystery * 0.5 + 0.5);
    const w2 = 1 - w1;
    const sampleOffset64 = sampleProceduralWaveOffset(
      wave.samples,
      sampleT,
      PROJECTM_STEREO_OFFSET * 2,
    );
    const sampleOffset96 = sampleProceduralWaveOffset(
      wave.samples,
      sampleT,
      PROJECTM_STEREO_OFFSET * 3,
    );
    x = -1.0 + 2.0 * sampleT + wave.centerX + sampleValue * 0.44 * wave.scale;
    y =
      wave.centerY +
      sampleProceduralWaveOffset(
        wave.samples,
        sampleT,
        PROJECTM_STEREO_OFFSET,
      ) *
        0.47 *
        wave.scale;
    // Intra-frame momentum (simplified for GPU parity).
    x = x * w2 + w1 * sampleOffset64 * wave.scale;
    y = y * w2 + w1 * sampleOffset96 * wave.scale;
  } else if (wave.mode < 5.5) {
    const sampleL = sampleProceduralWaveOffset(
      wave.samples,
      sampleT,
      PROJECTM_STEREO_OFFSET,
    );
    const sample64 = sampleProceduralWaveOffset(
      wave.samples,
      sampleT,
      PROJECTM_STEREO_OFFSET * 2,
    );
    const sample96 = sampleProceduralWaveOffset(
      wave.samples,
      sampleT,
      PROJECTM_STEREO_OFFSET * 3,
    );
    const x0 = sampleValue * sample64 + sampleL * sample96;
    const y0 = sampleValue * sampleValue - sampleL * sample64;
    const rot = wave.time * 0.3;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    x = wave.centerX + (x0 * cosR - y0 * sinR) * wave.scale;
    y = wave.centerY + (x0 * sinR + y0 * cosR) * wave.scale;
  } else if (wave.mode < 6.5) {
    // Line — matches CPU path (frame-generation.ts mode 6).
    x = -1.0 + 2.0 * sampleT;
    y = wave.centerY + sampleValue * 0.25 * wave.scale;
  } else {
    const sampleL = sampleProceduralWaveOffset(
      wave.samples,
      sampleT,
      PROJECTM_STEREO_OFFSET,
    );
    const separation = 0.1 + wave.mystery * 0.2;
    x = -1 + 2 * sampleT;
    y =
      wave.centerY +
      (sampleIndex % 2 === 0
        ? sampleValue * wave.scale * 0.5 + separation
        : sampleL * wave.scale * 0.5 - separation);
  }

  return { x, y };
}

function sampleProceduralWaveOffset(
  values: number[],
  sampleT: number,
  offset: number,
) {
  if (values.length === 0) {
    return 0;
  }
  if (values.length === 1) {
    return values[0] ?? 0;
  }
  const clampedT = Math.min(Math.max(sampleT + offset, 0), 1);
  const scaledIndex = clampedT * (values.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(values.length - 1, lowerIndex + 1);
  const mix = scaledIndex - lowerIndex;
  const lower = values[lowerIndex] ?? 0;
  const upper = values[upperIndex] ?? lower;
  return lower + (upper - lower) * mix;
}

class InstancedSegmentBatch {
  readonly group = new Group();
  private readonly normalMesh: Mesh;
  private readonly additiveMesh: Mesh;

  constructor(renderOrder: number) {
    this.group.renderOrder = renderOrder;
    this.normalMesh = this.createMesh(NormalBlending, renderOrder);
    this.additiveMesh = this.createMesh(AdditiveBlending, renderOrder + 1);
    this.group.add(this.normalMesh, this.additiveMesh);
  }

  private createMesh(
    blending: typeof NormalBlending | typeof AdditiveBlending,
    renderOrder: number,
  ) {
    const mesh = new Mesh(
      SEGMENT_QUAD_GEOMETRY.clone(),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        blending,
        vertexShader: `
          attribute vec2 segmentCoord;
          attribute vec4 instanceLine;
          attribute vec4 instanceColorAlpha;
          attribute vec3 instanceControl;
          attribute vec4 instanceJoin;
          varying vec4 vColor;
          varying vec4 vJoin;
          varying vec2 vSegmentLocal;
          varying float vSegmentLengthUnits;

          void main() {
            vec2 delta = instanceLine.zw;
            float lengthDelta = length(delta);
            vec2 direction = lengthDelta > 0.000001 ? delta / lengthDelta : vec2(1.0, 0.0);
            vec2 normal = vec2(-direction.y, direction.x);
            float halfWidth = max(instanceControl.z, 0.000001);
            float startExtension = max(instanceJoin.x, 0.0);
            float endExtension = max(instanceJoin.y, 0.0);
            float clampedT = clamp(segmentCoord.x, 0.0, 1.0);
            vec2 base = instanceLine.xy + delta * segmentCoord.x + direction * mix(-startExtension, endExtension, segmentCoord.x) * halfWidth;
            vec2 point = base + normal * segmentCoord.y * halfWidth;
            float z = mix(instanceControl.x, instanceControl.y, clampedT);
            vColor = instanceColorAlpha;
            vJoin = instanceJoin;
            vSegmentLocal = vec2(
              mix(
                -startExtension,
                lengthDelta / halfWidth + endExtension,
                segmentCoord.x
              ),
              segmentCoord.y
            );
            vSegmentLengthUnits = lengthDelta / halfWidth;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(point, z, 1.0);
          }
        `,
        fragmentShader: `
          varying vec4 vColor;
          varying vec4 vJoin;
          varying vec2 vSegmentLocal;
          varying float vSegmentLengthUnits;
          void main() {
            float edgeDistance = abs(vSegmentLocal.y);
            if (vSegmentLocal.x < 0.0 && vJoin.z > 0.5) {
              edgeDistance = length(
                vec2(
                  vSegmentLocal.x / max(vJoin.x, 0.000001),
                  vSegmentLocal.y
                )
              );
            } else if (vSegmentLocal.x > vSegmentLengthUnits && vJoin.w > 0.5) {
              edgeDistance = length(
                vec2(
                  (vSegmentLocal.x - vSegmentLengthUnits) /
                    max(vJoin.y, 0.000001),
                  vSegmentLocal.y
                )
              );
            }
            float alpha = 1.0 - smoothstep(0.88, 1.0, edgeDistance);
            if (alpha <= 0.0) {
              discard;
            }
            gl_FragColor = vec4(vColor.rgb, vColor.a * alpha);
          }
        `,
      }),
    );
    mesh.renderOrder = renderOrder;
    return mesh;
  }

  syncSplit(
    normalInstances: CompactSegmentUploadBuffer,
    additiveInstances: CompactSegmentUploadBuffer,
  ) {
    this.syncMesh(this.normalMesh, normalInstances);
    this.syncMesh(this.additiveMesh, additiveInstances);
  }

  private syncMesh(mesh: Mesh, instances: CompactSegmentUploadBuffer) {
    const geometry = mesh.geometry as InstancedBufferGeometry;
    geometry.instanceCount = instances.count;
    mesh.visible = instances.count > 0;
    const line = ensureInstancedAttribute(
      geometry,
      'instanceLine',
      4,
      instances.count,
    );
    const colorAlpha = ensureInstancedAttribute(
      geometry,
      'instanceColorAlpha',
      4,
      instances.count,
    );
    const control = ensureInstancedAttribute(
      geometry,
      'instanceControl',
      3,
      instances.count,
    );
    const join = ensureInstancedAttribute(
      geometry,
      'instanceJoin',
      4,
      instances.count,
    );
    (line.array as Float32Array).set(instances.getLineData());
    (colorAlpha.array as Float32Array).set(instances.getStyleData());
    (control.array as Float32Array).set(instances.getControlData());
    (join.array as Float32Array).set(instances.getJoinData());
    line.needsUpdate = true;
    colorAlpha.needsUpdate = true;
    control.needsUpdate = true;
    join.needsUpdate = true;
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
  private readonly fillMesh: Mesh;
  private readonly outlineMesh: Mesh;

  constructor(renderOrder: number) {
    this.group.renderOrder = renderOrder;
    this.fillMesh = this.createMesh(0.285, renderOrder);
    this.outlineMesh = this.createMesh(0.3, renderOrder);
    this.group.add(this.fillMesh, this.outlineMesh);
  }

  private createMesh(_defaultZ: number, renderOrder: number) {
    const mesh = new Mesh(
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
    mesh.renderOrder = renderOrder;
    return mesh;
  }

  sync(borders: MilkdropBorderVisual[], alphaMultiplier: number) {
    const fills: BorderRingInstance[] = [];
    const outlines: BorderRingInstance[] = [];
    const outerBorder = borders.find((b) => b.key === 'outer');
    const outerBorderSize = outerBorder ? outerBorder.size : 0;

    for (const border of borders) {
      const isOuter = border.key === 'outer';
      const outerInset = isOuter ? 0 : outerBorderSize;
      const innerInset = isOuter ? border.size : outerBorderSize + border.size;

      fills.push({
        inset: innerInset,
        outerInset,
        innerInset,
        scale: 1,
        z: 0.285,
        color: border.color,
        alpha: border.alpha * 0.45 * alphaMultiplier,
      });
      outlines.push({
        inset: innerInset,
        outerInset: Math.max(0, innerInset - 0.0035),
        innerInset: Math.min(0.98, innerInset + 0.0035),
        scale: 1,
        z: 0.3,
        color: border.color,
        alpha: border.alpha * alphaMultiplier,
      });
    }
    this.syncMesh(this.fillMesh, fills);
    this.syncMesh(this.outlineMesh, outlines);
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
    [this.fillMesh, this.outlineMesh].forEach((mesh) => {
      disposeGeometry(mesh.geometry);
      disposeMaterial(mesh.material);
    });
  }
}

class InstancedShapeFillBatch {
  readonly mesh: Mesh;
  private readonly getShapeTexture: () => Texture | null;

  constructor(
    sides: number,
    blending: typeof NormalBlending | typeof AdditiveBlending,
    getShapeTexture: () => Texture | null,
    renderOrder: number,
  ) {
    this.getShapeTexture = getShapeTexture;
    this.mesh = new Mesh(
      cloneAsInstancedGeometry(getUnitPolygonFillGeometry(sides)),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending,
        uniforms: {
          shapeTexture: {
            value: null,
          },
          textureAspectY: {
            value: 1,
          },
        },
        vertexShader: `
          attribute vec4 instanceTransform;
          attribute vec4 instancePrimaryColorAlpha;
          attribute vec4 instanceSecondaryColorAlpha;
          attribute vec4 instanceFillControl;
          varying vec4 vPrimaryColor;
          varying vec4 vSecondaryColor;
          varying float vGradient;
          varying float vBlend;
          varying vec2 vLocal;
          varying float vTextured;
          varying float vTextureZoom;
          varying float vTextureAngle;

          void main() {
            float cosR = cos(instanceTransform.w);
            float sinR = sin(instanceTransform.w);
            vec2 scaled = position.xy * instanceTransform.z;
            vec2 rotated = vec2(
              scaled.x * cosR - scaled.y * sinR,
              scaled.x * sinR + scaled.y * cosR
            );
            vPrimaryColor = instancePrimaryColorAlpha;
            vSecondaryColor = instanceSecondaryColorAlpha;
            vGradient = instanceFillControl.x;
            vBlend = clamp(length(position.xy), 0.0, 1.0);
            vLocal = position.xy;
            vTextured = instanceFillControl.y;
            vTextureZoom = instanceFillControl.z;
            vTextureAngle = instanceFillControl.w;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(
              rotated + instanceTransform.xy,
              0.14,
              1.0
            );
          }
        `,
        fragmentShader: `
          uniform sampler2D shapeTexture;
          uniform float textureAspectY;
          varying vec4 vPrimaryColor;
          varying vec4 vSecondaryColor;
          varying float vGradient;
          varying float vBlend;
          varying vec2 vLocal;
          varying float vTextured;
          varying float vTextureZoom;
          varying float vTextureAngle;

          vec2 rotate2d(vec2 value, float angle) {
            float s = sin(angle);
            float c = cos(angle);
            return vec2(
              value.x * c - value.y * s,
              value.x * s + value.y * c
            );
          }

          void main() {
            vec4 color = mix(vPrimaryColor, vSecondaryColor, vBlend * vGradient);
            if (vTextured > 0.5) {
              vec2 rotated = rotate2d(vLocal, vTextureAngle);
              vec2 sampleUv = vec2(
                0.5 +
                  0.5 * rotated.x * textureAspectY / max(vTextureZoom, 0.0001),
                0.5 + 0.5 * rotated.y / max(vTextureZoom, 0.0001)
              );
              vec4 sampled = texture2D(shapeTexture, fract(sampleUv));
              color = vec4(sampled.rgb * color.rgb, color.a * sampled.a);
            }
            gl_FragColor = color;
          }
        `,
      }),
    );
    this.mesh.renderOrder = renderOrder;
  }

  sync(instances: ShapeFillInstance[]) {
    const geometry = this.mesh.geometry as InstancedBufferGeometry;
    geometry.instanceCount = instances.length;
    this.mesh.visible = instances.length > 0;
    const material = this.mesh.material as ShaderMaterial;
    const shapeTexture = this.getShapeTexture();
    material.uniforms.shapeTexture.value = shapeTexture;
    material.uniforms.textureAspectY.value = getTextureAspectY(shapeTexture);
    const transform = ensureInstancedAttribute(
      geometry,
      'instanceTransform',
      4,
      instances.length,
    );
    const primaryColorAlpha = ensureInstancedAttribute(
      geometry,
      'instancePrimaryColorAlpha',
      4,
      instances.length,
    );
    const secondaryColorAlpha = ensureInstancedAttribute(
      geometry,
      'instanceSecondaryColorAlpha',
      4,
      instances.length,
    );
    const fillControl = ensureInstancedAttribute(
      geometry,
      'instanceFillControl',
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
      primaryColorAlpha.setXYZW(
        index,
        instance.primaryColor.r,
        instance.primaryColor.g,
        instance.primaryColor.b,
        instance.primaryAlpha,
      );
      secondaryColorAlpha.setXYZW(
        index,
        instance.secondaryColor.r,
        instance.secondaryColor.g,
        instance.secondaryColor.b,
        instance.secondaryAlpha,
      );
      fillControl.setXYZW(
        index,
        instance.useGradient,
        instance.textured,
        instance.textureZoom,
        instance.textureAngle,
      );
    }
    transform.needsUpdate = true;
    primaryColorAlpha.needsUpdate = true;
    secondaryColorAlpha.needsUpdate = true;
    fillControl.needsUpdate = true;
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
    layerZ: number,
    renderOrder: number,
  ) {
    this.mesh = new Mesh(
      getUnitPolygonRingGeometry(sides).clone(),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending,
        uniforms: {
          layerZ: { value: layerZ },
        },
        vertexShader: `
          uniform float layerZ;
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
              layerZ,
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
    this.mesh.renderOrder = renderOrder;
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
  private readonly getShapeTexture: () => Texture | null;

  constructor(
    sides: number,
    additive: boolean,
    getShapeTexture: () => Texture | null,
    renderOrder: number,
  ) {
    const bucketRenderOrder = renderOrder + (additive ? 1 : 0);
    const blending = additive ? AdditiveBlending : NormalBlending;
    this.getShapeTexture = getShapeTexture;
    this.group.renderOrder = bucketRenderOrder;
    this.fill = new InstancedShapeFillBatch(
      sides,
      blending,
      getShapeTexture,
      bucketRenderOrder,
    );
    this.outline = new InstancedShapeRingBatch(
      sides,
      blending,
      0.16,
      bucketRenderOrder,
    );
    this.group.add(this.fill.mesh, this.outline.mesh);
  }

  sync(shapes: MilkdropShapeVisual[], alphaMultiplier: number) {
    const fillInstances: ShapeFillInstance[] = [];
    const outlineInstances: ShapeRingInstance[] = [];
    for (const shape of shapes) {
      const outlineScales = createShapeRingScales(shape.radius, {
        outerOffset: shape.thickOutline ? SHAPE_THICK_OUTLINE_OUTER_OFFSET : 0,
        innerOffset: SHAPE_OUTLINE_INNER_OFFSET,
      });
      fillInstances.push({
        x: shape.x,
        y: shape.y,
        radius: shape.radius,
        rotation: shape.rotation,
        primaryColor: shape.color,
        primaryAlpha: (shape.color.a ?? 0.4) * alphaMultiplier,
        secondaryColor: shape.secondaryColor ?? shape.color,
        secondaryAlpha:
          (shape.secondaryColor?.a ?? shape.color.a ?? 0.4) * alphaMultiplier,
        useGradient: shape.secondaryColor ? 1 : 0,
        textured: shape.textured && this.getShapeTexture() !== null ? 1 : 0,
        textureZoom: Math.max(0.0001, shape.textureZoom ?? 1),
        textureAngle: shape.textureAngle ?? 0,
      });
      outlineInstances.push({
        x: shape.x,
        y: shape.y,
        radius: shape.radius,
        rotation: shape.rotation,
        color: shape.borderColor,
        alpha: (shape.borderColor.a ?? 1) * alphaMultiplier,
        outerScale: outlineScales.outerScale,
        innerScale: outlineScales.innerScale,
      });
    }
    this.fill.sync(fillInstances);
    this.outline.sync(outlineInstances);
  }

  dispose() {
    this.fill.dispose();
    this.outline.dispose();
  }
}

class ShapeBatchTarget {
  readonly group = new Group();
  private readonly buckets = new Map<string, ShapeBatchBucket>();
  private readonly getShapeTexture: () => Texture | null;
  private readonly renderOrder: number;

  constructor(getShapeTexture: () => Texture | null, renderOrder: number) {
    this.getShapeTexture = getShapeTexture;
    this.renderOrder = renderOrder;
    this.group.renderOrder = renderOrder;
  }

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
        bucket = new ShapeBatchBucket(
          Number(sides),
          mode === 'add',
          this.getShapeTexture,
          this.renderOrder,
        );
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
  private readonly normalSegmentUploads = new CompactSegmentUploadBuffer();
  private readonly additiveSegmentUploads = new CompactSegmentUploadBuffer();
  private shapeTexture: Texture | null = null;

  setShapeTexture(texture: Texture | null) {
    this.shapeTexture = texture;
  }

  private resetSegmentUploads() {
    this.normalSegmentUploads.reset();
    this.additiveSegmentUploads.reset();
  }

  attach(root: Group) {
    root.add(this.root);
  }

  private getWaveTarget(key: string) {
    let target = this.waveTargets.get(key);
    if (!target) {
      target = new InstancedSegmentBatch(getBatchedTargetRenderOrder(key));
      this.waveTargets.set(key, target);
      this.root.add(target.group);
    }
    return target;
  }

  private clearWaveTarget(key: string) {
    const target = this.waveTargets.get(key);
    if (!target) {
      return;
    }
    target.dispose();
    this.root.remove(target.group);
    this.waveTargets.delete(key);
  }

  private clearShapeTarget(key: string) {
    const target = this.shapeTargets.get(key);
    if (!target) {
      return;
    }
    target.dispose();
    this.root.remove(target.group);
    this.shapeTargets.delete(key);
  }

  private getShapeTarget(key: string) {
    let target = this.shapeTargets.get(key);
    if (!target) {
      target = new ShapeBatchTarget(
        () => this.shapeTexture,
        getBatchedTargetRenderOrder(key),
      );
      this.shapeTargets.set(key, target);
      this.root.add(target.group);
    }
    return target;
  }

  private getBorderTarget(key: string) {
    let target = this.borderTargets.get(key);
    if (!target) {
      target = new InstancedBorderBatch(getBatchedTargetRenderOrder(key));
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
    if (waves.some((wave) => wave.drawMode === 'dots' || wave.blendMode)) {
      this.clearWaveTarget(`wave:${target}`);
      return false;
    }
    this.resetSegmentUploads();
    for (const wave of waves) {
      const destination = wave.additive
        ? this.additiveSegmentUploads
        : this.normalSegmentUploads;
      destination.appendPolyline(
        wave.positions,
        wave.color,
        wave.alpha * alphaMultiplier,
        getMilkdropSegmentWidth(wave.thickness),
        wave.closed,
      );
    }
    this.getWaveTarget(`wave:${target}`).syncSplit(
      this.normalSegmentUploads,
      this.additiveSegmentUploads,
    );
    return true;
  }

  renderProceduralWaveGroup(
    target: string,
    _group: Group,
    waves: MilkdropProceduralWaveVisual[],
  ) {
    this.resetSegmentUploads();
    for (const wave of waves) {
      (wave.additive
        ? this.additiveSegmentUploads
        : this.normalSegmentUploads
      ).appendProceduralWave(wave);
    }
    this.getWaveTarget(`procedural-wave:${target}`).syncSplit(
      this.normalSegmentUploads,
      this.additiveSegmentUploads,
    );
    return true;
  }

  renderProceduralCustomWaveGroup(
    _group: Group,
    waves: MilkdropProceduralCustomWaveVisual[],
  ) {
    if (waves.some((wave) => wave.fieldProgram !== null)) {
      this.clearWaveTarget('procedural-custom-wave');
      return false;
    }
    this.resetSegmentUploads();
    for (const wave of waves) {
      (wave.additive
        ? this.additiveSegmentUploads
        : this.normalSegmentUploads
      ).appendProceduralCustomWave(wave);
    }
    this.getWaveTarget('procedural-custom-wave').syncSplit(
      this.normalSegmentUploads,
      this.additiveSegmentUploads,
    );
    return true;
  }

  renderShapeGroup(
    target: string,
    _group: Group,
    shapes: MilkdropShapeVisual[],
    alphaMultiplier: number,
  ) {
    if (shapes.some((shape) => shape.blendMode)) {
      this.clearShapeTarget(target);
      return false;
    }
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
    this.resetSegmentUploads();
    for (const line of lines) {
      ((line.additive ?? false)
        ? this.additiveSegmentUploads
        : this.normalSegmentUploads
      ).appendPolyline(
        line.positions,
        line.color,
        line.alpha * alphaMultiplier,
        getMilkdropSegmentWidth(1),
      );
    }
    this.getWaveTarget(`line:${target}`).syncSplit(
      this.normalSegmentUploads,
      this.additiveSegmentUploads,
    );
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

  /**
   * Full cleanup of batching layer including static caches.
   * Call this when completely disposing the renderer.
   */
  disposeWithCaches() {
    this.dispose();
    clearStaticGeometryCaches();
    clearBufferPool();
  }
}

export function createWebGPUBatchingLayer(): MilkdropRendererBatcher {
  return new WebGPUBatchingLayer();
}
