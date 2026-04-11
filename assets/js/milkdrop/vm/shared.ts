import type {
  MilkdropColor,
  MilkdropGpuFieldSignalInputs,
  MilkdropProceduralMeshDescriptorPlan,
  MilkdropProceduralWaveVisual,
  MilkdropRuntimeSignals,
  MilkdropWaveVisual,
} from '../types';

export const MAX_TRAILS = 5;
export const MAX_CUSTOM_WAVE_SLOTS = 32;
export const MAX_CUSTOM_SHAPE_SLOTS = 32;
export const MAX_MOTION_VECTOR_COLUMNS = 96;
export const MAX_MOTION_VECTOR_ROWS = 72;

export type MutableState = Record<string, number>;

export type MeshFieldPoint = {
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
};

export type MeshField = {
  density: number;
  points: MeshFieldPoint[];
  program: MilkdropProceduralMeshDescriptorPlan['fieldProgram'];
  signals: MilkdropGpuFieldSignalInputs | null;
};

export type MotionVectorHistoryPoint = {
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
};

export type MotionVectorFieldHistory = {
  countX: number;
  countY: number;
  points: MotionVectorHistoryPoint[];
};

export type MotionVectorDescriptorContext = {
  legacyControls: boolean;
  countX: number;
  countY: number;
};

export type WaveFrameBuffers = {
  liveSamples: number[];
  previousSamples: number[];
  smoothedSamples: number[];
  momentumSamples: number[];
};

export type WaveBuilderState = {
  trails: MilkdropWaveVisual[];
  lastWaveform: MilkdropWaveVisual | null;
  lastProceduralWave: MilkdropProceduralWaveVisual | null;
  lastWaveSamples: number[];
  lastWaveMomentum: number[];
  customWaveLocals: MutableState[];
  proceduralTrailWaves: MilkdropProceduralWaveVisual[];
  buffers: WaveFrameBuffers;
};

export type CustomWaveChannelSample = {
  sample: number;
  value: number;
  value1: number;
  value2: number;
};

export type GeometryBuilderState = {
  lastMotionVectorField: MotionVectorFieldHistory | null;
  frameTransformCache: Map<number, { x: number; y: number }>;
};

export type ShapeBuilderState = {
  customShapeLocals: MutableState[];
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeVideoEchoOrientation(value: number) {
  const truncated = Math.trunc(value);
  return (((truncated % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

export function color(r: number, g: number, b: number, a = 1): MilkdropColor {
  return {
    r: clamp(r, 0, 1),
    g: clamp(g, 0, 1),
    b: clamp(b, 0, 1),
    a: clamp(a, 0, 1),
  };
}

export function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function sampleFrequencyData(
  signals: MilkdropRuntimeSignals,
  t: number,
) {
  const sampleIndex = Math.min(
    signals.frequencyData.length - 1,
    Math.max(0, Math.round(t * Math.max(0, signals.frequencyData.length - 1))),
  );
  return (signals.frequencyData[sampleIndex] ?? 0) / 255;
}

export function sampleCustomWaveChannels(
  signals: MilkdropRuntimeSignals,
  sample: number,
  target?: CustomWaveChannelSample,
) {
  const normalizedSample = sampleFrequencyData(signals, sample);
  const next = target ?? {
    sample,
    value: normalizedSample,
    value1: normalizedSample,
    value2: normalizedSample,
  };
  next.sample = sample;
  next.value = normalizedSample;
  next.value1 = normalizedSample;
  next.value2 = normalizedSample;
  return next;
}

export function normalizeTransformCenter(value: number) {
  if (value >= 0 && value <= 1) {
    return value * 2 - 1;
  }
  return value;
}
