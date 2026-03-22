import type { BufferGeometry, Group, LineSegments, Material } from 'three';
import { type LineBasicMaterial, ShaderMaterial } from 'three';
import type {
  MilkdropGpuFieldProgramDescriptor,
  MilkdropGpuInteractionTransform,
  MilkdropProceduralFieldTransformVisual,
  MilkdropProceduralMotionVectorFieldVisual,
  MilkdropRenderPayload,
} from '../types';

type ProceduralFieldUniformInput = MilkdropProceduralFieldTransformVisual & {
  signals: MilkdropProceduralMotionVectorFieldVisual['signals'];
  time: number;
  trebleAtt: number;
  tint: { r: number; g: number; b: number };
  alpha: number;
};

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
  disposeMaterial,
  createProceduralMotionVectorMaterial,
  getProceduralMotionVectorGeometry,
  syncProceduralFieldUniforms,
  syncProceduralInteractionUniforms,
  syncPreviousProceduralFieldUniforms,
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
  disposeMaterial: (material: Material | Material[] | null | undefined) => void;
  createProceduralMotionVectorMaterial: (
    program?: MilkdropGpuFieldProgramDescriptor | null,
  ) => ShaderMaterial;
  getProceduralMotionVectorGeometry: (
    countX: number,
    countY: number,
  ) => BufferGeometry;
  syncProceduralFieldUniforms: (
    material: ShaderMaterial,
    field: ProceduralFieldUniformInput,
  ) => void;
  syncProceduralInteractionUniforms: (
    material: ShaderMaterial,
    interaction: MilkdropGpuInteractionTransform | null | undefined,
  ) => void;
  syncPreviousProceduralFieldUniforms: (
    material: ShaderMaterial,
    field: MilkdropProceduralMotionVectorFieldVisual,
  ) => void;
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
      disposeMaterial(proceduralObject.material);
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
    });
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
