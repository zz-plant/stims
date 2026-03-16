import type { Scene } from 'three';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { disposeGeometry, disposeMaterial } from '../utils/three-dispose';
import type {
  MilkdropCompiledPreset,
  MilkdropPolyline,
  MilkdropRendererAdapter,
  MilkdropRenderPayload,
  MilkdropShapeVisual,
} from './types';

const MAX_VISIBLE_TRAILS = 8;

function setMaterialColor(
  material: LineBasicMaterial | MeshBasicMaterial,
  value: { r: number; g: number; b: number },
  opacity: number,
) {
  material.color = new Color(value.r, value.g, value.b);
  material.opacity = opacity;
  material.transparent = opacity < 1;
}

function ensureLineGeometryPositions(
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

class ThreeMilkdropAdapter implements MilkdropRendererAdapter {
  readonly backend: 'webgl' | 'webgpu';
  private readonly scene: Scene;
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
  private readonly meshLines = new LineSegments(
    new BufferGeometry(),
    new LineBasicMaterial({
      color: 0x4d66f2,
      transparent: true,
      opacity: 0.24,
    }),
  );
  private readonly waveform = new Line(
    new BufferGeometry(),
    new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
  private readonly trailLines = Array.from(
    { length: MAX_VISIBLE_TRAILS },
    () =>
      new Line(
        new BufferGeometry(),
        new LineBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0,
        }),
      ),
  );
  private readonly shapesGroup = new Group();
  private readonly blendShapesGroup = new Group();
  private readonly blendWave = new Line(
    new BufferGeometry(),
    new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
  );
  constructor(scene: Scene, backend: 'webgl' | 'webgpu') {
    this.scene = scene;
    this.backend = backend;
    this.background.position.z = -1.2;
    this.meshLines.position.z = -0.3;
    this.root.add(this.background);
    this.root.add(this.meshLines);
    this.root.add(this.waveform);
    this.root.add(this.blendWave);
    this.trailLines.forEach((line) => this.root.add(line));
    this.root.add(this.shapesGroup);
    this.root.add(this.blendShapesGroup);
  }

  attach() {
    if (!this.scene.children.includes(this.root)) {
      this.scene.add(this.root);
    }
  }

  setPreset(_preset: MilkdropCompiledPreset) {}

  resize(_width: number, _height: number) {
    this.background.scale.setScalar(1);
  }

  private renderPolyline(
    target: Line,
    polyline: MilkdropPolyline | null,
    alphaMultiplier = 1,
  ) {
    const geometry = target.geometry;
    const material = target.material as LineBasicMaterial;

    if (!polyline || polyline.positions.length === 0) {
      ensureLineGeometryPositions(geometry, []);
      material.opacity = 0;
      return;
    }

    ensureLineGeometryPositions(geometry, closePolylinePositions(polyline));
    setMaterialColor(
      material,
      polyline.color,
      polyline.alpha * alphaMultiplier,
    );
  }

  private clearShapeGroup(group: Group) {
    group.children.slice().forEach((child) => {
      group.remove(child);
      if (child instanceof Mesh) {
        disposeGeometry(child.geometry);
        disposeMaterial(child.material);
      } else if (child instanceof Line) {
        disposeGeometry(child.geometry);
        disposeMaterial(child.material);
      }
    });
  }

  private renderShapes(
    group: Group,
    shapes: MilkdropShapeVisual[],
    alphaMultiplier = 1,
  ) {
    this.clearShapeGroup(group);

    shapes.forEach((shape) => {
      const fill = new Mesh(
        new CircleGeometry(1, shape.sides),
        new MeshBasicMaterial({
          color: new Color(shape.color.r, shape.color.g, shape.color.b),
          opacity: (shape.color.a ?? 0.4) * alphaMultiplier,
          transparent: true,
          side: DoubleSide,
          blending: shape.additive ? AdditiveBlending : undefined,
        }),
      );
      fill.position.set(shape.x, shape.y, 0.15);
      fill.scale.setScalar(shape.radius);
      fill.rotation.z = shape.rotation;
      group.add(fill);

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
          blending: shape.additive ? AdditiveBlending : undefined,
        }),
      );
      const positions: number[] = [];
      for (let index = 0; index <= shape.sides; index += 1) {
        const theta =
          (index / shape.sides) * Math.PI * 2 +
          shape.rotation +
          Math.PI / Math.max(3, shape.sides);
        positions.push(Math.cos(theta), Math.sin(theta), 0.18);
      }
      ensureLineGeometryPositions(border.geometry, positions);
      border.position.set(shape.x, shape.y, 0.18);
      border.scale.setScalar(shape.radius);
      group.add(border);
    });
  }

  render(payload: MilkdropRenderPayload) {
    const backgroundMaterial = this.background.material as MeshBasicMaterial;
    setMaterialColor(backgroundMaterial, payload.frameState.background, 1);

    const meshMaterial = this.meshLines.material as LineBasicMaterial;
    ensureLineGeometryPositions(
      this.meshLines.geometry,
      payload.frameState.mesh.positions,
    );
    setMaterialColor(
      meshMaterial,
      payload.frameState.mesh.color,
      payload.frameState.mesh.alpha,
    );

    this.renderPolyline(this.waveform, payload.frameState.waveform);
    this.trailLines.forEach((line, index) => {
      const trail = payload.frameState.trails[index] ?? null;
      this.renderPolyline(line, trail, trail ? 1 : 0);
    });
    this.renderShapes(this.shapesGroup, payload.frameState.shapes);

    this.renderPolyline(
      this.blendWave,
      payload.blendState?.waveform ?? null,
      payload.blendState?.alpha ?? 0,
    );
    this.renderShapes(
      this.blendShapesGroup,
      payload.blendState?.shapes ?? [],
      payload.blendState?.alpha ?? 0,
    );
  }

  dispose() {
    this.clearShapeGroup(this.shapesGroup);
    this.clearShapeGroup(this.blendShapesGroup);
    disposeGeometry(this.background.geometry);
    disposeMaterial(this.background.material);
    disposeGeometry(this.meshLines.geometry);
    disposeMaterial(this.meshLines.material);
    disposeGeometry(this.waveform.geometry);
    disposeMaterial(this.waveform.material);
    disposeGeometry(this.blendWave.geometry);
    disposeMaterial(this.blendWave.material);
    this.trailLines.forEach((line) => {
      disposeGeometry(line.geometry);
      disposeMaterial(line.material);
    });
    this.scene.remove(this.root);
  }
}

export function createMilkdropRendererAdapter({
  scene,
  backend,
}: {
  scene: Scene;
  backend: 'webgl' | 'webgpu';
}) {
  return new ThreeMilkdropAdapter(scene, backend);
}
