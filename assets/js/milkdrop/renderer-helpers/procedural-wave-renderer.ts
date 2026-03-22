import {
  AdditiveBlending,
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Line,
  NormalBlending,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';
import { disposeGeometry, disposeMaterial } from '../../utils/three-dispose';
import {
  createProceduralCustomWaveMaterial,
  createProceduralWaveMaterial,
} from '../renderer-backends/webgpu-procedural-materials';
import type {
  MilkdropGpuInteractionTransform,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralWaveVisual,
} from '../types';
import { syncProceduralInteractionUniforms } from './procedural-field-uniforms';

const SHARED_GEOMETRY_FLAG = 'milkdropSharedGeometry';
const PROCEDURAL_WAVE_BOUNDS_RADIUS = Math.SQRT2 * 2.2;
const proceduralWaveGeometryCache = new Map<number, BufferGeometry>();

function markSharedGeometry<T extends BufferGeometry>(geometry: T) {
  geometry.userData[SHARED_GEOMETRY_FLAG] = true;
  return geometry;
}

function isSharedGeometry(geometry: BufferGeometry) {
  return geometry.userData[SHARED_GEOMETRY_FLAG] === true;
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

function getProceduralWaveGeometry(sampleCount: number) {
  const safeCount = Math.max(2, Math.round(sampleCount));
  const cached = proceduralWaveGeometryCache.get(safeCount);
  if (cached) {
    return cached;
  }

  const positions = new Array(safeCount * 3).fill(0);
  const sampleT = Array.from(
    { length: safeCount },
    (_, index) => index / Math.max(1, safeCount - 1),
  );

  const geometry = markSharedGeometry(new BufferGeometry());
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('sampleT', new Float32BufferAttribute(sampleT, 1));
  setGeometryBoundingSphere(
    geometry,
    new Vector3(0, 0, 0),
    PROCEDURAL_WAVE_BOUNDS_RADIUS,
  );
  proceduralWaveGeometryCache.set(safeCount, geometry);
  return geometry;
}

function createProceduralWaveObjectGeometry(sampleCount: number) {
  const geometry = getProceduralWaveGeometry(sampleCount).clone();
  setGeometryBoundingSphere(
    geometry,
    new Vector3(0, 0, 0),
    PROCEDURAL_WAVE_BOUNDS_RADIUS,
  );
  return geometry;
}

function setOrUpdateScalarAttribute(
  geometry: BufferGeometry,
  name: string,
  values: number[],
) {
  const existing = geometry.getAttribute(name);
  if (
    existing instanceof Float32BufferAttribute &&
    existing.itemSize === 1 &&
    existing.array.length === values.length
  ) {
    existing.array.set(values);
    existing.needsUpdate = true;
    return;
  }
  const attribute = new Float32BufferAttribute(values, 1);
  attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
}

function lerpNumber(previous: number, current: number, mix: number) {
  return previous + (current - previous) * mix;
}

function resampleScalarValues(values: number[], targetLength: number) {
  if (values.length === targetLength) {
    return values;
  }
  if (targetLength <= 0) {
    return [];
  }
  if (values.length === 0) {
    return new Array<number>(targetLength).fill(0);
  }
  if (values.length === 1) {
    return new Array<number>(targetLength).fill(values[0] ?? 0);
  }

  const resampled = new Array<number>(targetLength);
  const sourceMaxIndex = values.length - 1;
  const targetMaxIndex = Math.max(1, targetLength - 1);
  for (let index = 0; index < targetLength; index += 1) {
    const position = (index / targetMaxIndex) * sourceMaxIndex;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.min(sourceMaxIndex, lowerIndex + 1);
    const mix = position - lowerIndex;
    const lowerValue = values[lowerIndex] ?? 0;
    const upperValue = values[upperIndex] ?? lowerValue;
    resampled[index] = lerpNumber(lowerValue, upperValue, mix);
  }
  return resampled;
}

export function syncProceduralWaveObject(
  object: Line | undefined,
  wave: MilkdropProceduralWaveVisual,
  interaction?: MilkdropGpuInteractionTransform | null,
) {
  const next =
    object ??
    new Line(
      createProceduralWaveObjectGeometry(wave.samples.length),
      createProceduralWaveMaterial(),
    );
  if (!(next.material instanceof ShaderMaterial)) {
    disposeMaterial(next.material);
    next.material = createProceduralWaveMaterial();
  }

  const sampleTAttribute = next.geometry.getAttribute('sampleT');
  if (
    !(
      sampleTAttribute instanceof Float32BufferAttribute &&
      sampleTAttribute.array.length === wave.samples.length
    )
  ) {
    if (!isSharedGeometry(next.geometry)) {
      disposeGeometry(next.geometry);
    }
    next.geometry = createProceduralWaveObjectGeometry(wave.samples.length);
  }

  setOrUpdateScalarAttribute(next.geometry, 'sampleValue', wave.samples);
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue',
    wave.samples,
  );
  setOrUpdateScalarAttribute(next.geometry, 'sampleVelocity', wave.velocities);
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleVelocity',
    wave.velocities,
  );

  const material = next.material as ShaderMaterial;
  material.uniforms.mode.value = wave.mode;
  material.uniforms.centerX.value = wave.centerX;
  material.uniforms.centerY.value = wave.centerY;
  material.uniforms.scale.value = wave.scale;
  material.uniforms.mystery.value = wave.mystery;
  material.uniforms.signalTime.value = wave.time;
  material.uniforms.beatPulse.value = wave.beatPulse;
  material.uniforms.trebleAtt.value = wave.trebleAtt;
  material.uniforms.previousCenterX.value = wave.centerX;
  material.uniforms.previousCenterY.value = wave.centerY;
  material.uniforms.previousScale.value = wave.scale;
  material.uniforms.previousMystery.value = wave.mystery;
  material.uniforms.previousSignalTime.value = wave.time;
  material.uniforms.previousBeatPulse.value = wave.beatPulse;
  material.uniforms.previousTrebleAtt.value = wave.trebleAtt;
  material.uniforms.blendMix.value = 1;
  material.uniforms.tint.value.setRGB(wave.color.r, wave.color.g, wave.color.b);
  material.uniforms.alpha.value = wave.alpha;
  syncProceduralInteractionUniforms(material, interaction);
  material.blending = wave.additive ? AdditiveBlending : NormalBlending;
  return next;
}

export function syncProceduralCustomWaveObject(
  object: Line | undefined,
  wave: MilkdropProceduralCustomWaveVisual,
  interaction?: MilkdropGpuInteractionTransform | null,
) {
  const next =
    object ??
    new Line(
      createProceduralWaveObjectGeometry(wave.samples.length),
      createProceduralCustomWaveMaterial(),
    );
  if (!(next.material instanceof ShaderMaterial)) {
    disposeMaterial(next.material);
    next.material = createProceduralCustomWaveMaterial();
  }

  const sampleTAttribute = next.geometry.getAttribute('sampleT');
  if (
    !(
      sampleTAttribute instanceof Float32BufferAttribute &&
      sampleTAttribute.array.length === wave.samples.length
    )
  ) {
    if (!isSharedGeometry(next.geometry)) {
      disposeGeometry(next.geometry);
    }
    next.geometry = createProceduralWaveObjectGeometry(wave.samples.length);
  }

  setOrUpdateScalarAttribute(next.geometry, 'sampleValue', wave.samples);
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue',
    wave.samples,
  );

  const material = next.material as ShaderMaterial;
  material.uniforms.centerX.value = wave.centerX;
  material.uniforms.centerY.value = wave.centerY;
  material.uniforms.scaling.value = wave.scaling;
  material.uniforms.mystery.value = wave.mystery;
  material.uniforms.signalTime.value = wave.time;
  material.uniforms.spectrum.value = wave.spectrum ? 1 : 0;
  material.uniforms.previousCenterX.value = wave.centerX;
  material.uniforms.previousCenterY.value = wave.centerY;
  material.uniforms.previousScaling.value = wave.scaling;
  material.uniforms.previousMystery.value = wave.mystery;
  material.uniforms.previousSignalTime.value = wave.time;
  material.uniforms.previousSpectrum.value = wave.spectrum ? 1 : 0;
  material.uniforms.blendMix.value = 1;
  material.uniforms.tint.value.setRGB(wave.color.r, wave.color.g, wave.color.b);
  material.uniforms.alpha.value = wave.alpha;
  syncProceduralInteractionUniforms(material, interaction);
  material.blending = wave.additive ? AdditiveBlending : NormalBlending;
  return next;
}

export function syncInterpolatedProceduralWaveObject(
  object: Line | undefined,
  previousWave: MilkdropProceduralWaveVisual,
  currentWave: MilkdropProceduralWaveVisual,
  mix: number,
  alphaMultiplier: number,
  interaction: MilkdropGpuInteractionTransform | null | undefined,
) {
  const next = syncProceduralWaveObject(object, currentWave, interaction);
  setOrUpdateScalarAttribute(next.geometry, 'sampleValue', currentWave.samples);
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue',
    resampleScalarValues(previousWave.samples, currentWave.samples.length),
  );
  setOrUpdateScalarAttribute(
    next.geometry,
    'sampleVelocity',
    currentWave.velocities,
  );
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleVelocity',
    resampleScalarValues(
      previousWave.velocities,
      currentWave.velocities.length,
    ),
  );
  const material = next.material as ShaderMaterial;
  material.uniforms.previousCenterX.value = previousWave.centerX;
  material.uniforms.previousCenterY.value = previousWave.centerY;
  material.uniforms.previousScale.value = previousWave.scale;
  material.uniforms.previousMystery.value = previousWave.mystery;
  material.uniforms.previousSignalTime.value = previousWave.time;
  material.uniforms.previousBeatPulse.value = previousWave.beatPulse;
  material.uniforms.previousTrebleAtt.value = previousWave.trebleAtt;
  material.uniforms.blendMix.value = mix;
  material.uniforms.tint.value.setRGB(
    lerpNumber(previousWave.color.r, currentWave.color.r, mix),
    lerpNumber(previousWave.color.g, currentWave.color.g, mix),
    lerpNumber(previousWave.color.b, currentWave.color.b, mix),
  );
  material.uniforms.alpha.value =
    lerpNumber(previousWave.alpha, currentWave.alpha, mix) * alphaMultiplier;
  material.blending =
    previousWave.additive || currentWave.additive
      ? AdditiveBlending
      : NormalBlending;
  syncProceduralInteractionUniforms(material, interaction);
  return next;
}

export function syncInterpolatedProceduralCustomWaveObject(
  object: Line | undefined,
  previousWave: MilkdropProceduralCustomWaveVisual,
  currentWave: MilkdropProceduralCustomWaveVisual,
  mix: number,
  alphaMultiplier: number,
  interaction: MilkdropGpuInteractionTransform | null | undefined,
) {
  const next = syncProceduralCustomWaveObject(object, currentWave, interaction);
  setOrUpdateScalarAttribute(next.geometry, 'sampleValue', currentWave.samples);
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue',
    resampleScalarValues(previousWave.samples, currentWave.samples.length),
  );
  const material = next.material as ShaderMaterial;
  material.uniforms.previousCenterX.value = previousWave.centerX;
  material.uniforms.previousCenterY.value = previousWave.centerY;
  material.uniforms.previousScaling.value = previousWave.scaling;
  material.uniforms.previousMystery.value = previousWave.mystery;
  material.uniforms.previousSignalTime.value = previousWave.time;
  material.uniforms.previousSpectrum.value = previousWave.spectrum ? 1 : 0;
  material.uniforms.blendMix.value = mix;
  material.uniforms.tint.value.setRGB(
    lerpNumber(previousWave.color.r, currentWave.color.r, mix),
    lerpNumber(previousWave.color.g, currentWave.color.g, mix),
    lerpNumber(previousWave.color.b, currentWave.color.b, mix),
  );
  material.uniforms.alpha.value =
    lerpNumber(previousWave.alpha, currentWave.alpha, mix) * alphaMultiplier;
  material.blending =
    previousWave.additive || currentWave.additive
      ? AdditiveBlending
      : NormalBlending;
  syncProceduralInteractionUniforms(material, interaction);
  return next;
}
