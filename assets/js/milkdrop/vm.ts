import { DEFAULT_MILKDROP_STATE } from './compiler';
import { evaluateMilkdropExpression } from './expression';
import type {
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropProceduralWaveDescriptorPlan,
  MilkdropRuntimeSignals,
  MilkdropShapeDefinition,
  MilkdropVM,
  MilkdropWaveDefinition,
} from './types';
import {
  buildMilkdropFrameState,
  defaultSignalEnv,
} from './vm/frame-generation';
import {
  buildGpuGeometryHints,
  buildMesh,
  buildMeshField,
  buildMotionVectors,
} from './vm/geometry-builder';
import { buildPost } from './vm/post-effects-builder';
import { buildBorders, buildShapes } from './vm/shape-border-builder';
import {
  clamp,
  color,
  type GeometryBuilderState,
  hashSeed,
  MAX_CUSTOM_WAVE_SLOTS,
  type MutableState,
  type ShapeBuilderState,
  type WaveBuilderState,
} from './vm/shared';
import {
  buildCustomWaves,
  buildMainWave,
  commitMainWaveFrame,
} from './vm/wave-builder';
import {
  applyMilkdropWebGpuOptimizationFlags,
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlags,
} from './webgpu-optimization-flags';

const objectHasOwn = (
  Object as ObjectConstructor & {
    hasOwn(object: object, property: PropertyKey): boolean;
  }
).hasOwn;

class MilkdropPresetVM implements MilkdropVM {
  private preset: MilkdropCompiledPreset;
  private state: MutableState = {};
  private registers: MutableState = {};
  private readonly signalEnv: MutableState = {
    time: 0,
    frame: 0,
    fps: 60,
    bass: 0,
    mid: 0,
    mids: 0,
    treb: 0,
    treble: 0,
    bass_att: 0,
    mid_att: 0,
    mids_att: 0,
    treb_att: 0,
    treble_att: 0,
    bassAtt: 0,
    midsAtt: 0,
    trebleAtt: 0,
    beat: 0,
    beat_pulse: 0,
    beatPulse: 0,
    rms: 0,
    vol: 0,
    music: 0,
    weighted_energy: 0,
    progress: 0,
    pi: Math.PI,
    e: Math.E,
  };
  private lastPreparedSignalSource: MilkdropRuntimeSignals | null = null;
  private lastPreparedSignalFrame = Number.NaN;
  private lastPreparedSignalTime = Number.NaN;
  private randomState = 1;
  private detailScale = 1;
  private renderBackend: 'webgl' | 'webgpu' = 'webgl';
  private webgpuOptimizationFlags: MilkdropWebGpuOptimizationFlags = {
    ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  };
  private readonly waveState: WaveBuilderState = {
    trails: [],
    lastWaveform: null,
    lastProceduralWave: null,
    lastWaveSamples: [],
    lastWaveMomentum: [],
    customWaveLocals: [],
    customWaveFrameIndex: 0,
    customWaveVisualFrames: [[], []],
    proceduralCustomWaveFrames: [[], []],
    proceduralTrailWaves: [],
    channelSample: {
      sample: 0,
      value: 0,
      value1: 0,
      value2: 0,
    },
    buffers: {
      liveSamples: [],
      previousSamples: [],
      smoothedSamples: [],
      momentumSamples: [],
    },
  };
  private readonly geometryState: GeometryBuilderState = {
    lastMotionVectorField: null,
    frameTransformCache: new Map<number, { x: number; y: number }>(),
    pointScratch: {},
    meshPoints: [],
    motionVectorFrameIndex: 0,
    motionVectorVisualFrames: [[], []],
    motionVectorHistoryBuffers: [[], []],
    motionVectorHistoryBufferIndex: 0,
  };
  private readonly shapeState: ShapeBuilderState = {
    customShapeLocals: [],
  };

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
    this.registers = Object.create(this.state) as MutableState;
    for (let index = 1; index <= 32; index += 1) {
      this.registers[`q${index}`] = 0;
    }
    for (let index = 1; index <= MAX_CUSTOM_WAVE_SLOTS; index += 1) {
      this.registers[`t${index}`] = 0;
    }
    this.randomState =
      hashSeed(this.preset.source.id || this.preset.title || 'milkdrop') || 1;
    this.waveState.trails = [];
    this.waveState.lastWaveform = null;
    this.waveState.lastProceduralWave = null;
    this.waveState.lastWaveSamples = this.waveState.buffers.smoothedSamples;
    this.waveState.lastWaveMomentum = this.waveState.buffers.momentumSamples;
    this.waveState.customWaveLocals = this.preset.ir.customWaves.map((wave) =>
      this.seedCustomWaveState(wave),
    );
    this.waveState.customWaveFrameIndex = 0;
    this.waveState.customWaveVisualFrames[0].length = 0;
    this.waveState.customWaveVisualFrames[1].length = 0;
    this.waveState.proceduralCustomWaveFrames[0].length = 0;
    this.waveState.proceduralCustomWaveFrames[1].length = 0;
    this.shapeState.customShapeLocals = this.preset.ir.customShapes.map(
      (shape) => this.seedCustomShapeState(shape),
    );
    this.waveState.proceduralTrailWaves = [];
    this.geometryState.lastMotionVectorField = null;
    this.geometryState.motionVectorFrameIndex = 0;
    this.geometryState.motionVectorVisualFrames[0].length = 0;
    this.geometryState.motionVectorVisualFrames[1].length = 0;
    this.waveState.buffers.liveSamples.length = 0;
    this.waveState.buffers.previousSamples.length = 0;
    this.waveState.buffers.smoothedSamples.length = 0;
    this.waveState.buffers.momentumSamples.length = 0;
    this.geometryState.frameTransformCache.clear();
    Object.setPrototypeOf(this.signalEnv, this.registers);
    this.lastPreparedSignalSource = null;
    this.lastPreparedSignalFrame = Number.NaN;
    this.lastPreparedSignalTime = Number.NaN;

    const zeroSignals = defaultSignalEnv();
    this.runProgram(this.preset.ir.programs.init, this.createEnv(zeroSignals));
    this.preset.ir.customWaves.forEach((wave, index) => {
      this.runProgram(
        wave.programs.init,
        this.createEnv(
          zeroSignals,
          this.waveState.customWaveLocals[index] ?? {},
        ),
        this.waveState.customWaveLocals[index],
      );
    });
    this.preset.ir.customShapes.forEach((shape, index) => {
      this.runProgram(
        shape.programs.init,
        this.createEnv(
          zeroSignals,
          this.shapeState.customShapeLocals[index] ?? {},
        ),
        this.shapeState.customShapeLocals[index],
      );
    });
  }

  getStateSnapshot() {
    const snapshot: MutableState = {
      ...this.state,
      ...this.registers,
    };
    for (
      let index = 0;
      index < this.waveState.customWaveLocals.length;
      index += 1
    ) {
      const waveState = this.waveState.customWaveLocals[index];
      if (!waveState) {
        continue;
      }
      for (const key in waveState) {
        if (objectHasOwn(waveState, key)) {
          snapshot[`wave${index + 1}_${key}`] = waveState[key] ?? 0;
        }
      }
    }
    for (
      let index = 0;
      index < this.shapeState.customShapeLocals.length;
      index += 1
    ) {
      const shapeState = this.shapeState.customShapeLocals[index];
      if (!shapeState) {
        continue;
      }
      for (const key in shapeState) {
        if (objectHasOwn(shapeState, key)) {
          snapshot[`shape${index + 1}_${key}`] = shapeState[key] ?? 0;
        }
      }
    }
    return snapshot;
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
      instance: 0,
      textured: shape.fields.textured ?? this.state[`${prefix}_textured`] ?? 0,
      tex_zoom: shape.fields.tex_zoom ?? this.state[`${prefix}_tex_zoom`] ?? 1,
      tex_ang: shape.fields.tex_ang ?? this.state[`${prefix}_tex_ang`] ?? 0,
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

  private prepareSignalEnv(signals: MilkdropRuntimeSignals) {
    if (
      this.lastPreparedSignalSource === signals &&
      this.lastPreparedSignalFrame === signals.frame &&
      this.lastPreparedSignalTime === signals.time
    ) {
      return;
    }

    this.lastPreparedSignalSource = signals;
    this.lastPreparedSignalFrame = signals.frame;
    this.lastPreparedSignalTime = signals.time;

    this.signalEnv.time = signals.time;
    this.signalEnv.frame = signals.frame;
    this.signalEnv.fps = signals.fps;
    this.signalEnv.bass = signals.bass;
    this.signalEnv.mid = signals.mid;
    this.signalEnv.mids = signals.mids;
    this.signalEnv.treb = signals.treb;
    this.signalEnv.treble = signals.treble;
    this.signalEnv.bass_att = signals.bass_att;
    this.signalEnv.mid_att = signals.mid_att;
    this.signalEnv.mids_att = signals.mids_att;
    this.signalEnv.treb_att = signals.treb_att;
    this.signalEnv.treble_att = signals.treble_att;
    this.signalEnv.bassAtt = signals.bassAtt;
    this.signalEnv.midsAtt = signals.midsAtt;
    this.signalEnv.trebleAtt = signals.trebleAtt;
    this.signalEnv.beat = signals.beat;
    this.signalEnv.beat_pulse = signals.beat_pulse;
    this.signalEnv.beatPulse = signals.beatPulse;
    this.signalEnv.rms = signals.rms;
    this.signalEnv.vol = signals.vol;
    this.signalEnv.music = signals.music;
    this.signalEnv.weighted_energy = signals.weightedEnergy;
    this.signalEnv.progress = signals.frame;
  }

  private createEnv(
    signals: MilkdropRuntimeSignals,
    extra: Record<string, number> = {},
    options: {
      reuseExtraAsEnv?: boolean;
    } = {},
  ) {
    this.prepareSignalEnv(signals);
    if (options.reuseExtraAsEnv) {
      Object.setPrototypeOf(extra, this.signalEnv);
      return extra as MutableState;
    }
    const env = Object.create(this.signalEnv) as MutableState;
    Object.assign(env, extra);
    return env;
  }

  private createFlatEnv(
    signals: MilkdropRuntimeSignals,
    extra: Record<string, number> = {},
  ) {
    this.prepareSignalEnv(signals);
    const env = Object.create(this.signalEnv) as MutableState;
    Object.assign(env, this.state, this.registers, this.signalEnv, extra);
    return env;
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
    if (locals && objectHasOwn(locals, target)) {
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
    for (let index = 0; index < block.statements.length; index += 1) {
      const statement = block.statements[index];
      if (!statement) {
        continue;
      }
      const value = evaluateMilkdropExpression(statement.expression, env, {
        nextRandom: this.nextRandom,
      });
      this.setValue(statement.target, value, locals);
      env[statement.target] = value;
    }
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

  private getProceduralCustomWaveDescriptor(
    wave: MilkdropWaveDefinition,
    drawMode: 'line' | 'dots',
  ): MilkdropProceduralWaveDescriptorPlan | null {
    const plan = this.getEffectiveWebGpuDescriptorPlan();
    if (this.renderBackend !== 'webgpu' || drawMode !== 'line') {
      return null;
    }
    return (
      plan?.proceduralWaves.find(
        (entry) =>
          entry.target === 'custom-wave' && entry.slotIndex === wave.index,
      ) ?? null
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

  step(signals: MilkdropRuntimeSignals): MilkdropFrameState {
    this.geometryState.frameTransformCache.clear();
    this.runProgram(this.preset.ir.programs.perFrame, this.createEnv(signals));

    const { visual: mainWave, procedural: proceduralMainWave } = buildMainWave({
      state: this.state,
      signals,
      detailScale: this.detailScale,
      waveState: this.waveState,
      supportsProceduralWave: this.supportsProceduralWave.bind(this),
    });
    commitMainWaveFrame({
      waveState: this.waveState,
      mainWave,
      proceduralMainWave,
    });

    const proceduralMeshPlan = this.getProceduralMeshDescriptorPlan();
    const proceduralMotionVectorPlan =
      this.getProceduralMotionVectorDescriptorPlan();
    const meshField = buildMeshField({
      state: this.state,
      preset: this.preset,
      signals,
      detailScale: this.detailScale,
      geometryState: this.geometryState,
      runProgram: this.runProgram.bind(this),
      createEnv: this.createEnv.bind(this),
      proceduralMeshPlan,
    });
    const gpuGeometry = buildGpuGeometryHints({
      state: this.state,
      preset: this.preset,
      meshField,
      trailWaves: this.waveState.proceduralTrailWaves,
      signals,
      detailScale: this.detailScale,
      proceduralMotionVectorPlan,
    });
    gpuGeometry.mainWave = proceduralMainWave;

    const customWaves = buildCustomWaves({
      preset: this.preset,
      signals,
      detailScale: this.detailScale,
      waveState: this.waveState,
      runProgram: this.runProgram.bind(this),
      createEnv: this.createEnv.bind(this),
      seedCustomWaveState: this.seedCustomWaveState.bind(this),
      getProceduralCustomWaveDescriptor:
        this.getProceduralCustomWaveDescriptor.bind(this),
    });
    const mesh = buildMesh({
      state: this.state,
      meshField,
    });
    const motionVectors = buildMotionVectors({
      state: this.state,
      preset: this.preset,
      signals,
      meshField,
      geometryState: this.geometryState,
      runProgram: this.runProgram.bind(this),
      createEnv: this.createEnv.bind(this),
      proceduralMotionVectorPlan,
    });
    const shapes = buildShapes({
      preset: this.preset,
      state: this.state,
      signals,
      shapeState: this.shapeState,
      runProgram: this.runProgram.bind(this),
      createEnv: this.createEnv.bind(this),
      seedCustomShapeState: this.seedCustomShapeState.bind(this),
    });
    const borders = buildBorders(this.state);
    const post = buildPost({
      preset: this.preset,
      state: this.state,
      signals,
      createEnv: this.createFlatEnv.bind(this),
    });

    let variablesSnapshot: Record<string, number> | null = null;
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
      trails: this.waveState.trails,
      mesh,
      shapes,
      borders,
      motionVectors,
      post,
      signals,
      variables: {} as Record<string, number>,
      compatibility: this.preset.ir.compatibility,
      gpuGeometry,
    });
    Object.defineProperty(frameState, 'variables', {
      configurable: true,
      enumerable: true,
      get: () => {
        if (variablesSnapshot === null) {
          variablesSnapshot = this.getStateSnapshot();
        }
        return variablesSnapshot;
      },
    });
    gpuGeometry.customWaves = customWaves.procedural;
    this.geometryState.frameTransformCache.clear();

    return frameState;
  }
}

export function createMilkdropVM(
  preset: MilkdropCompiledPreset,
  webgpuOptimizationFlags: MilkdropWebGpuOptimizationFlags = DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
) {
  return new MilkdropPresetVM(preset, webgpuOptimizationFlags);
}
