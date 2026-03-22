import type { Group, LineSegments } from 'three';
import {
  BufferGeometry,
  Float32BufferAttribute,
  type LineBasicMaterial,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { createProceduralMotionVectorMaterial } from '../renderer-backends/webgpu-procedural-materials';
import type { MilkdropRenderPayload } from '../types';
import type { ProceduralFieldVisualWithSignals } from './procedural-field-uniforms';
import {
  syncPreviousProceduralFieldUniforms,
  syncProceduralFieldUniforms,
  syncProceduralInteractionUniforms,
} from './procedural-field-uniforms';

const SHARED_GEOMETRY_FLAG = 'milkdropSharedGeometry';
const PROCEDURAL_MOTION_VECTOR_BOUNDS_RADIUS = Math.SQRT2 * 2.35;
const proceduralMotionVectorGeometryCache = new Map<string, BufferGeometry>();

type ProceduralFieldUniformInput = ProceduralFieldVisualWithSignals & {
  time: number;
  trebleAtt: number;
  tint: { r: number; g: number; b: number };
  alpha: number;
};

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

export function getProceduralMotionVectorGeometry(
  countX: number,
  countY: number,
) {
  const safeCountX = Math.max(1, Math.round(countX));
  const safeCountY = Math.max(1, Math.round(countY));
  const cacheKey = `${safeCountX}x${safeCountY}`;
  const cached = proceduralMotionVectorGeometryCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const sourcePositions: number[] = [];
  const endpointWeights: number[] = [];
  for (let row = 0; row < safeCountY; row += 1) {
    for (let col = 0; col < safeCountX; col += 1) {
      const sourceX = safeCountX === 1 ? 0 : (col / (safeCountX - 1)) * 2 - 1;
      const sourceY = safeCountY === 1 ? 0 : (row / (safeCountY - 1)) * 2 - 1;
      sourcePositions.push(sourceX, sourceY, 0.18, sourceX, sourceY, 0.18);
      endpointWeights.push(0, 1);
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
  geometry.setAttribute(
    'endpointWeight',
    new Float32BufferAttribute(endpointWeights, 1),
  );
  setGeometryBoundingSphere(
    geometry,
    new Vector3(0, 0, 0),
    PROCEDURAL_MOTION_VECTOR_BOUNDS_RADIUS,
  );
  proceduralMotionVectorGeometryCache.set(cacheKey, geometry);
  return geometry;
}

export function renderMotionVectors({
  backend,
  webgpuDescriptorPlanProceduralMotionVectors,
  payload,
  alphaMultiplier = 1,
  previousFrame,
  blendMix = 1,
  cpuGroup,
  proceduralObject,
  clearGroup,
  renderLineVisualGroup,
}: {
  backend: 'webgl' | 'webgpu';
  webgpuDescriptorPlanProceduralMotionVectors: unknown;
  payload: MilkdropRenderPayload['frameState'];
  alphaMultiplier?: number;
  previousFrame?: MilkdropRenderPayload['frameState'] | null;
  blendMix?: number;
  cpuGroup: Group;
  proceduralObject: LineSegments<
    BufferGeometry,
    LineBasicMaterial | ShaderMaterial
  >;
  clearGroup: (group: Group) => void;
  renderLineVisualGroup: (
    target: 'trails' | 'motion-vectors' | 'blend-motion-vectors',
    group: Group,
    lines: MilkdropRenderPayload['frameState']['motionVectors'],
    alphaMultiplier?: number,
  ) => void;
}) {
  const proceduralField =
    backend === 'webgpu' && webgpuDescriptorPlanProceduralMotionVectors !== null
      ? payload.gpuGeometry.motionVectorField
      : null;
  if (proceduralField) {
    clearGroup(cpuGroup);
    proceduralObject.visible = true;
    const fieldProgramSignature =
      proceduralField.program?.signature ?? 'default';
    if (
      !(proceduralObject.material instanceof ShaderMaterial) ||
      proceduralObject.material.userData.fieldProgramSignature !==
        fieldProgramSignature
    ) {
      proceduralObject.material.dispose();
      proceduralObject.material = createProceduralMotionVectorMaterial(
        proceduralField.program,
      );
    }
    proceduralObject.geometry = getProceduralMotionVectorGeometry(
      proceduralField.countX,
      proceduralField.countY,
    );
    syncProceduralFieldUniforms(proceduralObject.material as ShaderMaterial, {
      ...proceduralField,
      time: payload.signals.time,
      trebleAtt: payload.signals.trebleAtt,
      tint: {
        r: Math.min(Math.max(payload.variables.mv_r ?? 1, 0), 1),
        g: Math.min(Math.max(payload.variables.mv_g ?? 1, 0), 1),
        b: Math.min(Math.max(payload.variables.mv_b ?? 1, 0), 1),
      },
      alpha:
        Math.min(
          Math.max(
            payload.variables.mv_a ?? 0.35,
            proceduralField.legacyControls ? 0 : 0.02,
          ),
          1,
        ) * alphaMultiplier,
    } satisfies ProceduralFieldUniformInput);
    const proceduralMaterial = proceduralObject.material as ShaderMaterial;
    syncProceduralInteractionUniforms(
      proceduralMaterial,
      payload.interaction?.motionVectors,
    );
    proceduralMaterial.uniforms.sourceOffsetX.value =
      proceduralField.sourceOffsetX;
    proceduralMaterial.uniforms.sourceOffsetY.value =
      proceduralField.sourceOffsetY;
    proceduralMaterial.uniforms.explicitLength.value =
      proceduralField.explicitLength;
    proceduralMaterial.uniforms.legacyControls.value =
      proceduralField.legacyControls ? 1 : 0;
    const previousField =
      previousFrame?.gpuGeometry.motionVectorField ?? proceduralField;
    syncPreviousProceduralFieldUniforms(proceduralMaterial, previousField);
    proceduralMaterial.uniforms.previousSourceOffsetX.value =
      previousField.sourceOffsetX;
    proceduralMaterial.uniforms.previousSourceOffsetY.value =
      previousField.sourceOffsetY;
    proceduralMaterial.uniforms.previousExplicitLength.value =
      previousField.explicitLength;
    proceduralMaterial.uniforms.blendMix.value = blendMix;
    return;
  }

  proceduralObject.visible = false;
  renderLineVisualGroup(
    'motion-vectors',
    cpuGroup,
    payload.motionVectors,
    alphaMultiplier,
  );
}
