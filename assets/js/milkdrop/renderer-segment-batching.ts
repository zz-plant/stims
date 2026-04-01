import type { Group, Mesh } from 'three';
import {
  AdditiveBlending,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  NormalBlending,
  ShaderMaterial,
  Group as ThreeGroup,
  Mesh as ThreeMesh,
} from 'three';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import {
  getMilkdropLayerRenderOrder,
  type MilkdropRendererBatcher,
} from './renderer-adapter-shared';
import type { MilkdropColor, MilkdropWaveVisual } from './types';

type SegmentBatchTarget =
  | 'main-wave'
  | 'custom-wave'
  | 'blend-main-wave'
  | 'blend-custom-wave'
  | 'trails'
  | 'motion-vectors'
  | 'blend-motion-vectors';

const SEGMENT_QUAD_GEOMETRY = createSegmentQuadGeometry();

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

class CompactSegmentUploadBuffer {
  private lineData: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private styleData: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private controlData: Float32Array<ArrayBufferLike> = new Float32Array(0);
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
    this.count += 1;
  }

  appendPolyline(
    positions: number[],
    color: MilkdropColor,
    alpha: number,
    width: number,
    closeLoop = false,
  ) {
    for (let index = 0; index + 5 < positions.length; index += 3) {
      this.appendSegment(
        positions[index] ?? 0,
        positions[index + 1] ?? 0,
        positions[index + 2] ?? 0.24,
        positions[index + 3] ?? 0,
        positions[index + 4] ?? 0,
        positions[index + 5] ?? 0.24,
        color,
        alpha,
        width,
      );
    }
    if (!closeLoop || positions.length < 6) {
      return;
    }
    const lastPointIndex = positions.length - 3;
    this.appendSegment(
      positions[lastPointIndex] ?? 0,
      positions[lastPointIndex + 1] ?? 0,
      positions[lastPointIndex + 2] ?? 0.24,
      positions[0] ?? 0,
      positions[1] ?? 0,
      positions[2] ?? 0.24,
      color,
      alpha,
      width,
    );
  }

  private ensureCapacity(count: number) {
    this.lineData = ensureFloat32Capacity(this.lineData, count * 4);
    this.styleData = ensureFloat32Capacity(this.styleData, count * 4);
    this.controlData = ensureFloat32Capacity(this.controlData, count * 3);
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
        blending,
        vertexShader: `
          attribute vec2 segmentCoord;
          attribute vec4 instanceLine;
          attribute vec4 instanceColorAlpha;
          attribute vec3 instanceControl;
          varying vec4 vColor;

          void main() {
            vec2 delta = instanceLine.zw;
            float lengthDelta = length(delta);
            vec2 direction = lengthDelta > 0.000001 ? delta / lengthDelta : vec2(1.0, 0.0);
            vec2 normal = vec2(-direction.y, direction.x);
            vec2 base = instanceLine.xy + delta * segmentCoord.x;
            vec2 point = base + normal * segmentCoord.y * instanceControl.z;
            float z = mix(instanceControl.x, instanceControl.y, segmentCoord.x);
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
    (line.array as Float32Array).set(instances.getLineData());
    (colorAlpha.array as Float32Array).set(instances.getStyleData());
    (control.array as Float32Array).set(instances.getControlData());
    line.needsUpdate = true;
    colorAlpha.needsUpdate = true;
    control.needsUpdate = true;
  }

  dispose() {
    [this.normalMesh, this.additiveMesh].forEach((mesh) => {
      disposeGeometry(mesh.geometry);
      disposeMaterial(mesh.material);
    });
  }
}

class SegmentBatchingLayer implements MilkdropRendererBatcher {
  private readonly root = new ThreeGroup();
  private readonly targets = new Map<
    SegmentBatchTarget,
    InstancedSegmentBatch
  >();
  private readonly normalUploads = new CompactSegmentUploadBuffer();
  private readonly additiveUploads = new CompactSegmentUploadBuffer();

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
        0.0025 * Math.max(1, wave.thickness),
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
      positions: number[];
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
        0.0025,
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

export function createMilkdropSegmentBatchingLayer() {
  return new SegmentBatchingLayer();
}
