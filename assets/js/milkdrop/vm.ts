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
import {
  buildMainWaveFrame,
  buildMilkdropFrameState,
  defaultSignalEnv,
} from './vm/frame-generation';
import {
  applyMilkdropWebGpuOptimizationFlags,
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlags,
} from './webgpu-optimization-flags';

const MAX_TRAILS = 5;
const MAX_CUSTOM_WAVE_SLOTS = 32;
const MAX_CUSTOM_SHAPE_SLOTS = 32;
const MAX_MOTION_VECTOR_COLUMNS = 96;
const MAX_MOTION_VECTOR_ROWS = 72;
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

function sampleFrequencyData(signals: MilkdropRuntimeSignals, t: number) {
  const sampleIndex = Math.min(
    signals.frequencyData.length - 1,
    Math.max(0, Math.round(t * Math.max(0, signals.frequencyData.length - 1))),
  );
  return (signals.frequencyData[sampleIndex] ?? 0) / 255;
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
  private webgpuOptimizationFlags: MilkdropWebGpuOptimizationFlags = {
    ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  };
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

  constructor(
    preset: MilkdropCompiledPreset,
    webgpuOptimizationFlags: MilkdropWebGpuOptimizationFlags = DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  ) {
    this.preset = preset;
    this.webgpuOptimizationFlags = { ...webgpuOptimizationFlags };
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

  private getEffectiveWebGpuDescriptorPlan() {
    return this.renderBackend === 'webgpu'
      ? applyMilkdropWebGpuOptimizationFlags(
          this.preset.ir.compatibility.gpuDescriptorPlans.webgpu,
          this.webgpuOptimizationFlags,
        )
      : null;
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

  private supportsProceduralWave(drawMode: 'line' | 'dots') {
    const plan = this.getEffectiveWebGpuDescriptorPlan();
    return (
      this.renderBackend === 'webgpu' &&
      drawMode === 'line' &&
      Boolean(
        plan?.proceduralWaves.some((entry) => entry.target === 'main-wave'),
      )
    );
  }

  private supportsProceduralCustomWave(
    wave: MilkdropWaveDefinition,
    drawMode: 'line' | 'dots',
  ) {
    const plan = this.getEffectiveWebGpuDescriptorPlan();
    return (
      this.renderBackend === 'webgpu' &&
      drawMode === 'line' &&
      wave.programs.perPoint.statements.length === 0 &&
      Boolean(
        plan?.proceduralWaves.some(
          (entry) =>
            entry.target === 'custom-wave' && entry.slotIndex === wave.index,
        ),
      )
    );
  }

  private getProceduralMeshDescriptorPlan() {
    return this.getEffectiveWebGpuDescriptorPlan()?.proceduralMesh ?? null;
  }

  private getProceduralMotionVectorDescriptorPlan() {
    return (
      this.getEffectiveWebGpuDescriptorPlan()?.proceduralMotionVectors ?? null
    );
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
    const drawMode = (this.state.wave_usedots ?? 0) >= 0.5 ? 'dots' : 'line';
    const useProcedural = this.supportsProceduralWave(drawMode);
    const built = buildMainWaveFrame({
      state: this.state,
      signals,
      detailScale: this.detailScale,
      previousSamples: this.lastWaveSamples,
      previousMomentum: this.lastWaveMomentum,
      useProcedural,
    });
    this.syncLastWaveSamples(built.nextSamples, built.nextSamples.length);
    this.syncLastWaveMomentum(built.nextMomentum, built.nextMomentum.length);
    return {
      visual: built.visual,
      procedural: built.procedural,
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

    const frameState: MilkdropFrameState = buildMilkdropFrameState({
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
    });
    gpuGeometry.customWaves = customWaves.procedural;
    this.frameTransformCache.clear();

    return frameState;
  }
}

export function createMilkdropVM(
  preset: MilkdropCompiledPreset,
  webgpuOptimizationFlags: MilkdropWebGpuOptimizationFlags = DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
) {
  return new MilkdropPresetVM(preset, webgpuOptimizationFlags);
}
