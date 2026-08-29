import type { Group, Mesh } from 'three';
import {
  AdditiveBlending,
  DoubleSide,
  NormalBlending,
  ShaderMaterial,
  Group as ThreeGroup,
  Mesh as ThreeMesh,
} from 'three';
import { disposeGeometry, disposeMaterial } from '../utils/three/three-dispose';
import {
  createSegmentQuadGeometry,
  getMilkdropLayerRenderOrder,
  type MilkdropRendererBatcher,
  syncSegmentMesh,
} from './renderer-adapter-shared';
import { getMilkdropSegmentWidth } from './renderer-helpers/primitive-rasterization-metrics';
import type { MilkdropColor, MilkdropWaveVisual } from './types';

type SegmentBatchTarget =
  | 'main-wave'
  | 'custom-wave'
  | 'blend-main-wave'
  | 'blend-custom-wave'
  | 'trails'
  | 'motion-vectors'
  | 'blend-motion-vectors';

export type MilkdropSegmentBatchingOptions = {
  fallbackCustomWaves?: boolean;
};

const SEGMENT_QUAD_GEOMETRY = createSegmentQuadGeometry();

function ensureFloat32Capacity(
  source: Float32Array<ArrayBufferLike>,
  requiredLength: number,
) {
  if (source.length >= requiredLength) {
    return source;
  }
  const nextLength = Math.max(requiredLength, Math.max(4, source.length * 2));
  const resized = new Float32Array(nextLength);
  resized.set(source);
  return resized;
}

/**
 * Miter extension at a joint, in half-width units. Takes the two directions as
 * scalars rather than `{x, y}` pairs so the hot polyline path stays
 * allocation-free.
 */
function computeJoinExtension(
  previousX: number,
  previousY: number,
  nextX: number,
  nextY: number,
) {
  const bisectorX = previousX + nextX;
  const bisectorY = previousY + nextY;
  const bisectorLength = Math.hypot(bisectorX, bisectorY);
  if (bisectorLength <= 0.000001) {
    return 1;
  }

  const normalizedBisectorX = bisectorX / bisectorLength;
  const normalizedBisectorY = bisectorY / bisectorLength;
  const projection = normalizedBisectorX * nextX + normalizedBisectorY * nextY;
  return Math.min(2.5, Math.max(1, 1 / Math.max(0.35, projection)));
}

/**
 * Scratch buffers reused across every `appendPolyline` call. Polylines are
 * batched synchronously inside a single frame and never re-entrantly, so a
 * module-level scratch is safe and keeps the hot path allocation-free.
 * Float64 (not Float32) so the cached directions are bit-identical to the
 * values the previous per-segment implementation computed inline.
 */
let scratchDirectionX = new Float64Array(0);
let scratchDirectionY = new Float64Array(0);
let scratchJoinExtension = new Float64Array(0);

function ensureScratchCapacity(length: number) {
  if (scratchDirectionX.length >= length) {
    return;
  }
  const next = Math.max(length, 256);
  scratchDirectionX = new Float64Array(next);
  scratchDirectionY = new Float64Array(next);
  scratchJoinExtension = new Float64Array(next);
}

class CompactSegmentUploadBuffer {
  private lineData: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private styleData: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private controlData: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private joinData: Float32Array<ArrayBufferLike> = new Float32Array(0);
  count = 0;

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

  /**
   * Hot path: called for every wave, trail and motion vector, every frame.
   *
   * The previous implementation appended one segment at a time through a
   * helper that allocated an options object per segment and re-derived each
   * point's direction up to three times (via a `{x, y}`-returning normalize).
   * This walks the polyline in three allocation-free passes over preallocated
   * scratch instead:
   *   1. one normalized direction per point-pair (was ~3x redundant work),
   *   2. one join extension per joint -- segment i's end extension is exactly
   *      segment i+1's start extension, so it is computed once and shared,
   *   3. a single write pass straight into the upload arrays, with capacity
   *      reserved once for the whole polyline instead of once per segment.
   *
   * The arithmetic is deliberately operation-for-operation identical to the old
   * per-segment version; the emitted buffers are bit-identical. Keep it that
   * way when editing.
   */
  appendPolyline(
    positions: ArrayLike<number>,
    color: MilkdropColor,
    alpha: number,
    width: number,
    closeLoop = false,
  ) {
    const pointCount = Math.floor(positions.length / 3);
    const segmentCount = closeLoop ? pointCount : Math.max(0, pointCount - 1);
    if (segmentCount <= 0) {
      return;
    }

    // Direction count matches the number of point-pairs the old code could
    // normalize: every point for a closed loop, one fewer for an open strip.
    const directionCount = closeLoop ? pointCount : pointCount - 1;
    ensureScratchCapacity(directionCount);
    const directionX = scratchDirectionX;
    const directionY = scratchDirectionY;
    const joinExtension = scratchJoinExtension;

    for (let index = 0; index < directionCount; index += 1) {
      const nextIndex = closeLoop ? (index + 1) % pointCount : index + 1;
      const dx = (positions[nextIndex * 3] ?? 0) - (positions[index * 3] ?? 0);
      const dy =
        (positions[nextIndex * 3 + 1] ?? 0) - (positions[index * 3 + 1] ?? 0);
      const length = Math.hypot(dx, dy);
      if (length <= 0.000001) {
        directionX[index] = 1;
        directionY[index] = 0;
      } else {
        directionX[index] = dx / length;
        directionY[index] = dy / length;
      }
    }

    // joinExtension[i] is the extension at the joint entering segment i.
    // An open strip has no incoming direction at segment 0, so it stays 1.
    joinExtension[0] = closeLoop
      ? computeJoinExtension(
          directionX[directionCount - 1] as number,
          directionY[directionCount - 1] as number,
          directionX[0] as number,
          directionY[0] as number,
        )
      : 1;
    for (let index = 1; index < segmentCount; index += 1) {
      joinExtension[index] = computeJoinExtension(
        directionX[index - 1] as number,
        directionY[index - 1] as number,
        directionX[index] as number,
        directionY[index] as number,
      );
    }

    this.ensureCapacity(this.count + segmentCount);
    const lineData = this.lineData;
    const styleData = this.styleData;
    const controlData = this.controlData;
    const joinData = this.joinData;
    const colorR = color.r;
    const colorG = color.g;
    const colorB = color.b;
    const halfWidth = width * 0.5;
    const lastPointIndex = pointCount - 1;
    let cursor = this.count;

    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const endPointIndex = closeLoop
        ? (segmentIndex + 1) % pointCount
        : segmentIndex + 1;

      const startX = positions[segmentIndex * 3] ?? 0;
      const startY = positions[segmentIndex * 3 + 1] ?? 0;
      const startZ = positions[segmentIndex * 3 + 2] ?? 0.24;
      const endX = positions[endPointIndex * 3] ?? 0;
      const endY = positions[endPointIndex * 3 + 1] ?? 0;
      const endZ = positions[endPointIndex * 3 + 2] ?? 0.24;

      const quadOffset = cursor * 4;
      lineData[quadOffset] = startX;
      lineData[quadOffset + 1] = startY;
      lineData[quadOffset + 2] = endX - startX;
      lineData[quadOffset + 3] = endY - startY;

      styleData[quadOffset] = colorR;
      styleData[quadOffset + 1] = colorG;
      styleData[quadOffset + 2] = colorB;
      styleData[quadOffset + 3] = alpha;

      const controlOffset = cursor * 3;
      controlData[controlOffset] = startZ;
      controlData[controlOffset + 1] = endZ;
      controlData[controlOffset + 2] = halfWidth;

      joinData[quadOffset] = joinExtension[segmentIndex] as number;
      // The extension leaving segment i is the one entering segment i+1; a
      // closed loop wraps back to joint 0, an open strip has no outgoing joint.
      joinData[quadOffset + 1] =
        segmentIndex + 1 < segmentCount
          ? (joinExtension[segmentIndex + 1] as number)
          : closeLoop
            ? (joinExtension[0] as number)
            : 1;
      joinData[quadOffset + 2] = !closeLoop && segmentIndex === 0 ? 1 : 0;
      joinData[quadOffset + 3] =
        !closeLoop && endPointIndex === lastPointIndex ? 1 : 0;
      cursor += 1;
    }

    this.count = cursor;
  }

  private ensureCapacity(count: number) {
    this.lineData = ensureFloat32Capacity(this.lineData, count * 4);
    this.styleData = ensureFloat32Capacity(this.styleData, count * 4);
    this.controlData = ensureFloat32Capacity(this.controlData, count * 3);
    this.joinData = ensureFloat32Capacity(this.joinData, count * 4);
  }
}

class InstancedSegmentBatch {
  readonly group = new ThreeGroup();
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
    const mesh = new ThreeMesh(
      SEGMENT_QUAD_GEOMETRY.clone(),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
        // Flat z-layered 2D geometry: skip three.js's transparent+DoubleSide
        // two-pass render (it bumps material.needsUpdate twice per object per
        // frame, forcing getParameters/getProgram churn on every material).
        forceSinglePass: true,
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
    mesh.frustumCulled = false;
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
    syncSegmentMesh(mesh, instances);
  }

  dispose() {
    [this.normalMesh, this.additiveMesh].forEach((mesh) => {
      disposeGeometry(mesh.geometry);
      disposeMaterial(mesh.material);
    });
  }
}

class SegmentBatchingLayer implements MilkdropRendererBatcher {
  private readonly options: MilkdropSegmentBatchingOptions;
  private readonly root = new ThreeGroup();
  private readonly targets = new Map<
    SegmentBatchTarget,
    InstancedSegmentBatch
  >();
  private readonly normalUploads = new CompactSegmentUploadBuffer();
  private readonly additiveUploads = new CompactSegmentUploadBuffer();

  constructor(options: MilkdropSegmentBatchingOptions = {}) {
    this.options = options;
  }

  attach(root: Group) {
    root.add(this.root);
  }

  private resetUploads() {
    this.normalUploads.reset();
    this.additiveUploads.reset();
  }

  private getTarget(target: SegmentBatchTarget) {
    let batch = this.targets.get(target);
    if (!batch) {
      batch = new InstancedSegmentBatch(getMilkdropLayerRenderOrder(target));
      this.targets.set(target, batch);
      this.root.add(batch.group);
    }
    return batch;
  }

  private clearTarget(target: SegmentBatchTarget) {
    this.resetUploads();
    this.getTarget(target).syncSplit(this.normalUploads, this.additiveUploads);
  }

  renderWaveGroup(
    target:
      | 'main-wave'
      | 'custom-wave'
      | 'blend-main-wave'
      | 'blend-custom-wave',
    _group: Group,
    waves: MilkdropWaveVisual[],
    alphaMultiplier: number,
  ) {
    if (
      this.options.fallbackCustomWaves &&
      (target === 'custom-wave' || target === 'blend-custom-wave')
    ) {
      return false;
    }
    if (waves.some((wave) => wave.drawMode === 'dots')) {
      this.clearTarget(target);
      return false;
    }
    this.resetUploads();
    for (const wave of waves) {
      const destination = wave.additive
        ? this.additiveUploads
        : this.normalUploads;
      destination.appendPolyline(
        wave.positions,
        wave.color,
        wave.alpha * alphaMultiplier,
        getMilkdropSegmentWidth(wave.thickness),
        wave.closed,
      );
    }
    this.getTarget(target).syncSplit(this.normalUploads, this.additiveUploads);
    return true;
  }

  renderLineVisualGroup(
    target: 'trails' | 'motion-vectors' | 'blend-motion-vectors',
    _group: Group,
    lines: Array<{
      positions: ArrayLike<number>;
      color: MilkdropColor;
      alpha: number;
      additive?: boolean;
    }>,
    alphaMultiplier: number,
  ) {
    this.resetUploads();
    for (const line of lines) {
      ((line.additive ?? false)
        ? this.additiveUploads
        : this.normalUploads
      ).appendPolyline(
        line.positions,
        line.color,
        line.alpha * alphaMultiplier,
        getMilkdropSegmentWidth(1),
      );
    }
    this.getTarget(target).syncSplit(this.normalUploads, this.additiveUploads);
    return true;
  }

  dispose() {
    for (const batch of this.targets.values()) {
      batch.dispose();
    }
    this.targets.clear();
  }
}

export function createMilkdropSegmentBatchingLayer(
  options: MilkdropSegmentBatchingOptions = {},
) {
  return new SegmentBatchingLayer(options);
}
