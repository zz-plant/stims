import {
  AdditiveBlending,
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Line,
  NormalBlending,
  type ShaderMaterial,
  Vector3,
} from 'three';
import {
  disposeGeometry,
  disposeMaterial,
} from '../../utils/three/three-dispose';
import {
  isSharedGeometry,
  markSharedGeometry,
  setGeometryBoundingSphere,
} from '../renderer-adapter-shared';
import type {
  MilkdropGpuInteractionTransform,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralWaveVisual,
} from '../types';
import { syncProceduralInteractionUniforms } from './procedural-field-uniforms';
import {
  getWebGpuHelperMaterialsSync,
  isWebGpuNodeMaterial,
} from './webgpu-materials-loader';

const PROCEDURAL_WAVE_BOUNDS_RADIUS = Math.SQRT2 * 2.2;
const PROJECTM_STEREO_OFFSET = 32 / 512;
const proceduralWaveGeometryCache = new Map<number, BufferGeometry>();

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

export function clearProceduralWaveGeometryCache() {
  for (const geometry of proceduralWaveGeometryCache.values()) {
    disposeGeometry(geometry);
  }
  proceduralWaveGeometryCache.clear();
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

function getProceduralWaveRenderCount(wave: MilkdropProceduralWaveVisual) {
  return wave.samples.length + (wave.closed ? 1 : 0);
}

function buildProceduralWaveSampleT(
  sourceLength: number,
  closed: boolean,
): number[] {
  const renderCount = sourceLength + (closed ? 1 : 0);
  const values = new Array<number>(renderCount);
  const maxIndex = Math.max(1, sourceLength - 1);
  for (let index = 0; index < renderCount; index += 1) {
    values[index] = closed && index === sourceLength ? 0 : index / maxIndex;
  }
  return values;
}

function sampleScalarValueAt(values: ArrayLike<number>, t: number) {
  if (values.length === 0) {
    return 0;
  }
  if (values.length === 1) {
    return values[0] ?? 0;
  }
  const clampedT = Math.min(Math.max(t, 0), 1);
  const scaledIndex = clampedT * (values.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(values.length - 1, lowerIndex + 1);
  const mix = scaledIndex - lowerIndex;
  return lerpNumber(values[lowerIndex] ?? 0, values[upperIndex] ?? 0, mix);
}

function buildProceduralWaveAttributeValues(
  values: ArrayLike<number>,
  closed: boolean,
  offset = 0,
) {
  const sampleT = buildProceduralWaveSampleT(values.length, closed);
  // MilkDrop wraps offset reads modulo the buffer (waveL[(i + 32) % len]),
  // so shifted lookups wrap instead of clamping onto the last sample.
  return sampleT.map((t) => {
    const shifted = t + offset;
    return sampleScalarValueAt(values, shifted - Math.floor(shifted));
  });
}

function buildProceduralWaveParity(sourceLength: number, closed: boolean) {
  const renderCount = sourceLength + (closed ? 1 : 0);
  const values = new Array<number>(renderCount);
  for (let index = 0; index < renderCount; index += 1) {
    values[index] = index % 2 === 0 ? 0 : 1;
  }
  if (closed && renderCount > 0) {
    values[renderCount - 1] = 0;
  }
  return values;
}

function setOrUpdateScalarAttribute(
  geometry: BufferGeometry,
  name: string,
  values: ArrayLike<number>,
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

// WebGPU's baseline maxVertexBuffers limit is 8, and the WebGPU procedural
// wave material (webgpu-procedural-materials.ts) needs 12 distinct scalar
// values per vertex. Each attribute() node claims its own vertex buffer, so
// the columns are interleaved into one vec-sized buffer instead of 12
// separate scalar buffers — matching the vec4/vec4/vec3 layout the WGSL
// shader unpacks by component.
function setOrUpdateVectorAttribute(
  geometry: BufferGeometry,
  name: string,
  columns: ArrayLike<number>[],
) {
  const itemSize = columns.length;
  const length = columns[0]?.length ?? 0;
  const requiredLength = length * itemSize;
  const existing = geometry.getAttribute(name);

  let targetArray: Float32Array;
  if (
    existing instanceof Float32BufferAttribute &&
    existing.itemSize === itemSize &&
    existing.array.length === requiredLength
  ) {
    targetArray = existing.array as Float32Array;
  } else {
    targetArray = new Float32Array(requiredLength);
  }

  for (let i = 0; i < length; i += 1) {
    for (let c = 0; c < itemSize; c += 1) {
      targetArray[i * itemSize + c] = columns[c]?.[i] ?? 0;
    }
  }

  if (
    existing instanceof Float32BufferAttribute &&
    existing.itemSize === itemSize &&
    existing.array.length === requiredLength
  ) {
    existing.needsUpdate = true;
    return;
  }
  const attribute = new Float32BufferAttribute(targetArray, itemSize);
  attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute(name, attribute);
}

function lerpNumber(previous: number, current: number, mix: number) {
  return previous + (current - previous) * mix;
}

function resampleScalarValues(values: ArrayLike<number>, targetLength: number) {
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

/**
 * Ensures a Line object with the correct geometry/material for a procedural
 * wave exists, creating or replacing either as needed. Does not touch
 * per-frame attribute data — call fillProceduralWaveAttributes for that.
 */
function ensureProceduralWaveObject(
  object: Line | undefined,
  wave: MilkdropProceduralWaveVisual,
) {
  const { createProceduralWaveMaterial } = getWebGpuHelperMaterialsSync();
  const next =
    object ??
    new Line(
      createProceduralWaveObjectGeometry(getProceduralWaveRenderCount(wave)),
      createProceduralWaveMaterial(),
    );
  if (!isWebGpuNodeMaterial(next.material)) {
    disposeMaterial(next.material);
    next.material = createProceduralWaveMaterial();
  }

  const renderCount = getProceduralWaveRenderCount(wave);
  const sampleTAttribute = next.geometry.getAttribute('sampleT');
  if (
    !(
      sampleTAttribute instanceof Float32BufferAttribute &&
      sampleTAttribute.array.length === renderCount
    )
  ) {
    if (!isSharedGeometry(next.geometry)) {
      disposeGeometry(next.geometry);
    }
    next.geometry = createProceduralWaveObjectGeometry(renderCount);
  }
  return next;
}

/**
 * Computes and uploads the per-frame sampleT/sampleData/sampleMisc
 * attributes for a procedural wave's current-frame data. Returns the
 * computed sampleData channels so callers that also need a
 * previous-frame snapshot (e.g. syncInterpolatedProceduralWaveObject)
 * can reuse them instead of recomputing identical values.
 */
function fillProceduralWaveAttributes(
  next: Line,
  wave: MilkdropProceduralWaveVisual,
) {
  setOrUpdateScalarAttribute(
    next.geometry,
    'sampleT',
    buildProceduralWaveSampleT(wave.samples.length, wave.closed),
  );
  const sampleDataChannels = [
    buildProceduralWaveAttributeValues(wave.samples, wave.closed),
    buildProceduralWaveAttributeValues(
      wave.samples,
      wave.closed,
      PROJECTM_STEREO_OFFSET,
    ),
    buildProceduralWaveAttributeValues(
      wave.samples,
      wave.closed,
      PROJECTM_STEREO_OFFSET * 2,
    ),
    buildProceduralWaveAttributeValues(
      wave.samples,
      wave.closed,
      PROJECTM_STEREO_OFFSET * 3,
    ),
  ];
  setOrUpdateVectorAttribute(next.geometry, 'sampleData', sampleDataChannels);
  const velocityChannel = buildProceduralWaveAttributeValues(
    wave.velocities,
    wave.closed,
  );
  setOrUpdateVectorAttribute(next.geometry, 'sampleMisc', [
    buildProceduralWaveParity(wave.samples.length, wave.closed),
    velocityChannel,
    velocityChannel,
  ]);
  return { sampleDataChannels, velocityChannel };
}

export function syncProceduralWaveObject(
  object: Line | undefined,
  wave: MilkdropProceduralWaveVisual,
  interaction?: MilkdropGpuInteractionTransform | null,
) {
  const next = ensureProceduralWaveObject(object, wave);
  const { sampleDataChannels } = fillProceduralWaveAttributes(next, wave);
  // "previous" is the same snapshot as "current" here — this sync path
  // always drives blendMix to 1 below, so mix(previous, current, 1) reduces
  // to current regardless. syncInterpolatedProceduralWaveObject overwrites
  // this with a genuine previous-frame snapshot and a real blendMix.
  // Reuse the arrays computed above instead of recomputing identical values.
  setOrUpdateVectorAttribute(
    next.geometry,
    'previousSampleData',
    sampleDataChannels,
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
  const { createProceduralCustomWaveMaterial } = getWebGpuHelperMaterialsSync();
  const next =
    object ??
    new Line(
      createProceduralWaveObjectGeometry(wave.samples.length),
      createProceduralCustomWaveMaterial(wave.fieldProgram),
    );
  const fieldProgramSignature = wave.fieldProgram?.signature ?? 'default';
  if (
    !isWebGpuNodeMaterial(next.material) ||
    next.material.userData.fieldProgramSignature !== fieldProgramSignature
  ) {
    disposeMaterial(next.material);
    next.material = createProceduralCustomWaveMaterial(wave.fieldProgram);
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
    'sampleValue2',
    wave.sampleValues2 ?? wave.samples,
  );
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue',
    wave.samples,
  );
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue2',
    wave.sampleValues2 ?? wave.samples,
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
  material.uniforms.sampleCount.value = wave.sampleCount ?? wave.samples.length;
  material.uniforms.previousSampleCount.value =
    wave.sampleCount ?? wave.samples.length;
  material.uniforms.signalFrame.value = wave.signals?.frame ?? 0;
  material.uniforms.signalFps.value = wave.signals?.fps ?? 60;
  material.uniforms.signalAspect.value = wave.signals?.aspect ?? 1;
  material.uniforms.signalBass.value = wave.signals?.bass ?? 0;
  material.uniforms.signalMid.value = wave.signals?.mid ?? 0;
  material.uniforms.signalMids.value = wave.signals?.mids ?? 0;
  material.uniforms.signalTreble.value = wave.signals?.treble ?? 0;
  material.uniforms.signalBassAtt.value = wave.signals?.bassAtt ?? 0;
  material.uniforms.signalMidAtt.value = wave.signals?.midAtt ?? 0;
  material.uniforms.signalMidsAtt.value = wave.signals?.midsAtt ?? 0;
  material.uniforms.signalTrebleAtt.value = wave.signals?.trebleAtt ?? 0;
  material.uniforms.signalBeat.value = wave.signals?.beat ?? 0;
  material.uniforms.signalBeatPulse.value = wave.signals?.beatPulse ?? 0;
  material.uniforms.signalRms.value = wave.signals?.rms ?? 0;
  material.uniforms.signalVol.value = wave.signals?.vol ?? 0;
  material.uniforms.signalMusic.value = wave.signals?.music ?? 0;
  material.uniforms.signalWeightedEnergy.value =
    wave.signals?.weightedEnergy ?? 0;
  material.uniforms.previousSignalFrame.value = wave.signals?.frame ?? 0;
  material.uniforms.previousSignalFps.value = wave.signals?.fps ?? 60;
  material.uniforms.previousSignalAspect.value = wave.signals?.aspect ?? 1;
  material.uniforms.previousSignalBass.value = wave.signals?.bass ?? 0;
  material.uniforms.previousSignalMid.value = wave.signals?.mid ?? 0;
  material.uniforms.previousSignalMids.value = wave.signals?.mids ?? 0;
  material.uniforms.previousSignalTreble.value = wave.signals?.treble ?? 0;
  material.uniforms.previousSignalBassAtt.value = wave.signals?.bassAtt ?? 0;
  material.uniforms.previousSignalMidAtt.value = wave.signals?.midAtt ?? 0;
  material.uniforms.previousSignalMidsAtt.value = wave.signals?.midsAtt ?? 0;
  material.uniforms.previousSignalTrebleAtt.value =
    wave.signals?.trebleAtt ?? 0;
  material.uniforms.previousSignalBeat.value = wave.signals?.beat ?? 0;
  material.uniforms.previousSignalBeatPulse.value =
    wave.signals?.beatPulse ?? 0;
  material.uniforms.previousSignalRms.value = wave.signals?.rms ?? 0;
  material.uniforms.previousSignalVol.value = wave.signals?.vol ?? 0;
  material.uniforms.previousSignalMusic.value = wave.signals?.music ?? 0;
  material.uniforms.previousSignalWeightedEnergy.value =
    wave.signals?.weightedEnergy ?? 0;
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
  const next = ensureProceduralWaveObject(object, currentWave);
  const { sampleDataChannels, velocityChannel } = fillProceduralWaveAttributes(
    next,
    currentWave,
  );
  const previousSamples = resampleScalarValues(
    previousWave.samples,
    currentWave.samples.length,
  );
  const previousVelocities = resampleScalarValues(
    previousWave.velocities,
    currentWave.velocities.length,
  );
  // sampleData/sampleMisc's "current" channels were already computed and
  // uploaded by fillProceduralWaveAttributes above; only previousSampleData
  // and the previous-velocity slot of sampleMisc are genuinely new here.
  void sampleDataChannels;
  setOrUpdateVectorAttribute(next.geometry, 'previousSampleData', [
    buildProceduralWaveAttributeValues(previousSamples, currentWave.closed),
    buildProceduralWaveAttributeValues(
      previousSamples,
      currentWave.closed,
      PROJECTM_STEREO_OFFSET,
    ),
    buildProceduralWaveAttributeValues(
      previousSamples,
      currentWave.closed,
      PROJECTM_STEREO_OFFSET * 2,
    ),
    buildProceduralWaveAttributeValues(
      previousSamples,
      currentWave.closed,
      PROJECTM_STEREO_OFFSET * 3,
    ),
  ]);
  setOrUpdateVectorAttribute(next.geometry, 'sampleMisc', [
    buildProceduralWaveParity(currentWave.samples.length, currentWave.closed),
    velocityChannel,
    buildProceduralWaveAttributeValues(previousVelocities, currentWave.closed),
  ]);
  const material = next.material as ShaderMaterial;
  material.uniforms.mode.value = currentWave.mode;
  material.uniforms.centerX.value = currentWave.centerX;
  material.uniforms.centerY.value = currentWave.centerY;
  material.uniforms.scale.value = currentWave.scale;
  material.uniforms.mystery.value = currentWave.mystery;
  material.uniforms.signalTime.value = currentWave.time;
  material.uniforms.beatPulse.value = currentWave.beatPulse;
  material.uniforms.trebleAtt.value = currentWave.trebleAtt;
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
  material.uniforms.alpha.value = previousWave.alpha * alphaMultiplier;
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
    'sampleValue2',
    currentWave.sampleValues2 ?? currentWave.samples,
  );
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue',
    resampleScalarValues(previousWave.samples, currentWave.samples.length),
  );
  setOrUpdateScalarAttribute(
    next.geometry,
    'previousSampleValue2',
    resampleScalarValues(
      previousWave.sampleValues2 ?? previousWave.samples,
      currentWave.samples.length,
    ),
  );
  const material = next.material as ShaderMaterial;
  material.uniforms.previousCenterX.value = previousWave.centerX;
  material.uniforms.previousCenterY.value = previousWave.centerY;
  material.uniforms.previousScaling.value = previousWave.scaling;
  material.uniforms.previousMystery.value = previousWave.mystery;
  material.uniforms.previousSignalTime.value = previousWave.time;
  material.uniforms.previousSpectrum.value = previousWave.spectrum ? 1 : 0;
  material.uniforms.sampleCount.value =
    currentWave.sampleCount ?? currentWave.samples.length;
  material.uniforms.previousSampleCount.value =
    previousWave.sampleCount ?? previousWave.samples.length;
  material.uniforms.previousSignalFrame.value =
    previousWave.signals?.frame ?? 0;
  material.uniforms.previousSignalFps.value = previousWave.signals?.fps ?? 60;
  material.uniforms.previousSignalBass.value = previousWave.signals?.bass ?? 0;
  material.uniforms.previousSignalMid.value = previousWave.signals?.mid ?? 0;
  material.uniforms.previousSignalMids.value = previousWave.signals?.mids ?? 0;
  material.uniforms.previousSignalTreble.value =
    previousWave.signals?.treble ?? 0;
  material.uniforms.previousSignalBassAtt.value =
    previousWave.signals?.bassAtt ?? 0;
  material.uniforms.previousSignalMidAtt.value =
    previousWave.signals?.midAtt ?? 0;
  material.uniforms.previousSignalMidsAtt.value =
    previousWave.signals?.midsAtt ?? 0;
  material.uniforms.previousSignalTrebleAtt.value =
    previousWave.signals?.trebleAtt ?? 0;
  material.uniforms.previousSignalBeat.value = previousWave.signals?.beat ?? 0;
  material.uniforms.previousSignalBeatPulse.value =
    previousWave.signals?.beatPulse ?? 0;
  material.uniforms.previousSignalRms.value = previousWave.signals?.rms ?? 0;
  material.uniforms.previousSignalVol.value = previousWave.signals?.vol ?? 0;
  material.uniforms.previousSignalMusic.value =
    previousWave.signals?.music ?? 0;
  material.uniforms.previousSignalWeightedEnergy.value =
    previousWave.signals?.weightedEnergy ?? 0;
  material.uniforms.blendMix.value = mix;
  material.uniforms.tint.value.setRGB(
    lerpNumber(previousWave.color.r, currentWave.color.r, mix),
    lerpNumber(previousWave.color.g, currentWave.color.g, mix),
    lerpNumber(previousWave.color.b, currentWave.color.b, mix),
  );
  material.uniforms.alpha.value = previousWave.alpha * alphaMultiplier;
  material.blending =
    previousWave.additive || currentWave.additive
      ? AdditiveBlending
      : NormalBlending;
  syncProceduralInteractionUniforms(material, interaction);
  return next;
}
