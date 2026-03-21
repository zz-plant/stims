import {
  DEFAULT_MILKDROP_STATE,
  evaluateMilkdropShaderControlProgram,
} from './compiler';
import { evaluateMilkdropExpression } from './expression';
import type {
  MilkdropBorderVisual,
  MilkdropColor,
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropGpuFieldSignalInputs,
  MilkdropGpuGeometryHints,
  MilkdropMeshVisual,
  MilkdropMotionVectorVisual,
  MilkdropPolyline,
  MilkdropPostVisual,
  MilkdropProceduralCustomWaveVisual,
  MilkdropProceduralMeshDescriptorPlan,
  MilkdropProceduralMeshFieldVisual,
  MilkdropProceduralMotionVectorFieldVisual,
  MilkdropProceduralWaveVisual,
  MilkdropRuntimeSignals,
  MilkdropShapeDefinition,
  MilkdropShapeVisual,
  MilkdropVideoEchoOrientation,
  MilkdropVM,
  MilkdropWaveDefinition,
  MilkdropWaveVisual,
} from './types';

const MAX_TRAILS = 5;
const MAX_CUSTOM_WAVE_SLOTS = 32;
const MAX_CUSTOM_SHAPE_SLOTS = 32;
const MAX_MOTION_VECTOR_COLUMNS = 96;
const MAX_MOTION_VECTOR_ROWS = 72;
const TWO_PI = Math.PI * 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeVideoEchoOrientation(
  value: number,
): MilkdropVideoEchoOrientation {
  const truncated = Math.trunc(value);
  return (((truncated % 4) + 4) % 4) as MilkdropVideoEchoOrientation;
}

function color(r: number, g: number, b: number, a = 1): MilkdropColor {
  return {
    r: clamp(r, 0, 1),
    g: clamp(g, 0, 1),
    b: clamp(b, 0, 1),
    a: clamp(a, 0, 1),
  };
}

function hashSeed(input: string) {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function defaultSignalEnv(): MilkdropRuntimeSignals {
  const frequencyData = new Uint8Array(64);
  const waveformData = new Uint8Array(64);
  waveformData.fill(128);
  return {
    time: 0,
    deltaMs: 16.67,
    frame: 0,
    fps: 60,
    bass: 0,
    mid: 0,
    mids: 0,
    treb: 0,
    treble: 0,
    bassAtt: 0,
    midsAtt: 0,
    trebleAtt: 0,
    bass_att: 0,
    mid_att: 0,
    mids_att: 0,
    treb_att: 0,
    treble_att: 0,
    rms: 0,
    vol: 0,
    music: 0,
    beat: 0,
    beatPulse: 0,
    beat_pulse: 0,
    weightedEnergy: 0,
    inputX: 0,
    inputY: 0,
    input_x: 0,
    input_y: 0,
    inputDx: 0,
    inputDy: 0,
    input_dx: 0,
    input_dy: 0,
    inputSpeed: 0,
    input_speed: 0,
    inputPressed: 0,
    input_pressed: 0,
    inputJustPressed: 0,
    input_just_pressed: 0,
    inputJustReleased: 0,
    input_just_released: 0,
    inputCount: 0,
    input_count: 0,
    gestureScale: 1,
    gesture_scale: 1,
    gestureRotation: 0,
    gesture_rotation: 0,
    gestureTranslateX: 0,
    gestureTranslateY: 0,
    gesture_translate_x: 0,
    gesture_translate_y: 0,
    hoverActive: 0,
    hover_active: 0,
    hoverX: 0,
    hoverY: 0,
    hover_x: 0,
    hover_y: 0,
    wheelDelta: 0,
    wheel_delta: 0,
    wheelAccum: 0,
    wheel_accum: 0,
    dragIntensity: 0,
    drag_intensity: 0,
    dragAngle: 0,
    drag_angle: 0,
    accentPulse: 0,
    accent_pulse: 0,
    actionAccent: 0,
    action_accent: 0,
    actionModeNext: 0,
    action_mode_next: 0,
    actionModePrevious: 0,
    action_mode_previous: 0,
    actionPresetNext: 0,
    action_preset_next: 0,
    actionPresetPrevious: 0,
    action_preset_previous: 0,
    actionQuickLook1: 0,
    action_quick_look_1: 0,
    actionQuickLook2: 0,
    action_quick_look_2: 0,
    actionQuickLook3: 0,
    action_quick_look_3: 0,
    actionRemix: 0,
    action_remix: 0,
    inputSourcePointer: 0,
    input_source_pointer: 0,
    inputSourceKeyboard: 0,
    input_source_keyboard: 0,
    inputSourceGamepad: 0,
    input_source_gamepad: 0,
    inputSourceMouse: 0,
    input_source_mouse: 0,
    inputSourceTouch: 0,
    input_source_touch: 0,
    inputSourcePen: 0,
    input_source_pen: 0,
    motionX: 0,
    motionY: 0,
    motionZ: 0,
    motion_x: 0,
    motion_y: 0,
    motion_z: 0,
    motionEnabled: 0,
    motion_enabled: 0,
    motionStrength: 0,
    motion_strength: 0,
    frequencyData,
    waveformData,
  };
}

function normalizeWaveMode(value: number) {
  const rounded = Math.round(value);
  return ((rounded % 8) + 8) % 8;
}

function brightenWaveColor(waveColor: {
  r: number;
  g: number;
  b: number;
  a?: number;
}) {
  const peak = Math.max(waveColor.r, waveColor.g, waveColor.b);
  if (peak <= 0.0001 || peak >= 1) {
    return waveColor;
  }
  const gain = 1 / peak;
  return color(
    clamp(waveColor.r * gain, 0, 1),
    clamp(waveColor.g * gain, 0, 1),
    clamp(waveColor.b * gain, 0, 1),
    waveColor.a,
  );
}

function mix(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function sampleFrequencyData(signals: MilkdropRuntimeSignals, t: number) {
  const sampleIndex = Math.min(
    signals.frequencyData.length - 1,
    Math.max(0, Math.round(t * Math.max(0, signals.frequencyData.length - 1))),
  );
  return (signals.frequencyData[sampleIndex] ?? 0) / 255;
}

function sampleWaveformData(signals: MilkdropRuntimeSignals, t: number) {
  const waveformData =
    signals.waveformData && signals.waveformData.length > 0
      ? signals.waveformData
      : signals.frequencyData;
  if (waveformData.length === 0) {
    return 0;
  }
  const scaledIndex = clamp(t, 0, 1) * Math.max(0, waveformData.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(waveformData.length - 1, lowerIndex + 1);
  const amount = scaledIndex - lowerIndex;
  const lower = ((waveformData[lowerIndex] ?? 128) - 128) / 128;
  const upper = ((waveformData[upperIndex] ?? 128) - 128) / 128;
  return mix(lower, upper, amount);
}

function normalizeProjectMMystery(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return ((value % 1) + 1) % 1;
}

function isClosedMainWaveMode(mode: number) {
  return (
    mode === 0 ||
    mode === 1 ||
    mode === 2 ||
    mode === 3 ||
    mode === 5 ||
    mode === 7
  );
}

function getMainWaveSampleCount(
  mode: number,
  detailScale: number,
  sourceLength: number,
) {
  const baseCountByMode = [176, 168, 160, 152, 192, 176, 192, 160];
  const sourceFloor = sourceLength > 0 ? Math.min(sourceLength, 384) : 64;
  return clamp(
    Math.round(
      mix(baseCountByMode[mode] ?? 168, sourceFloor, 0.45) *
        clamp(detailScale, 0.5, 2),
    ),
    48,
    384,
  );
}

function sampleCustomWaveChannels(
  signals: MilkdropRuntimeSignals,
  sample: number,
) {
  const normalizedSample = sampleFrequencyData(signals, sample);
  return {
    sample,
    value: normalizedSample,
    value1: normalizedSample,
    value2: normalizedSample,
  };
}

function normalizeTransformCenter(value: number) {
  if (value >= 0 && value <= 1) {
    return value * 2 - 1;
  }
  return value;
}

type MutableState = Record<string, number>;
type MeshFieldPoint = {
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
};
type MeshField = {
  density: number;
  points: MeshFieldPoint[];
  program: MilkdropProceduralMeshDescriptorPlan['fieldProgram'];
  signals: MilkdropGpuFieldSignalInputs | null;
};

type MotionVectorHistoryPoint = {
  sourceX: number;
  sourceY: number;
  x: number;
  y: number;
};

type MotionVectorFieldHistory = {
  countX: number;
  countY: number;
  points: MotionVectorHistoryPoint[];
};

type MotionVectorDescriptorContext = {
  legacyControls: boolean;
  countX: number;
  countY: number;
};

type WaveFrameBuffers = {
  liveSamples: number[];
  previousSamples: number[];
  smoothedSamples: number[];
  momentumSamples: number[];
};

class MilkdropPresetVM implements MilkdropVM {
  private preset: MilkdropCompiledPreset;
  private state: MutableState = {};
  private registers: MutableState = {};
  private randomState = 1;
  private detailScale = 1;
  private renderBackend: 'webgl' | 'webgpu' = 'webgl';
  private trails: MilkdropPolyline[] = [];
  private lastWaveform: MilkdropWaveVisual | null = null;
  private lastProceduralWave: MilkdropProceduralWaveVisual | null = null;
  private lastWaveSamples: number[] = [];
  private lastWaveMomentum: number[] = [];
  private customWaveState: MutableState[] = [];
  private proceduralTrailWaves: MilkdropProceduralWaveVisual[] = [];
  private customShapeState: MutableState[] = [];
  private lastMotionVectorField: MotionVectorFieldHistory | null = null;
  private readonly waveBuffers: WaveFrameBuffers = {
    liveSamples: [],
    previousSamples: [],
    smoothedSamples: [],
    momentumSamples: [],
  };
  private readonly frameTransformCache = new Map<
    number,
    { x: number; y: number }
  >();

  constructor(preset: MilkdropCompiledPreset) {
    this.preset = preset;
    this.reset();
  }

  setPreset(preset: MilkdropCompiledPreset) {
    this.preset = preset;
    this.reset();
  }

  setDetailScale(scale: number) {
    this.detailScale = clamp(scale, 0.5, 2);
  }

  setRenderBackend(backend: 'webgl' | 'webgpu') {
    this.renderBackend = backend;
  }

  reset() {
    this.state = { ...DEFAULT_MILKDROP_STATE, ...this.preset.ir.numericFields };
    this.registers = {};
    for (let index = 1; index <= 32; index += 1) {
      this.registers[`q${index}`] = 0;
    }
    for (let index = 1; index <= MAX_CUSTOM_WAVE_SLOTS; index += 1) {
      this.registers[`t${index}`] = 0;
    }
    this.randomState =
      hashSeed(this.preset.source.id || this.preset.title || 'milkdrop') || 1;
    this.trails = [];
    this.lastWaveform = null;
    this.lastProceduralWave = null;
    this.lastWaveSamples = [];
    this.lastWaveMomentum = [];
    this.customWaveState = this.preset.ir.customWaves.map((wave) =>
      this.seedCustomWaveState(wave),
    );
    this.customShapeState = this.preset.ir.customShapes.map((shape) =>
      this.seedCustomShapeState(shape),
    );
    this.proceduralTrailWaves = [];
    this.lastMotionVectorField = null;
    this.waveBuffers.liveSamples.length = 0;
    this.waveBuffers.previousSamples.length = 0;
    this.waveBuffers.smoothedSamples.length = 0;
    this.waveBuffers.momentumSamples.length = 0;
    this.frameTransformCache.clear();

    const zeroSignals = defaultSignalEnv();
    this.runProgram(this.preset.ir.programs.init, this.createEnv(zeroSignals));
    this.preset.ir.customWaves.forEach((wave, index) => {
      this.runProgram(
        wave.programs.init,
        this.createEnv(zeroSignals, this.customWaveState[index] ?? {}),
        this.customWaveState[index],
      );
    });
    this.preset.ir.customShapes.forEach((shape, index) => {
      this.runProgram(
        shape.programs.init,
        this.createEnv(zeroSignals, this.customShapeState[index] ?? {}),
        this.customShapeState[index],
      );
    });
  }

  getStateSnapshot() {
    return {
      ...this.state,
      ...this.registers,
      ...Object.fromEntries(
        this.customWaveState.flatMap((waveState, index) =>
          Object.entries(waveState).map(([key, value]) => [
            `wave${index + 1}_${key}`,
            value,
          ]),
        ),
      ),
      ...Object.fromEntries(
        this.customShapeState.flatMap((shapeState, index) =>
          Object.entries(shapeState).map(([key, value]) => [
            `shape${index + 1}_${key}`,
            value,
          ]),
        ),
      ),
    };
  }

  private syncLastWaveSamples(samples: number[], count: number) {
    this.lastWaveSamples.length = count;
    for (let index = 0; index < count; index += 1) {
      this.lastWaveSamples[index] = samples[index] ?? 0;
    }
  }

  private syncLastWaveMomentum(samples: number[], count: number) {
    this.lastWaveMomentum.length = count;
    for (let index = 0; index < count; index += 1) {
      this.lastWaveMomentum[index] = samples[index] ?? 0;
    }
  }

  private nextRandom = () => {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 0xffffffff;
  };

  private seedCustomWaveState(wave: MilkdropWaveDefinition) {
    return {
      enabled:
        wave.fields.enabled ??
        this.state[`custom_wave_${wave.index}_enabled`] ??
        0,
      samples:
        wave.fields.samples ??
        this.state[`custom_wave_${wave.index}_samples`] ??
        64,
      spectrum:
        wave.fields.spectrum ??
        this.state[`custom_wave_${wave.index}_spectrum`] ??
        0,
      additive:
        wave.fields.additive ??
        this.state[`custom_wave_${wave.index}_additive`] ??
        0,
      usedots:
        wave.fields.usedots ??
        this.state[`custom_wave_${wave.index}_usedots`] ??
        0,
      scaling:
        wave.fields.scaling ??
        this.state[`custom_wave_${wave.index}_scaling`] ??
        1,
      smoothing:
        wave.fields.smoothing ??
        this.state[`custom_wave_${wave.index}_smoothing`] ??
        0.5,
      mystery:
        wave.fields.mystery ??
        this.state[`custom_wave_${wave.index}_mystery`] ??
        0,
      thick:
        wave.fields.thick ?? this.state[`custom_wave_${wave.index}_thick`] ?? 1,
      x: wave.fields.x ?? this.state[`custom_wave_${wave.index}_x`] ?? 0.5,
      y: wave.fields.y ?? this.state[`custom_wave_${wave.index}_y`] ?? 0.5,
      r: wave.fields.r ?? this.state[`custom_wave_${wave.index}_r`] ?? 1,
      g: wave.fields.g ?? this.state[`custom_wave_${wave.index}_g`] ?? 1,
      b: wave.fields.b ?? this.state[`custom_wave_${wave.index}_b`] ?? 1,
      a: wave.fields.a ?? this.state[`custom_wave_${wave.index}_a`] ?? 0.4,
    };
  }

  private seedCustomShapeState(shape: MilkdropShapeDefinition) {
    const prefix = `shape_${shape.index}`;
    return {
      enabled: shape.fields.enabled ?? this.state[`${prefix}_enabled`] ?? 0,
      sides: shape.fields.sides ?? this.state[`${prefix}_sides`] ?? 6,
      x: shape.fields.x ?? this.state[`${prefix}_x`] ?? 0.5,
      y: shape.fields.y ?? this.state[`${prefix}_y`] ?? 0.5,
      rad: shape.fields.rad ?? this.state[`${prefix}_rad`] ?? 0.15,
      ang: shape.fields.ang ?? this.state[`${prefix}_ang`] ?? 0,
      r: shape.fields.r ?? this.state[`${prefix}_r`] ?? 1,
      g: shape.fields.g ?? this.state[`${prefix}_g`] ?? 1,
      b: shape.fields.b ?? this.state[`${prefix}_b`] ?? 1,
      a: shape.fields.a ?? this.state[`${prefix}_a`] ?? 0.2,
      r2: shape.fields.r2 ?? this.state[`${prefix}_r2`] ?? 0,
      g2: shape.fields.g2 ?? this.state[`${prefix}_g2`] ?? 0,
      b2: shape.fields.b2 ?? this.state[`${prefix}_b2`] ?? 0,
      a2: shape.fields.a2 ?? this.state[`${prefix}_a2`] ?? 0,
      border_r: shape.fields.border_r ?? this.state[`${prefix}_border_r`] ?? 1,
      border_g: shape.fields.border_g ?? this.state[`${prefix}_border_g`] ?? 1,
      border_b: shape.fields.border_b ?? this.state[`${prefix}_border_b`] ?? 1,
      border_a:
        shape.fields.border_a ?? this.state[`${prefix}_border_a`] ?? 0.8,
      additive: shape.fields.additive ?? this.state[`${prefix}_additive`] ?? 0,
      thickoutline:
        shape.fields.thickoutline ?? this.state[`${prefix}_thickoutline`] ?? 0,
    };
  }

  private createEnv(
    signals: MilkdropRuntimeSignals,
    extra: Record<string, number> = {},
  ) {
    return {
      ...this.state,
      ...this.registers,
      ...extra,
      time: signals.time,
      frame: signals.frame,
      fps: signals.fps,
      bass: signals.bass,
      mid: signals.mid,
      mids: signals.mids,
      treb: signals.treb,
      treble: signals.treble,
      bass_att: signals.bass_att,
      mid_att: signals.mid_att,
      mids_att: signals.mids_att,
      treb_att: signals.treb_att,
      treble_att: signals.treble_att,
      bassAtt: signals.bassAtt,
      midsAtt: signals.midsAtt,
      trebleAtt: signals.trebleAtt,
      beat: signals.beat,
      beat_pulse: signals.beat_pulse,
      beatPulse: signals.beatPulse,
      rms: signals.rms,
      vol: signals.vol,
      music: signals.music,
      weighted_energy: signals.weightedEnergy,
      progress: signals.frame,
      pi: Math.PI,
      e: Math.E,
    };
  }

  private setValue(
    target: string,
    value: number,
    locals: MutableState | null = null,
  ) {
    const registerMatch = target.toLowerCase().match(/^([qt])(\d+)$/u);
    if (registerMatch) {
      this.registers[target.toLowerCase()] = value;
      return;
    }
    if (locals && target in locals) {
      locals[target] = value;
      return;
    }
    this.state[target] = value;
  }

  private runProgram(
    block: MilkdropCompiledPreset['ir']['programs']['init'],
    env: MutableState,
    locals: MutableState | null = null,
  ) {
    const scopedEnv = {
      ...env,
      ...this.state,
      ...this.registers,
      ...(locals ?? {}),
    };
    block.statements.forEach((statement) => {
      const value = evaluateMilkdropExpression(
        statement.expression,
        scopedEnv,
        {
          nextRandom: this.nextRandom,
        },
      );
      this.setValue(statement.target, value, locals);
      env[statement.target] = value;
      scopedEnv[statement.target] = value;
    });
  }

  private getTransformCacheKey(x: number, y: number) {
    const quantizedX = Math.round((x + 1) * 2048);
    const quantizedY = Math.round((y + 1) * 2048);
    return quantizedX * 4096 + quantizedY;
  }

  private supportsProceduralWave(_drawMode: 'line' | 'dots') {
    return false;
  }

  private supportsProceduralCustomWave(
    wave: MilkdropWaveDefinition,
    drawMode: 'line' | 'dots',
  ) {
    return (
      this.renderBackend === 'webgpu' &&
      drawMode === 'line' &&
      wave.programs.perPoint.statements.length === 0
    );
  }

  private getProceduralMeshDescriptorPlan() {
    return this.renderBackend === 'webgpu'
      ? this.preset.ir.compatibility.gpuDescriptorPlans.webgpu.proceduralMesh
      : null;
  }

  private getProceduralMotionVectorDescriptorPlan() {
    return this.renderBackend === 'webgpu'
      ? this.preset.ir.compatibility.gpuDescriptorPlans.webgpu
          .proceduralMotionVectors
      : null;
  }

  private buildProceduralFieldTransform() {
    return {
      zoom: Math.max(this.state.zoom ?? 1, 0.0001),
      zoomExponent: Math.max(this.state.zoomexp ?? 1, 0.0001),
      rotation: this.state.rot ?? 0,
      warp: this.state.warp ?? 0,
      warpAnimSpeed: clamp(this.state.warpanimspeed ?? 1, 0, 4),
      centerX: normalizeTransformCenter(this.state.cx ?? 0.5),
      centerY: normalizeTransformCenter(this.state.cy ?? 0.5),
      scaleX: this.state.sx ?? 1,
      scaleY: this.state.sy ?? 1,
      translateX: (this.state.dx ?? 0) * 2,
      translateY: (this.state.dy ?? 0) * 2,
    };
  }

  private buildProceduralFieldSignals(
    signals: MilkdropRuntimeSignals,
  ): MilkdropGpuFieldSignalInputs {
    return {
      time: signals.time,
      frame: signals.frame,
      fps: signals.fps,
      bass: signals.bass,
      mid: signals.mid,
      mids: signals.mids,
      treble: signals.treble,
      bassAtt: signals.bassAtt,
      midAtt: signals.mid_att,
      midsAtt: signals.midsAtt,
      trebleAtt: signals.trebleAtt,
      beat: signals.beat,
      beatPulse: signals.beatPulse,
      rms: signals.rms,
      vol: signals.vol,
      music: signals.music,
      weightedEnergy: signals.weightedEnergy,
    };
  }

  private getMeshDensity() {
    return clamp(
      Math.round((this.state.mesh_density ?? 16) * this.detailScale),
      8,
      28,
    );
  }

  private getMotionVectorDescriptorContext(): MotionVectorDescriptorContext | null {
    const legacyControls =
      Math.abs(this.state.mv_dx ?? 0) > 0.0001 ||
      Math.abs(this.state.mv_dy ?? 0) > 0.0001 ||
      Math.abs(this.state.mv_l ?? 0) > 0.0001 ||
      this.preset.ir.programs.init.statements.some(
        (statement) =>
          statement.target === 'motion_vectors_x' ||
          statement.target === 'motion_vectors_y',
      ) ||
      this.preset.ir.programs.perFrame.statements.some(
        (statement) =>
          statement.target === 'motion_vectors_x' ||
          statement.target === 'motion_vectors_y',
      );

    if ((this.state.motion_vectors ?? 0) < 0.5 && !legacyControls) {
      return null;
    }

    return {
      legacyControls,
      countX: clamp(
        Math.round(this.state.motion_vectors_x ?? 16),
        1,
        MAX_MOTION_VECTOR_COLUMNS,
      ),
      countY: clamp(
        Math.round(this.state.motion_vectors_y ?? 12),
        1,
        MAX_MOTION_VECTOR_ROWS,
      ),
    };
  }

  private buildMainWave(signals: MilkdropRuntimeSignals) {
    const mode = normalizeWaveMode(this.state.wave_mode ?? 0);
    const waveformData =
      signals.waveformData && signals.waveformData.length > 0
        ? signals.waveformData
        : signals.frequencyData;
    const samples = getMainWaveSampleCount(
      mode,
      this.detailScale,
      waveformData.length,
    );
    const centerX = ((this.state.wave_x ?? 0.5) - 0.5) * 2;
    const centerY = (0.5 - (this.state.wave_y ?? 0.5)) * 2;
    const scale = clamp(0.12 + (this.state.wave_scale ?? 1) * 0.2, 0.08, 1.4);
    const smoothing = clamp(this.state.wave_smoothing ?? 0.72, 0, 0.98);
    const mystery = normalizeProjectMMystery(this.state.wave_mystery ?? 0);
    const mysteryPhase = mystery * Math.PI;
    const modWaveAlphaStart = clamp(this.state.modwavealphastart ?? 1, 0, 2);
    const modWaveAlphaEnd = clamp(this.state.modwavealphaend ?? 1, 0, 2);
    const alphaByVolume = (this.state.bmodwavealphabyvolume ?? 0) >= 0.5;
    const liveSamples = this.waveBuffers.liveSamples;
    const previousSamples = this.waveBuffers.previousSamples;
    const smoothedSamples = this.waveBuffers.smoothedSamples;
    const momentumSamples = this.waveBuffers.momentumSamples;
    liveSamples.length = samples;
    previousSamples.length = samples;
    smoothedSamples.length = samples;
    momentumSamples.length = samples;
    for (let index = 0; index < samples; index += 1) {
      previousSamples[index] = this.lastWaveSamples[index] ?? 0;
      momentumSamples[index] = this.lastWaveMomentum[index] ?? 0;
    }
    const smoothingBlend = clamp(1 - smoothing, 0.04, 1);
    for (let index = 0; index < samples; index += 1) {
      const t = index / Math.max(1, samples - 1);
      const value = sampleWaveformData(signals, t);
      liveSamples[index] = value;
      smoothedSamples[index] = mix(
        previousSamples[index] ?? value,
        value,
        smoothingBlend,
      );
    }
    this.syncLastWaveSamples(smoothedSamples, samples);

    const drawMode = (this.state.wave_usedots ?? 0) >= 0.5 ? 'dots' : 'line';
    const useProcedural = this.supportsProceduralWave(drawMode);
    const positions = useProcedural ? [] : new Array<number>(samples * 3);
    const proceduralSamples = useProcedural ? new Array<number>(samples) : null;
    const proceduralVelocities = useProcedural
      ? new Array<number>(samples)
      : null;

    for (let index = 0; index < samples; index += 1) {
      const t = index / Math.max(1, samples - 1);
      const sampleValue =
        smoothedSamples[index] ?? sampleWaveformData(signals, t);
      const previousSample = previousSamples[index] ?? sampleValue;
      const previousMomentum = momentumSamples[index] ?? 0;
      const prevCurrent =
        smoothedSamples[Math.max(0, index - 1)] ?? sampleValue;
      const nextCurrent =
        smoothedSamples[Math.min(samples - 1, index + 1)] ?? sampleValue;
      const derivative = (nextCurrent - prevCurrent) * 0.5;
      const velocity = sampleValue - previousSample;
      const momentum = mix(
        previousMomentum,
        derivative,
        clamp(0.24 + (1 - smoothing) * 0.58, 0.18, 0.82),
      );
      momentumSamples[index] = momentum;
      let x = 0;
      let y = 0;

      switch (mode) {
        case 0: {
          const angle = t * TWO_PI;
          const radius =
            0.3 +
            Math.abs(sampleValue) * scale * (0.9 + mystery * 0.25) +
            signals.beatPulse * 0.04;
          x =
            centerX +
            Math.cos(angle) * radius +
            Math.sin(angle * 3 + mysteryPhase + signals.time * 0.4) * 0.025;
          y =
            centerY +
            Math.sin(angle) * radius +
            Math.cos(angle * 2 - mysteryPhase + signals.time * 0.3) * 0.025;
          break;
        }
        case 1: {
          const angle = t * TWO_PI + sampleValue * (0.6 + mystery * 0.4);
          const radius =
            0.24 +
            (0.22 + sampleValue * 0.16) *
              (1 + (signals.trebleAtt ?? 0) * 0.12) +
            Math.sin(signals.time * 0.2 + t * TWO_PI * 2) * 0.02;
          x = centerX + Math.cos(angle) * radius;
          y =
            centerY +
            Math.sin(angle) * radius * (0.6 + mystery * 0.5) +
            derivative * 0.1;
          break;
        }
        case 2: {
          const angle =
            t * TWO_PI * (1.5 + mystery * 1.5) + signals.time * 0.12;
          const radius =
            0.08 + t * 0.5 + sampleValue * scale * 0.45 + momentum * 0.1;
          x = centerX + Math.cos(angle) * radius;
          y = centerY + Math.sin(angle) * radius;
          break;
        }
        case 3: {
          const angle = t * TWO_PI;
          const lissajousX = Math.sin(angle * 2 + mysteryPhase);
          const lissajousY = Math.sin(angle * 3 + mysteryPhase * 1.7);
          x =
            centerX + lissajousX * (0.28 + Math.abs(sampleValue) * scale * 0.7);
          y =
            centerY + lissajousY * (0.2 + Math.abs(sampleValue) * scale * 0.9);
          break;
        }
        case 4: {
          x =
            centerX +
            sampleValue * scale * 1.5 +
            momentum * 0.42 +
            Math.sin(t * TWO_PI * 4 + signals.time * 0.25) * 0.03;
          y = 1.02 - t * 2.04 + derivative * 0.16;
          break;
        }
        case 5: {
          const angle = t * TWO_PI;
          const xAmp = 0.2 + Math.abs(sampleValue) * scale * 0.9;
          const yAmp = 0.14 + Math.abs(sampleValue) * scale * 0.95;
          x =
            centerX +
            Math.sin(angle * (2 + mystery)) * xAmp +
            Math.cos(angle * 4 + mysteryPhase) * 0.05;
          y =
            centerY +
            Math.sin(angle * (3 + mystery * 0.5) + Math.PI / 2) * yAmp +
            sampleValue * scale * 0.2;
          break;
        }
        case 6: {
          const band = sampleValue * scale * 1.3;
          x = -1.05 + t * 2.1;
          y =
            centerY +
            (index % 2 === 0 ? band : -band) +
            momentum * 0.3 +
            Math.sin(t * TWO_PI * 3 + signals.time * 0.2) * 0.02;
          break;
        }
        case 7: {
          const angle = t * TWO_PI;
          const petals = 3 + Math.round(clamp(mystery * 4, 0, 4));
          const radius =
            0.12 +
            (0.18 + Math.abs(sampleValue) * scale * 0.9) *
              Math.cos(petals * angle + mysteryPhase) +
            derivative * 0.08;
          x = centerX + Math.cos(angle) * radius;
          y = centerY + Math.sin(angle) * radius;
          break;
        }
        default:
          x = -1.1 + t * 2.2;
          y = centerY + sampleValue * scale * 1.7 + velocity * 0.12;
      }

      if (useProcedural && proceduralSamples && proceduralVelocities) {
        proceduralSamples[index] = sampleValue;
        proceduralVelocities[index] = momentum;
        continue;
      }

      const writeIndex = index * 3;
      positions[writeIndex] = x;
      positions[writeIndex + 1] = y;
      positions[writeIndex + 2] = 0.22 + momentum * 0.06;
    }
    this.syncLastWaveMomentum(momentumSamples, samples);

    const waveColor = color(
      this.state.wave_r ?? 1,
      this.state.wave_g ?? 1,
      this.state.wave_b ?? 1,
      this.state.wave_a ?? 0.9,
    );
    const finalWaveColor =
      (this.state.wave_brighten ?? 0) >= 0.5
        ? brightenWaveColor(waveColor)
        : waveColor;

    const additive = (this.state.wave_additive ?? 0) >= 0.5;
    let alpha = this.state.wave_a ?? 0.9;
    if (alphaByVolume) {
      if (Math.abs(modWaveAlphaEnd - modWaveAlphaStart) < 0.0001) {
        alpha *= signals.vol >= modWaveAlphaEnd ? 1 : 0;
      } else {
        alpha *= clamp(
          (signals.vol - modWaveAlphaStart) /
            (modWaveAlphaEnd - modWaveAlphaStart),
          0,
          1,
        );
      }
    }
    alpha = clamp(alpha, 0, additive ? 2 : 1);
    const thickness = clamp(this.state.wave_thick ?? 1, 1, 5);
    const pointSize = clamp((this.state.wave_thick ?? 1) * 3, 1, 12);
    const closed = drawMode === 'line' && isClosedMainWaveMode(mode);

    const procedural = useProcedural
      ? ({
          samples: proceduralSamples ?? [],
          velocities: proceduralVelocities ?? [],
          mode,
          centerX,
          centerY,
          scale,
          mystery,
          time: signals.time,
          beatPulse: signals.beatPulse,
          trebleAtt: signals.trebleAtt,
          color: finalWaveColor,
          alpha,
          additive,
          thickness,
        } satisfies MilkdropProceduralWaveVisual)
      : null;

    return {
      visual: {
        positions,
        color: finalWaveColor,
        alpha,
        thickness,
        drawMode,
        additive,
        pointSize,
        closed,
      } satisfies MilkdropWaveVisual,
      procedural,
    };
  }

  private buildCustomWaves(signals: MilkdropRuntimeSignals): {
    visual: MilkdropWaveVisual[];
    procedural: MilkdropProceduralCustomWaveVisual[];
  } {
    const waves: MilkdropWaveVisual[] = [];
    const proceduralWaves: MilkdropProceduralCustomWaveVisual[] = [];

    this.preset.ir.customWaves.forEach((wave, index) => {
      const persistent =
        this.customWaveState[index] ?? this.seedCustomWaveState(wave);
      const frameLocals = { ...persistent };
      this.runProgram(
        wave.programs.perFrame,
        this.createEnv(signals, frameLocals),
        frameLocals,
      );
      this.customWaveState[index] = { ...frameLocals };

      if ((frameLocals.enabled ?? 0) < 0.5) {
        return;
      }

      const sampleCount = clamp(
        Math.round((frameLocals.samples ?? 64) * this.detailScale),
        8,
        256,
      );
      const centerX = ((frameLocals.x ?? 0.5) - 0.5) * 2;
      const centerY = (0.5 - (frameLocals.y ?? 0.5)) * 2;
      const scaling = frameLocals.scaling ?? 1;
      const drawMode = (frameLocals.usedots ?? 0) >= 0.5 ? 'dots' : 'line';
      const additive = (frameLocals.additive ?? 0) >= 0.5;
      const waveColor = color(
        frameLocals.r ?? 1,
        frameLocals.g ?? 1,
        frameLocals.b ?? 1,
        frameLocals.a ?? 0.4,
      );
      const waveAlpha = clamp(frameLocals.a ?? 0.4, 0.02, 1);
      const useProcedural = this.supportsProceduralCustomWave(wave, drawMode);
      const positions = useProcedural ? [] : new Array<number>(sampleCount * 3);
      const proceduralSamples = useProcedural
        ? new Array<number>(sampleCount)
        : null;
      const pointLocals: MutableState = { ...frameLocals };

      for (let point = 0; point < sampleCount; point += 1) {
        const sample = point / Math.max(1, sampleCount - 1);
        const waveChannels = sampleCustomWaveChannels(signals, sample);
        const spectrumValue = waveChannels.value1;
        const baseY =
          centerY +
          (spectrumValue - 0.5) *
            0.55 *
            scaling *
            (1 + (frameLocals.mystery ?? 0) * 0.25);

        if (useProcedural && proceduralSamples) {
          proceduralSamples[point] = spectrumValue;
          continue;
        }

        Object.assign(pointLocals, frameLocals, {
          ...waveChannels,
          x: centerX + (-1 + sample * 2) * 0.85,
          y:
            (frameLocals.spectrum ?? 0) >= 0.5
              ? baseY
              : centerY +
                Math.sin(
                  sample * Math.PI * 2 * (1 + (frameLocals.mystery ?? 0)) +
                    signals.time,
                ) *
                  0.18 *
                  scaling,
        });
        pointLocals.rad = Math.sqrt(
          pointLocals.x * pointLocals.x + pointLocals.y * pointLocals.y,
        );
        pointLocals.ang = Math.atan2(pointLocals.y, pointLocals.x);
        this.runProgram(
          wave.programs.perPoint,
          this.createEnv(signals, pointLocals),
          pointLocals,
        );
        const writeIndex = point * 3;
        positions[writeIndex] = pointLocals.x;
        positions[writeIndex + 1] = pointLocals.y;
        positions[writeIndex + 2] = 0.28;
      }

      waves.push({
        positions,
        color: waveColor,
        alpha: waveAlpha,
        thickness: clamp(frameLocals.thick ?? 1, 1, 6),
        drawMode,
        additive,
        pointSize: clamp((frameLocals.thick ?? 1) * 3.2, 1, 14),
        spectrum: (frameLocals.spectrum ?? 0) >= 0.5,
      });

      if (useProcedural) {
        proceduralWaves.push({
          samples: proceduralSamples ?? [],
          spectrum: (frameLocals.spectrum ?? 0) >= 0.5,
          centerX,
          centerY,
          scaling,
          mystery: frameLocals.mystery ?? 0,
          time: signals.time,
          color: waveColor,
          alpha: waveAlpha,
          additive,
        });
      }
    });

    return {
      visual: waves,
      procedural: proceduralWaves,
    };
  }

  private transformMeshPoint(
    signals: MilkdropRuntimeSignals,
    gridX: number,
    gridY: number,
  ) {
    const cacheKey = this.getTransformCacheKey(gridX, gridY);
    const cached = this.frameTransformCache.get(cacheKey);
    if (cached) {
      return cached;
    }
    const local: MutableState = {
      x: gridX,
      y: gridY,
      rad: Math.sqrt(gridX * gridX + gridY * gridY),
      ang: Math.atan2(gridY, gridX),
      zoom: this.state.zoom ?? 1,
      zoomexp: this.state.zoomexp ?? 1,
      rot: this.state.rot ?? 0,
      warp: this.state.warp ?? 0,
      cx: this.state.cx ?? 0.5,
      cy: this.state.cy ?? 0.5,
      sx: this.state.sx ?? 1,
      sy: this.state.sy ?? 1,
      dx: this.state.dx ?? 0,
      dy: this.state.dy ?? 0,
    };
    this.runProgram(
      this.preset.ir.programs.perPixel,
      this.createEnv(signals, local),
      local,
    );

    const warpAnimSpeed = clamp(this.state.warpanimspeed ?? 1, 0, 4);
    const angle = local.ang + local.rot;
    const centerX = normalizeTransformCenter(local.cx ?? 0.5);
    const centerY = normalizeTransformCenter(local.cy ?? 0.5);
    const scaleX = local.sx ?? 1;
    const scaleY = local.sy ?? 1;
    const translateX = (local.dx ?? 0) * 2;
    const translateY = (local.dy ?? 0) * 2;
    const transformedX = (local.x - centerX) * scaleX + centerX + translateX;
    const transformedY = (local.y - centerY) * scaleY + centerY + translateY;
    const ripple =
      Math.sin(
        local.rad * 12 +
          signals.time * (0.6 + signals.trebleAtt) * (0.35 + warpAnimSpeed),
      ) *
      local.warp *
      0.08;
    const radiusNormalized = clamp(local.rad / Math.SQRT2, 0, 1);
    const zoomExponent = Math.max(local.zoomexp ?? 1, 0.0001);
    const zoomScale =
      Math.max(local.zoom ?? 1, 0.0001) **
      (zoomExponent ** (radiusNormalized * 2 - 1));
    const px = (transformedX + Math.cos(angle * 3) * ripple) * zoomScale;
    const py = (transformedY + Math.sin(angle * 4) * ripple) * zoomScale;
    const cos = Math.cos(local.rot);
    const sin = Math.sin(local.rot);
    const transformed = {
      x: px * cos - py * sin,
      y: px * sin + py * cos,
    };
    this.frameTransformCache.set(cacheKey, transformed);
    return transformed;
  }

  private buildMeshField(signals: MilkdropRuntimeSignals): MeshField {
    const density = this.getMeshDensity();
    const proceduralMeshPlan = this.getProceduralMeshDescriptorPlan();
    if (proceduralMeshPlan) {
      return {
        density,
        points: [],
        program: proceduralMeshPlan.fieldProgram,
        signals: this.buildProceduralFieldSignals(signals),
      };
    }

    const points = new Array<MeshFieldPoint>(density * density);

    for (let row = 0; row < density; row += 1) {
      for (let col = 0; col < density; col += 1) {
        const x = (col / Math.max(1, density - 1)) * 2 - 1;
        const y = (row / Math.max(1, density - 1)) * 2 - 1;
        const point = this.transformMeshPoint(signals, x, y);
        points[row * density + col] = {
          sourceX: x,
          sourceY: y,
          x: point.x,
          y: point.y,
        };
      }
    }

    return { density, points, program: null, signals: null };
  }

  private buildMesh(meshField: MeshField): MilkdropMeshVisual {
    const colorValue = color(
      this.state.mesh_r ?? 0.4,
      this.state.mesh_g ?? 0.6,
      this.state.mesh_b ?? 1,
      this.state.mesh_alpha ?? 0.2,
    );
    const alpha = clamp(this.state.mesh_alpha ?? 0.2, 0.02, 0.9);

    if (meshField.points.length === 0) {
      return {
        positions: [],
        color: colorValue,
        alpha,
      };
    }

    const positions = new Array<number>(
      meshField.density * Math.max(0, meshField.density - 1) * 12,
    );
    let writeIndex = 0;

    for (let row = 0; row < meshField.density; row += 1) {
      for (let col = 0; col < meshField.density; col += 1) {
        const index = row * meshField.density + col;
        const point = meshField.points[index];
        if (!point) {
          continue;
        }

        if (col + 1 < meshField.density) {
          const next = meshField.points[index + 1];
          if (next) {
            positions[writeIndex] = point.x;
            positions[writeIndex + 1] = point.y;
            positions[writeIndex + 2] = -0.25;
            positions[writeIndex + 3] = next.x;
            positions[writeIndex + 4] = next.y;
            positions[writeIndex + 5] = -0.25;
            writeIndex += 6;
          }
        }

        if (row + 1 < meshField.density) {
          const next = meshField.points[index + meshField.density];
          if (next) {
            positions[writeIndex] = point.x;
            positions[writeIndex + 1] = point.y;
            positions[writeIndex + 2] = -0.25;
            positions[writeIndex + 3] = next.x;
            positions[writeIndex + 4] = next.y;
            positions[writeIndex + 5] = -0.25;
            writeIndex += 6;
          }
        }
      }
    }

    return {
      positions: positions.slice(0, writeIndex),
      color: colorValue,
      alpha,
    };
  }

  private getProceduralMeshFieldVisual(
    meshField: MeshField,
  ): MilkdropProceduralMeshFieldVisual | null {
    if (!meshField.signals) {
      return null;
    }

    return {
      density: meshField.density,
      program: meshField.program,
      signals: meshField.signals,
      ...this.buildProceduralFieldTransform(),
    };
  }

  private getProceduralMotionVectorFieldVisual(
    meshField: MeshField,
  ): MilkdropProceduralMotionVectorFieldVisual | null {
    const proceduralMotionVectorPlan =
      this.getProceduralMotionVectorDescriptorPlan();
    if (!meshField.signals || !proceduralMotionVectorPlan) {
      return null;
    }

    const motionVectorContext = this.getMotionVectorDescriptorContext();
    if (!motionVectorContext) {
      return null;
    }

    const legacyLength = Math.max(0, this.state.mv_l ?? 0);
    const legacyCellScale =
      Math.min(
        2 / Math.max(motionVectorContext.countX, 1),
        2 / Math.max(motionVectorContext.countY, 1),
      ) * 0.625;

    return {
      countX: motionVectorContext.countX,
      countY: motionVectorContext.countY,
      sourceOffsetX: motionVectorContext.legacyControls
        ? clamp(this.state.mv_dx ?? 0, -1, 1)
        : 0,
      sourceOffsetY: motionVectorContext.legacyControls
        ? clamp(this.state.mv_dy ?? 0, -1, 1)
        : 0,
      explicitLength:
        legacyLength <= 1 ? legacyLength : legacyLength * legacyCellScale,
      legacyControls: motionVectorContext.legacyControls,
      program: proceduralMotionVectorPlan.fieldProgram,
      signals: meshField.signals,
      ...this.buildProceduralFieldTransform(),
    };
  }

  private buildGpuGeometryHints(
    meshField: MeshField,
  ): MilkdropGpuGeometryHints {
    return {
      mainWave: null,
      trailWaves: this.proceduralTrailWaves.slice(),
      customWaves: [],
      meshField: this.getProceduralMeshFieldVisual(meshField),
      motionVectorField: this.getProceduralMotionVectorFieldVisual(meshField),
    };
  }

  private buildMotionVectors(
    signals: MilkdropRuntimeSignals,
    meshField: MeshField,
  ): MilkdropMotionVectorVisual[] {
    const motionVectorContext = this.getMotionVectorDescriptorContext();
    if (!motionVectorContext) {
      this.lastMotionVectorField = null;
      return [];
    }

    if (this.getProceduralMotionVectorDescriptorPlan() && meshField.signals) {
      this.lastMotionVectorField = null;
      return [];
    }

    const {
      legacyControls: hasLegacyMotionVectorControls,
      countX,
      countY,
    } = motionVectorContext;
    const colorValue = color(
      this.state.mv_r ?? 1,
      this.state.mv_g ?? 1,
      this.state.mv_b ?? 1,
      this.state.mv_a ?? 0.35,
    );
    const alpha = clamp(
      this.state.mv_a ?? 0.35,
      hasLegacyMotionVectorControls ? 0 : 0.02,
      1,
    );
    const vectors: MilkdropMotionVectorVisual[] = [];
    const nextHistoryPoints = new Array<MotionVectorHistoryPoint>(
      countX * countY,
    );
    const previousField = this.lastMotionVectorField;
    const hasPerPixelPrograms =
      this.preset.ir.programs.perPixel.statements.length > 0;
    const legacyOffsetX = clamp(this.state.mv_dx ?? 0, -1, 1);
    const legacyOffsetY = clamp(this.state.mv_dy ?? 0, -1, 1);
    const legacyLength = Math.max(0, this.state.mv_l ?? 0);
    const legacyCellScale =
      Math.min(2 / Math.max(countX, 1), 2 / Math.max(countY, 1)) * 0.625;
    const explicitLegacyMagnitude =
      legacyLength <= 1 ? legacyLength : legacyLength * legacyCellScale;

    for (let row = 0; row < countY; row += 1) {
      for (let col = 0; col < countX; col += 1) {
        const sourceBaseX = countX === 1 ? 0 : (col / (countX - 1)) * 2 - 1;
        const sourceBaseY = countY === 1 ? 0 : (row / (countY - 1)) * 2 - 1;
        const sourceX = hasLegacyMotionVectorControls
          ? clamp(sourceBaseX + legacyOffsetX, -1, 1)
          : sourceBaseX;
        const sourceY = hasLegacyMotionVectorControls
          ? clamp(sourceBaseY + legacyOffsetY, -1, 1)
          : sourceBaseY;
        const index = row * countX + col;
        const currentPoint = this.transformMeshPoint(signals, sourceX, sourceY);
        nextHistoryPoints[index] = {
          sourceX,
          sourceY,
          x: currentPoint.x,
          y: currentPoint.y,
        };
        const previous = previousField?.points[index] ?? {
          sourceX,
          sourceY,
          x: sourceX,
          y: sourceY,
        };
        const sourceDx = (currentPoint.x - sourceX) * 1.35;
        const sourceDy = (currentPoint.y - sourceY) * 1.35;
        const historyDx = hasPerPixelPrograms
          ? (currentPoint.x - previous.x) * 1.1
          : 0;
        const historyDy = hasPerPixelPrograms
          ? (currentPoint.y - previous.y) * 1.1
          : 0;
        const baseDx = sourceDx + historyDx;
        const baseDy = sourceDy + historyDy;
        const baseMagnitude = Math.hypot(baseDx, baseDy);
        let dx = clamp(baseDx, -0.24, 0.24);
        let dy = clamp(baseDy, -0.24, 0.24);

        if (hasLegacyMotionVectorControls && explicitLegacyMagnitude > 0.0001) {
          if (baseMagnitude < 0.0001) {
            continue;
          }
          const normalizedX = baseDx / baseMagnitude;
          const normalizedY = baseDy / baseMagnitude;
          dx = normalizedX * explicitLegacyMagnitude;
          dy = normalizedY * explicitLegacyMagnitude;
        }

        const magnitude = Math.hypot(dx, dy);
        if (magnitude < 0.002) {
          continue;
        }
        vectors.push({
          positions: [
            currentPoint.x - dx * 0.45,
            currentPoint.y - dy * 0.45,
            0.18,
            currentPoint.x + dx,
            currentPoint.y + dy,
            0.18,
          ],
          color: colorValue,
          alpha: hasLegacyMotionVectorControls
            ? alpha
            : clamp(alpha * (0.75 + magnitude * 2.2), 0.02, 1),
          thickness: hasLegacyMotionVectorControls
            ? clamp(1 + magnitude * 10, 1, 4)
            : clamp(1 + magnitude * 18, 1, 4),
          additive: false,
        });
      }
    }

    this.lastMotionVectorField = {
      countX,
      countY,
      points: nextHistoryPoints,
    };
    return vectors;
  }

  private buildShapes(signals: MilkdropRuntimeSignals): MilkdropShapeVisual[] {
    const builtFromCustom = this.preset.ir.customShapes.map((shape, index) => {
      const locals = {
        ...(this.customShapeState[index] ?? this.seedCustomShapeState(shape)),
      };
      this.runProgram(
        shape.programs.perFrame,
        this.createEnv(signals, locals),
        locals,
      );
      this.customShapeState[index] = { ...locals };
      if ((locals.enabled ?? 0) < 0.5) {
        return null;
      }
      return this.shapeVisualFromLocals(
        `shape_${shape.index}`,
        locals,
        signals,
      );
    });

    const customShapeIndices = new Set(
      this.preset.ir.customShapes.map((shape) => shape.index),
    );
    const built = builtFromCustom.filter(
      (shape): shape is MilkdropShapeVisual => shape !== null,
    );

    for (let index = 1; index <= MAX_CUSTOM_SHAPE_SLOTS; index += 1) {
      if (customShapeIndices.has(index)) {
        continue;
      }
      const prefix = `shape_${index}`;
      if ((this.state[`${prefix}_enabled`] ?? 0) < 0.5) {
        continue;
      }
      built.push(
        this.shapeVisualFromLocals(
          prefix,
          {
            enabled: this.state[`${prefix}_enabled`] ?? 0,
            sides: this.state[`${prefix}_sides`] ?? 6,
            x: this.state[`${prefix}_x`] ?? 0.5,
            y: this.state[`${prefix}_y`] ?? 0.5,
            rad: this.state[`${prefix}_rad`] ?? 0.15,
            ang: this.state[`${prefix}_ang`] ?? 0,
            r: this.state[`${prefix}_r`] ?? 1,
            g: this.state[`${prefix}_g`] ?? 1,
            b: this.state[`${prefix}_b`] ?? 1,
            a: this.state[`${prefix}_a`] ?? 0.2,
            r2: this.state[`${prefix}_r2`] ?? 0,
            g2: this.state[`${prefix}_g2`] ?? 0,
            b2: this.state[`${prefix}_b2`] ?? 0,
            a2: this.state[`${prefix}_a2`] ?? 0,
            border_r: this.state[`${prefix}_border_r`] ?? 1,
            border_g: this.state[`${prefix}_border_g`] ?? 1,
            border_b: this.state[`${prefix}_border_b`] ?? 1,
            border_a: this.state[`${prefix}_border_a`] ?? 0.8,
            additive: this.state[`${prefix}_additive`] ?? 0,
            thickoutline: this.state[`${prefix}_thickoutline`] ?? 0,
          },
          signals,
        ),
      );
    }

    return built;
  }

  private shapeVisualFromLocals(
    key: string,
    locals: MutableState,
    signals: MilkdropRuntimeSignals,
  ): MilkdropShapeVisual {
    const secondaryAlpha = locals.a2 ?? 0;
    return {
      key,
      x: ((locals.x ?? 0.5) - 0.5) * 2,
      y: (0.5 - (locals.y ?? 0.5)) * 2,
      radius: clamp(
        (locals.rad ?? 0.15) * (1 + signals.beatPulse * 0.1),
        0.04,
        0.9,
      ),
      sides: Math.max(3, Math.round(locals.sides ?? 6)),
      rotation: (locals.ang ?? 0) + signals.time * 0.08,
      color: color(
        locals.r ?? 1,
        locals.g ?? 0.5,
        locals.b ?? 0.85,
        locals.a ?? 0.24,
      ),
      secondaryColor:
        secondaryAlpha > 0
          ? color(
              locals.r2 ?? 0,
              locals.g2 ?? 0,
              locals.b2 ?? 0,
              secondaryAlpha,
            )
          : null,
      borderColor: color(
        locals.border_r ?? 1,
        locals.border_g ?? 0.84,
        locals.border_b ?? 1,
        locals.border_a ?? 0.82,
      ),
      additive: (locals.additive ?? 0) >= 0.5,
      thickOutline: (locals.thickoutline ?? 0) >= 0.5,
    };
  }

  private buildBorders(): MilkdropBorderVisual[] {
    const borders: MilkdropBorderVisual[] = [];
    if ((this.state.ob_size ?? 0) > 0.001) {
      borders.push({
        key: 'outer',
        size: clamp(this.state.ob_size ?? 0, 0, 0.3),
        color: color(
          this.state.ob_r ?? 1,
          this.state.ob_g ?? 1,
          this.state.ob_b ?? 1,
          this.state.ob_a ?? 0.8,
        ),
        alpha: clamp(this.state.ob_a ?? 0.8, 0.02, 1),
        styled: (this.state.ob_border ?? 0) > 0.5,
      });
    }
    if ((this.state.ib_size ?? 0) > 0.001) {
      borders.push({
        key: 'inner',
        size: clamp(this.state.ib_size ?? 0, 0, 0.3),
        color: color(
          this.state.ib_r ?? 1,
          this.state.ib_g ?? 1,
          this.state.ib_b ?? 1,
          this.state.ib_a ?? 0.76,
        ),
        alpha: clamp(this.state.ib_a ?? 0.76, 0.02, 1),
        styled: (this.state.ib_border ?? 0) > 0.5,
      });
    }
    return borders;
  }

  private buildShaderControls(signals: MilkdropRuntimeSignals) {
    const env = this.createEnv(signals);
    return evaluateMilkdropShaderControlProgram({
      warp: this.preset.ir.shaderText.warp,
      comp: this.preset.ir.shaderText.comp,
      env,
    });
  }

  private buildPost(signals: MilkdropRuntimeSignals): MilkdropPostVisual {
    return {
      shaderEnabled: (this.state.shader ?? 1) > 0.5,
      textureWrap: (this.state.texture_wrap ?? 0) > 0.5,
      feedbackTexture: (this.state.feedback_texture ?? 0) > 0.5,
      outerBorderStyle: (this.state.ob_border ?? 0) > 0.5,
      innerBorderStyle: (this.state.ib_border ?? 0) > 0.5,
      shaderControls: this.buildShaderControls(signals),
      shaderPrograms: this.preset.ir.post.shaderPrograms,
      brighten: (this.state.brighten ?? 0) > 0.5,
      darken: (this.state.darken ?? 0) > 0.5,
      darkenCenter: (this.state.darken_center ?? 0) > 0.5,
      solarize: (this.state.solarize ?? 0) > 0.5,
      invert: (this.state.invert ?? 0) > 0.5,
      gammaAdj: clamp(this.state.gammaadj ?? 1, 0.25, 4),
      videoEchoEnabled: (this.state.video_echo_enabled ?? 0) > 0.5,
      videoEchoAlpha: clamp(this.state.video_echo_alpha ?? 0.18, 0, 1),
      videoEchoZoom: clamp(this.state.video_echo_zoom ?? 1, 0.85, 1.3),
      videoEchoOrientation: normalizeVideoEchoOrientation(
        this.state.video_echo_orientation ?? 0,
      ),
      warp: clamp(this.state.warp ?? 0.08, 0, 1),
    };
  }

  step(signals: MilkdropRuntimeSignals): MilkdropFrameState {
    this.frameTransformCache.clear();
    this.runProgram(this.preset.ir.programs.perFrame, this.createEnv(signals));

    const { visual: mainWave, procedural: proceduralMainWave } =
      this.buildMainWave(signals);
    if (this.lastWaveform) {
      this.trails.unshift(this.lastWaveform);
      this.trails = this.trails.slice(0, MAX_TRAILS);
    }
    if (this.lastProceduralWave) {
      this.proceduralTrailWaves.unshift(this.lastProceduralWave);
      this.proceduralTrailWaves = this.proceduralTrailWaves.slice(
        0,
        MAX_TRAILS,
      );
    }
    this.lastWaveform = mainWave;
    this.lastProceduralWave = proceduralMainWave;

    const meshField = this.buildMeshField(signals);
    const gpuGeometry = this.buildGpuGeometryHints(meshField);
    gpuGeometry.mainWave = proceduralMainWave;
    const customWaves = this.buildCustomWaves(signals);
    const mesh = this.buildMesh(meshField);
    const motionVectors = this.buildMotionVectors(signals, meshField);

    const frameState: MilkdropFrameState = {
      presetId: this.preset.source.id,
      title: this.preset.title,
      background: color(
        clamp((this.state.bg_r ?? 0.02) + signals.beatPulse * 0.015, 0, 1),
        clamp((this.state.bg_g ?? 0.03) + signals.midsAtt * 0.01, 0, 1),
        clamp((this.state.bg_b ?? 0.06) + signals.trebleAtt * 0.015, 0, 1),
      ),
      waveform: mainWave,
      mainWave,
      customWaves: customWaves.visual,
      trails: this.trails,
      mesh,
      shapes: this.buildShapes(signals),
      borders: this.buildBorders(),
      motionVectors,
      post: this.buildPost(signals),
      signals,
      variables: this.getStateSnapshot(),
      compatibility: this.preset.ir.compatibility,
      gpuGeometry,
    };
    gpuGeometry.customWaves = customWaves.procedural;
    this.frameTransformCache.clear();

    return frameState;
  }
}

export function createMilkdropVM(preset: MilkdropCompiledPreset) {
  return new MilkdropPresetVM(preset);
}
