import type {
  MilkdropColor,
  MilkdropGpuFieldSignalInputs,
  MilkdropMotionVectorVisual,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralMeshDescriptorPlan,
  MilkdropProceduralWaveVisual,
  MilkdropRuntimeSignals,
  MilkdropShapeDefinition,
  MilkdropWaveDefinition,
  MilkdropWaveVisual,
} from '../types';
import { deriveMilkdropViewportSignalValues } from '../wgsl-signal-layout.ts';

export const MAX_TRAILS = 5;
export const MAIN_WAVE_FRAME_HISTORY_SIZE = MAX_TRAILS + 1;
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
  liveSamples: Float32Array;
  previousSamples: Float32Array;
  smoothedSamples: Float32Array;
  momentumSamples: Float32Array;
};

export type WaveBuilderState = {
  trails: MilkdropWaveVisual[];
  lastWaveform: MilkdropWaveVisual | null;
  lastProceduralWave: MilkdropProceduralWaveVisual | null;
  lastWaveSamples: Float32Array;
  lastWaveMomentum: Float32Array;
  mainWaveFrameIndex: number;
  mainWaveVisualFrames: MilkdropWaveVisual[];
  proceduralMainWaveFrames: MilkdropProceduralWaveVisual[];
  customWaveLocals: MutableState[];
  customWaveTAfterInit: MutableState[];
  customWaveFrameIndex: 0 | 1;
  customWaveVisualFrames: [MilkdropWaveVisual[], MilkdropWaveVisual[]];
  proceduralCustomWaveFrames: [
    MilkdropProceduralCustomWaveVisual[],
    MilkdropProceduralCustomWaveVisual[],
  ];
  customWaveVisualPool: MilkdropWaveVisual[];
  proceduralCustomWavePool: MilkdropProceduralCustomWaveVisual[];
  proceduralTrailWaves: MilkdropProceduralWaveVisual[];
  channelSample: CustomWaveChannelSample;
  buffers: WaveFrameBuffers;
  pointLocalsScratch: MutableState;
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
  /** Pool of reusable {x, y} objects for frameTransformCache entries,
   * sized once to peak capacity and reused across frames to avoid
   * per-frame allocation. */
  transformCachePool: { x: number; y: number }[];
  /** Number of pooled objects currently in use (0 after a reset). */
  transformCachePoolIndex: number;
  pointScratch: MutableState;
  meshPoints: MeshFieldPoint[];
  motionVectorFrameIndex: 0 | 1;
  motionVectorVisualFrames: [
    MilkdropMotionVectorVisual[],
    MilkdropMotionVectorVisual[],
  ];
  motionVectorHistoryBuffers: [
    MotionVectorHistoryPoint[],
    MotionVectorHistoryPoint[],
  ];
  motionVectorHistoryBufferIndex: 0 | 1;
  meshPositions?: Float32Array;
};

export type ShapeBuilderState = {
  customShapeLocals: MutableState[];
  customShapeTAfterInit: MutableState[];
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function normalizeVideoEchoOrientation(value: number) {
  const truncated = Math.trunc(value);
  return (((truncated % 4) + 4) % 4) as 0 | 1 | 2 | 3;
}

export function mix(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

export function colorTo(
  target: MilkdropColor,
  r: number,
  g: number,
  b: number,
  a = 1,
) {
  target.r = clamp(r, 0, 1);
  target.g = clamp(g, 0, 1);
  target.b = clamp(b, 0, 1);
  target.a = clamp(a, 0, 1);
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
  const data = signals.frequencyData;
  if (!data || data.length === 0) {
    return 0;
  }
  const sampleIndex = Math.min(
    data.length - 1,
    Math.max(0, Math.round(t * Math.max(0, data.length - 1))),
  );
  return (data[sampleIndex] ?? 0) / 255;
}

function sampleWaveformData(data: Uint8Array, sample: number): number {
  const scaledIndex = clamp(sample, 0, 1) * Math.max(0, data.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(data.length - 1, lowerIndex + 1);
  const amount = scaledIndex - lowerIndex;
  const lower = ((data[lowerIndex] ?? 128) - 128) / 128;
  const upper = ((data[upperIndex] ?? 128) - 128) / 128;
  return lower + (upper - lower) * amount;
}

export function sampleCustomWaveChannels(
  signals: MilkdropRuntimeSignals,
  sample: number,
  mode: 'spectrum' | 'waveform' = 'spectrum',
  target?: CustomWaveChannelSample,
) {
  const normalizedSample =
    mode === 'waveform' &&
    signals.waveformData &&
    signals.waveformData.length > 0
      ? sampleWaveformData(signals.waveformData, sample)
      : sampleFrequencyData(signals, sample);
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

export function createDefaultSignalEnv(): MutableState {
  return {
    time: 0,
    frame: 0,
    fps: 60,
    bass: 0,
    mid: 0,
    med: 0,
    mids: 0,
    treb: 0,
    att: 0,
    treble: 0,
    bass_att: 0,
    mid_att: 0,
    med_att: 0,
    mids_att: 0,
    treb_att: 0,
    treble_att: 0,
    bassAtt: 0,
    midsAtt: 0,
    trebleAtt: 0,
    beat: 0,
    beat_pulse: 0,
    beatPulse: 0,
    beatBass: 0,
    beatMid: 0,
    beatTreble: 0,
    beat_bass: 0,
    beat_mid: 0,
    beat_treb: 0,
    bandFlux: 0,
    rms: 0,
    vol: 0,
    music: 0,
    weighted_energy: 0,
    progress: 0,
    aspectx: 1,
    aspecty: 1,
    pixelsx: 1280,
    pixelsy: 1280,
    meshx: 48,
    meshy: 48,
    pi: Math.PI,
    e: Math.E,
    ...Object.fromEntries(
      Array.from({ length: 32 }, (_, i) => [`spec_${i}`, 0]),
    ),
  };
}

export function syncSignalEnvironment(
  signals: MilkdropRuntimeSignals,
  targetEnv: MutableState,
  meshDensity = 48,
): void {
  targetEnv.time = signals.time;
  targetEnv.frame = signals.frame;
  targetEnv.fps = signals.fps;
  targetEnv.aspect = signals.aspect ?? 1;
  deriveMilkdropViewportSignalValues(signals, targetEnv);
  targetEnv.meshx = meshDensity;
  targetEnv.meshy = meshDensity;
  targetEnv.bass = signals.bass;
  targetEnv.mid = signals.mid;
  targetEnv.med = signals.mid;
  targetEnv.mids = signals.mids;
  targetEnv.treb = signals.treb;
  targetEnv.att = signals.treb;
  targetEnv.treble = signals.treble;
  targetEnv.bass_att = signals.bass_att;
  targetEnv.mid_att = signals.mid_att;
  targetEnv.med_att = signals.mid_att;
  targetEnv.mids_att = signals.mids_att;
  targetEnv.treb_att = signals.treb_att;
  targetEnv.treble_att = signals.treble_att;
  targetEnv.bassAtt = signals.bassAtt;
  targetEnv.midAtt = signals.midAtt;
  targetEnv.midsAtt = signals.midsAtt;
  targetEnv.trebleAtt = signals.trebleAtt;
  targetEnv.beat = signals.beat;
  targetEnv.beat_pulse = signals.beat_pulse ?? signals.beatPulse ?? 0;
  targetEnv.beatPulse = signals.beatPulse ?? signals.beat_pulse ?? 0;
  targetEnv.beatBass = signals.beatBass;
  targetEnv.beatMid = signals.beatMid;
  targetEnv.beatTreble = signals.beatTreble;
  targetEnv.beat_bass = signals.beatBass;
  targetEnv.beat_mid = signals.beatMid;
  targetEnv.beat_treb = signals.beatTreble;
  targetEnv.bandFlux = signals.bandFlux;
  targetEnv.rms = signals.rms;
  targetEnv.vol = signals.vol;
  targetEnv.music = signals.music;
  targetEnv.weighted_energy = signals.weightedEnergy;
  targetEnv.progress = signals.frame;
  targetEnv.signalTime = signals.time;
  targetEnv.signalFrame = signals.frame;
  targetEnv.signalFps = signals.fps;
  targetEnv.signalBass = signals.bass;
  targetEnv.signalMid = signals.mid;
  targetEnv.signalTreb = signals.treb;
  targetEnv.signalBassAtt = signals.bassAtt ?? signals.bass_att ?? 0;
  targetEnv.signalMidAtt = signals.midAtt ?? signals.mid_att ?? 0;
  targetEnv.signalTrebAtt =
    (signals as { trebAtt?: number }).trebAtt ??
    signals.trebleAtt ??
    signals.treb_att ??
    0;
  targetEnv.signalBeat = signals.beat;
  targetEnv.signalBeatPulse = signals.beatPulse ?? signals.beat_pulse ?? 0;
  targetEnv.signalEnergy = signals.vol ?? signals.rms ?? 0;
  // Lowercase aliases — expression AST stores identifiers lowercased.
  targetEnv.signaltime = signals.time;
  targetEnv.signalframe = signals.frame;
  targetEnv.signalfps = signals.fps;
  targetEnv.signalbass = signals.bass;
  targetEnv.signalmid = signals.mid;
  targetEnv.signaltreb = signals.treb;
  targetEnv.signalbassatt = signals.bassAtt ?? signals.bass_att ?? 0;
  targetEnv.signalmidatt = signals.midAtt ?? signals.mid_att ?? 0;
  targetEnv.signaltrebatt =
    (signals as { trebAtt?: number }).trebAtt ??
    signals.trebleAtt ??
    signals.treb_att ??
    0;
  targetEnv.signalbeat = signals.beat;
  targetEnv.signalbeatpulse = signals.beatPulse ?? signals.beat_pulse ?? 0;
  targetEnv.signalenergy = signals.vol ?? signals.rms ?? 0;

  const freqData = signals.frequencyData;
  if (freqData && freqData.length > 0) {
    const binCount = freqData.length;
    const maxBin = Math.max(1, Math.floor(binCount / 2));
    for (let i = 0; i < 32; i += 1) {
      const lowBin = Math.floor(maxBin ** (i / 32));
      const highBin = Math.min(maxBin, Math.floor(maxBin ** ((i + 1) / 32)));
      const end = Math.max(lowBin + 1, highBin);
      let sum = 0;
      let count = 0;
      for (let b = lowBin; b < end && b < binCount; b += 1) {
        sum += freqData[b] ?? 0;
        count += 1;
      }
      targetEnv[`spec_${i}`] = count > 0 ? sum / count / 255 : 0;
    }
  } else {
    for (let i = 0; i < 32; i += 1) {
      targetEnv[`spec_${i}`] = 0;
    }
  }
}

const DEFAULT_CUSTOM_WAVE_T_REGISTERS: Readonly<Record<string, number>> =
  Object.freeze(
    Object.fromEntries(
      Array.from({ length: MAX_CUSTOM_WAVE_SLOTS }, (_, idx) => [
        `t${idx + 1}`,
        0,
      ]),
    ),
  );

export const CUSTOM_WAVE_PROPERTY_KEYS = Array.from(
  { length: 32 },
  (_, index) => ({
    enabled: `custom_wave_${index}_enabled`,
    samples: `custom_wave_${index}_samples`,
    spectrum: `custom_wave_${index}_spectrum`,
    additive: `custom_wave_${index}_additive`,
    usedots: `custom_wave_${index}_usedots`,
    scaling: `custom_wave_${index}_scaling`,
    smoothing: `custom_wave_${index}_smoothing`,
    mystery: `custom_wave_${index}_mystery`,
    thick: `custom_wave_${index}_thick`,
    x: `custom_wave_${index}_x`,
    y: `custom_wave_${index}_y`,
    r: `custom_wave_${index}_r`,
    g: `custom_wave_${index}_g`,
    b: `custom_wave_${index}_b`,
    a: `custom_wave_${index}_a`,
  }),
);

export const CUSTOM_SHAPE_PROPERTY_KEYS = Array.from(
  { length: 32 },
  (_, index) => ({
    enabled: `shape_${index}_enabled`,
    sides: `shape_${index}_sides`,
    x: `shape_${index}_x`,
    y: `shape_${index}_y`,
    rad: `shape_${index}_rad`,
    ang: `shape_${index}_ang`,
    num_inst: `shape_${index}_num_inst`,
    textured: `shape_${index}_textured`,
    tex_zoom: `shape_${index}_tex_zoom`,
    tex_ang: `shape_${index}_tex_ang`,
    r: `shape_${index}_r`,
    g: `shape_${index}_g`,
    b: `shape_${index}_b`,
    a: `shape_${index}_a`,
    r2: `shape_${index}_r2`,
    g2: `shape_${index}_g2`,
    b2: `shape_${index}_b2`,
    a2: `shape_${index}_a2`,
    border_r: `shape_${index}_border_r`,
    border_g: `shape_${index}_border_g`,
    border_b: `shape_${index}_border_b`,
    border_a: `shape_${index}_border_a`,
    additive: `shape_${index}_additive`,
    thickoutline: `shape_${index}_thickoutline`,
  }),
);

export const SHAPECODE_PROPERTY_KEYS = Array.from(
  { length: 32 },
  (_, index) => ({
    enabled: `shapecode_${index}_enabled`,
    sides: `shapecode_${index}_sides`,
    x: `shapecode_${index}_x`,
    y: `shapecode_${index}_y`,
    rad: `shapecode_${index}_rad`,
    ang: `shapecode_${index}_ang`,
    textured: `shapecode_${index}_textured`,
    tex_zoom: `shapecode_${index}_tex_zoom`,
    tex_ang: `shapecode_${index}_tex_ang`,
    r: `shapecode_${index}_r`,
    g: `shapecode_${index}_g`,
    b: `shapecode_${index}_b`,
    a: `shapecode_${index}_a`,
    r2: `shapecode_${index}_r2`,
    g2: `shapecode_${index}_g2`,
    b2: `shapecode_${index}_b2`,
    a2: `shapecode_${index}_a2`,
    border_r: `shapecode_${index}_border_r`,
    border_g: `shapecode_${index}_border_g`,
    border_b: `shapecode_${index}_border_b`,
    border_a: `shapecode_${index}_border_a`,
    additive: `shapecode_${index}_additive`,
    thickoutline: `shapecode_${index}_thickoutline`,
  }),
);

export function seedCustomWaveFields(
  wave: MilkdropWaveDefinition,
  state: MutableState,
): MutableState {
  const index = wave.index;
  const keys = CUSTOM_WAVE_PROPERTY_KEYS[index];
  return {
    enabled: wave.fields.enabled ?? (keys ? state[keys.enabled] : 0) ?? 0,
    samples: wave.fields.samples ?? (keys ? state[keys.samples] : 64) ?? 64,
    spectrum: wave.fields.spectrum ?? (keys ? state[keys.spectrum] : 0) ?? 0,
    additive: wave.fields.additive ?? (keys ? state[keys.additive] : 0) ?? 0,
    usedots: wave.fields.usedots ?? (keys ? state[keys.usedots] : 0) ?? 0,
    scaling: wave.fields.scaling ?? (keys ? state[keys.scaling] : 1) ?? 1,
    smoothing:
      wave.fields.smoothing ?? (keys ? state[keys.smoothing] : 0.5) ?? 0.5,
    mystery: wave.fields.mystery ?? (keys ? state[keys.mystery] : 0) ?? 0,
    thick: wave.fields.thick ?? (keys ? state[keys.thick] : 1) ?? 1,
    x: wave.fields.x ?? (keys ? state[keys.x] : 0.5) ?? 0.5,
    y: wave.fields.y ?? (keys ? state[keys.y] : 0.5) ?? 0.5,
    r: wave.fields.r ?? (keys ? state[keys.r] : 1) ?? 1,
    g: wave.fields.g ?? (keys ? state[keys.g] : 1) ?? 1,
    b: wave.fields.b ?? (keys ? state[keys.b] : 1) ?? 1,
    a: wave.fields.a ?? (keys ? state[keys.a] : 0.4) ?? 0.4,
    ...DEFAULT_CUSTOM_WAVE_T_REGISTERS,
  };
}

export function seedCustomShapeFields(
  shape: MilkdropShapeDefinition,
  state: MutableState,
): MutableState {
  const index = shape.index;
  const keys = CUSTOM_SHAPE_PROPERTY_KEYS[index];
  return {
    enabled: shape.fields.enabled ?? (keys ? state[keys.enabled] : 0) ?? 0,
    sides: shape.fields.sides ?? (keys ? state[keys.sides] : 6) ?? 6,
    x: shape.fields.x ?? (keys ? state[keys.x] : 0.5) ?? 0.5,
    y: shape.fields.y ?? (keys ? state[keys.y] : 0.5) ?? 0.5,
    rad: shape.fields.rad ?? (keys ? state[keys.rad] : 0.15) ?? 0.15,
    ang: shape.fields.ang ?? (keys ? state[keys.ang] : 0) ?? 0,
    instance: 0,
    num_inst: shape.fields.num_inst ?? (keys ? state[keys.num_inst] : 1) ?? 1,
    textured: shape.fields.textured ?? (keys ? state[keys.textured] : 0) ?? 0,
    tex_zoom: shape.fields.tex_zoom ?? (keys ? state[keys.tex_zoom] : 1) ?? 1,
    tex_ang: shape.fields.tex_ang ?? (keys ? state[keys.tex_ang] : 0) ?? 0,
    r: shape.fields.r ?? (keys ? state[keys.r] : 1) ?? 1,
    g: shape.fields.g ?? (keys ? state[keys.g] : 1) ?? 1,
    b: shape.fields.b ?? (keys ? state[keys.b] : 1) ?? 1,
    a: shape.fields.a ?? (keys ? state[keys.a] : 0.2) ?? 0.2,
    r2: shape.fields.r2 ?? (keys ? state[keys.r2] : 0) ?? 0,
    g2: shape.fields.g2 ?? (keys ? state[keys.g2] : 0) ?? 0,
    b2: shape.fields.b2 ?? (keys ? state[keys.b2] : 0) ?? 0,
    a2: shape.fields.a2 ?? (keys ? state[keys.a2] : 0) ?? 0,
    border_r: shape.fields.border_r ?? (keys ? state[keys.border_r] : 1) ?? 1,
    border_g: shape.fields.border_g ?? (keys ? state[keys.border_g] : 1) ?? 1,
    border_b: shape.fields.border_b ?? (keys ? state[keys.border_b] : 1) ?? 1,
    border_a:
      shape.fields.border_a ?? (keys ? state[keys.border_a] : 0.8) ?? 0.8,
    additive: shape.fields.additive ?? (keys ? state[keys.additive] : 0) ?? 0,
    thickoutline:
      shape.fields.thickoutline ?? (keys ? state[keys.thickoutline] : 0) ?? 0,
  };
}
