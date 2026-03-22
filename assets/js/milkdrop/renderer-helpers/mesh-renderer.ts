import type { Line, Material } from 'three';
import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { createProceduralMeshMaterial } from '../renderer-backends/webgpu-procedural-materials';
import type {
  MilkdropGpuGeometryHints,
  MilkdropGpuInteractionTransform,
  MilkdropRenderPayload,
  MilkdropWebGpuDescriptorPlan,
} from '../types';
import {
  syncProceduralFieldUniforms,
  syncProceduralInteractionUniforms,
} from './procedural-field-uniforms';

const SHARED_GEOMETRY_FLAG = 'milkdropSharedGeometry';
const PROCEDURAL_MESH_BOUNDS_RADIUS = Math.SQRT2 * 2;
const proceduralMeshGeometryCache = new Map<number, BufferGeometry>();

function markSharedGeometry<T extends BufferGeometry>(geometry: T) {
  geometry.userData[SHARED_GEOMETRY_FLAG] = true;
  return geometry;
}

function setGeometryBoundingSphere(
  geometry: BufferGeometry,
  center: Vector3,
  radius: number,
) {
  if (!geometry.boundingSphere) {
    geometry.boundingSphere = new Sphere(center.clone(), radius);
    return geometry.boundingSphere;
  }
  geometry.boundingSphere.center.copy(center);
  geometry.boundingSphere.radius = radius;
  return geometry.boundingSphere;
}

function getProceduralMeshGeometry(density: number) {
  const safeDensity = Math.max(2, Math.round(density));
  const cached = proceduralMeshGeometryCache.get(safeDensity);
  if (cached) {
    return cached;
  }

  const sourcePositions: number[] = [];
  for (let row = 0; row < safeDensity; row += 1) {
    for (let col = 0; col < safeDensity; col += 1) {
      const x = (col / Math.max(1, safeDensity - 1)) * 2 - 1;
      const y = (row / Math.max(1, safeDensity - 1)) * 2 - 1;

      if (col + 1 < safeDensity) {
        const nextX = ((col + 1) / Math.max(1, safeDensity - 1)) * 2 - 1;
        sourcePositions.push(x, y, -0.25, nextX, y, -0.25);
      }

      if (row + 1 < safeDensity) {
        const nextY = ((row + 1) / Math.max(1, safeDensity - 1)) * 2 - 1;
        sourcePositions.push(x, y, -0.25, x, nextY, -0.25);
      }
    }
  }

  const geometry = markSharedGeometry(new BufferGeometry());
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(sourcePositions, 3),
  );
  geometry.setAttribute(
    'sourcePosition',
    new Float32BufferAttribute(sourcePositions, 3),
  );
  setGeometryBoundingSphere(
    geometry,
    new Vector3(0, 0, 0),
    PROCEDURAL_MESH_BOUNDS_RADIUS,
  );
  proceduralMeshGeometryCache.set(safeDensity, geometry);
  return geometry;
}

export function renderMesh({
  backend,
  meshLines,
  mesh,
  gpuGeometry,
  signals,
  webgpuDescriptorPlan,
  interaction,
  disposeMaterial,
  ensureGeometryPositions,
  setMaterialColor,
}: {
  backend: 'webgl' | 'webgpu';
  meshLines: Line<BufferGeometry, Material>;
  mesh: MilkdropRenderPayload['frameState']['mesh'];
  gpuGeometry: MilkdropGpuGeometryHints;
  signals: MilkdropRenderPayload['frameState']['signals'];
  webgpuDescriptorPlan: MilkdropWebGpuDescriptorPlan | null;
  interaction?: MilkdropGpuInteractionTransform | null;
  disposeMaterial: (material: Material | Material[] | null | undefined) => void;
  ensureGeometryPositions: (
    geometry: BufferGeometry,
    positions: number[],
  ) => void;
  setMaterialColor: (
    material: LineBasicMaterial,
    color: MilkdropRenderPayload['frameState']['mesh']['color'],
    alpha: number,
  ) => void;
}) {
  const proceduralMesh =
    backend === 'webgpu' && webgpuDescriptorPlan?.proceduralMesh !== null
      ? gpuGeometry.meshField
      : null;
  if (proceduralMesh) {
    const fieldProgramSignature =
      proceduralMesh.program?.signature ?? 'default';
    if (
      !(meshLines.material instanceof ShaderMaterial) ||
      meshLines.material.userData.fieldProgramSignature !==
        fieldProgramSignature
    ) {
      disposeMaterial(meshLines.material);
      meshLines.material = createProceduralMeshMaterial(proceduralMesh.program);
    }
    meshLines.geometry = getProceduralMeshGeometry(proceduralMesh.density);
    syncProceduralFieldUniforms(meshLines.material as ShaderMaterial, {
      ...proceduralMesh,
      time: signals.time,
      trebleAtt: signals.trebleAtt,
      tint: mesh.color,
      alpha: mesh.alpha,
    });
    syncProceduralInteractionUniforms(
      meshLines.material as ShaderMaterial,
      interaction,
    );
    meshLines.visible = mesh.alpha > 0.001;
    return;
  }

  if (!(meshLines.material instanceof LineBasicMaterial)) {
    disposeMaterial(meshLines.material);
    meshLines.material = new LineBasicMaterial({
      color: 0x4d66f2,
      transparent: true,
      opacity: 0.24,
    });
  }

  const meshMaterial = meshLines.material as LineBasicMaterial;
  ensureGeometryPositions(meshLines.geometry, mesh.positions);
  setMaterialColor(meshMaterial, mesh.color, mesh.alpha);
  meshLines.visible = mesh.positions.length > 0;
}
