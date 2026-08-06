/* global GPUDevice */

import { DEFAULT_MILKDROP_STATE } from './compiler';
import {
  compileMilkdropProgram,
  MILKDROP_GMEGABUF_SIZE,
  MILKDROP_MEGABUF_SIZE,
} from './expression-jit.ts';
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
  getMeshDensity,
  resetFrameTransformCache,
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
import { createGpuVmRunner } from './vm-gpu';
import {
  applyMilkdropWebGpuOptimizationFlags,
  DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  type MilkdropWebGpuOptimizationFlags,
} from './webgpu-optimization-flags';
import { deriveMilkdropViewportSignalValues } from './wgsl-signal-layout.ts';

const objectHasOwn = (
  Object as ObjectConstructor & {
    hasOwn(object: object, property: PropertyKey): boolean;
  }
).hasOwn;

/**
 * `gmegabuf` is shared across presets in MilkDrop, so it lives outside the VM
 * instance. It is allocated on first use because most presets never touch it.
 */
let sharedGlobalBuffer: Float32Array | null = null;
const EMPTY_BUFFER = new Float32Array(0);

function resolveGlobalBuffer(preset: MilkdropCompiledPreset) {
  if (!preset.source.raw.includes('gmegabuf')) {
    return sharedGlobalBuffer ?? EMPTY_BUFFER;
  }
  sharedGlobalBuffer ??= new Float32Array(MILKDROP_GMEGABUF_SIZE);
  return sharedGlobalBuffer;
}

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
  private lastPreparedSignalSource: MilkdropRuntimeSignals | null = null;
  private lastPreparedSignalFrame = Number.NaN;
  private lastPreparedSignalTime = Number.NaN;
  private randomState = 1;
  private readonly megabuf = new Float32Array(MILKDROP_MEGABUF_SIZE);
  private gmegabuf: Float32Array = EMPTY_BUFFER;
  private detailScale = 1;
  private renderBackend: 'webgl' | 'webgpu' = 'webgl';
  private webgpuOptimizationFlags: MilkdropWebGpuOptimizationFlags = {
    ...DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
  };
  private gpuRunner = createGpuVmRunner();
  private readonly waveState: WaveBuilderState = {
    trails: [],
    lastWaveform: null,
    lastProceduralWave: null,
    lastWaveSamples: new Float32Array(0),
    lastWaveMomentum: new Float32Array(0),
    mainWaveFrameIndex: -1,
    mainWaveVisualFrames: [],
    proceduralMainWaveFrames: [],
    customWaveLocals: [],
    customWaveFrameIndex: 0,
    customWaveVisualFrames: [[], []],
    proceduralCustomWaveFrames: [[], []],
    customWaveVisualPool: [],
    proceduralCustomWavePool: [],
    proceduralTrailWaves: [],
    channelSample: {
      sample: 0,
      value: 0,
      value1: 0,
      value2: 0,
    },
    buffers: {
      liveSamples: new Float32Array(0),
      previousSamples: new Float32Array(0),
      smoothedSamples: new Float32Array(0),
      momentumSamples: new Float32Array(0),
    },
    pointLocalsScratch: {},
  };
  private readonly geometryState: GeometryBuilderState = {
    lastMotionVectorField: null,
    frameTransformCache: new Map<number, { x: number; y: number }>(),
    transformCachePool: [],
    transformCachePoolIndex: 0,
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
  private frameVariablesSnapshot: Record<string, number> | null = null;
  private readonly frameCommonVars: Record<string, number | undefined> = {};

  /** Resolves `wave${slot}_${key}` / `shape${slot}_${key}` composite keys that
   * exist only in the synthesized snapshot, returning the owning locals object
   * and key without materializing the snapshot itself. */
  private parseFrameLocalKey(prop: string) {
    const prefix = prop.startsWith('wave')
      ? 'wave'
      : prop.startsWith('shape')
        ? 'shape'
        : null;
    if (prefix === null) {
      return null;
    }
    const localsList =
      prefix === 'wave'
        ? this.waveState.customWaveLocals
        : this.shapeState.customShapeLocals;
    const separatorIndex = prop.indexOf('_', prefix.length);
    if (separatorIndex < 0) {
      return null;
    }
    const rawSlot = prop.slice(prefix.length, separatorIndex);
    const localKey = prop.slice(separatorIndex + 1);
    if (rawSlot.length === 0 || localKey.length === 0) {
      return null;
    }
    const slot = Number(rawSlot);
    if (!Number.isInteger(slot) || slot < 1) {
      return null;
    }
    const locals = localsList[slot - 1];
    if (!locals) {
      return null;
    }
    return { locals, localKey };
  }

  /** Resolves a frame variable directly against the live state/register/local
   * objects. This is the per-frame hot path: the feedback managers read
   * `q1..q32`/`t1..t32` and `blur*_min/max` here, so the large lazy snapshot is
   * never materialized for steady-state frames. The snapshot stays as a
   * fallback for whole-object enumeration (`ownKeys`/`getOwnPropertyDescriptor`). */
  private resolveFrameVariable(prop: string): number | undefined {
    if (prop in this.frameCommonVars) {
      return this.frameCommonVars[prop];
    }
    const parsed = this.parseFrameLocalKey(prop);
    if (parsed) {
      const { locals, localKey } = parsed;
      return localKey in locals ? (locals[localKey] ?? 0) : undefined;
    }
    // `registers` is `Object.create(state)`, so `in` covers state keys and
    // reads resolve through the prototype chain exactly like `{...state,
    // ...registers}`.
    if (prop in this.registers) {
      return this.registers[prop];
    }
    return undefined;
  }

  private readonly variablesProxy = new Proxy({} as Record<string, number>, {
    get: (_target, prop) => {
      if (typeof prop !== 'string') {
        return undefined;
      }
      if (this.frameVariablesSnapshot === null) {
        return this.resolveFrameVariable(prop);
      }
      return this.frameVariablesSnapshot[prop];
    },
    has: (_target, prop) => {
      if (typeof prop !== 'string') {
        return false;
      }
      if (prop in this.frameCommonVars) {
        return this.frameCommonVars[prop] !== undefined;
      }
      const parsed = this.parseFrameLocalKey(prop);
      if (parsed) {
        return parsed.localKey in parsed.locals;
      }
      return prop in this.registers;
    },
    ownKeys: () => {
      if (this.frameVariablesSnapshot === null) {
        this.frameVariablesSnapshot = this.getStateSnapshot();
      }
      return Reflect.ownKeys(this.frameVariablesSnapshot);
    },
    getOwnPropertyDescriptor: (_target, prop) => {
      if (this.frameVariablesSnapshot === null) {
        this.frameVariablesSnapshot = this.getStateSnapshot();
      }
      return Reflect.getOwnPropertyDescriptor(
        this.frameVariablesSnapshot,
        prop,
      );
    },
  });
  private readonly frameCallbacks = this.createFrameCallbacks();

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

  setWebGpuOptimizationFlags(flags: MilkdropWebGpuOptimizationFlags) {
    this.webgpuOptimizationFlags = { ...flags };
  }

  setGpuDevice(device: GPUDevice | null) {
    if (!device || !this.webgpuOptimizationFlags.gpuComputeVM) {
      this.gpuRunner.dispose();
      return;
    }
    this.gpuRunner.init(
      device,
      this.preset.ir.programs.perFrame,
      this.state,
      this.randomState,
    );
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
    this.gmegabuf = resolveGlobalBuffer(this.preset);
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
    this.waveState.mainWaveFrameIndex = -1;
    this.waveState.customWaveLocals = this.preset.ir.customWaves.map((wave) =>
      this.seedCustomWaveState(wave),
    );
    this.waveState.customWaveFrameIndex = 0;
    this.waveState.customWaveVisualFrames[0].length = 0;
    this.waveState.customWaveVisualFrames[1].length = 0;
    this.waveState.proceduralCustomWaveFrames[0].length = 0;
    this.waveState.proceduralCustomWaveFrames[1].length = 0;
    this.waveState.customWaveVisualPool.length = 0;
    this.waveState.proceduralCustomWavePool.length = 0;
    this.shapeState.customShapeLocals = this.preset.ir.customShapes.map(
      (shape) => this.seedCustomShapeState(shape),
    );
    this.waveState.proceduralTrailWaves = [];
    this.waveState.pointLocalsScratch = {};
    this.geometryState.lastMotionVectorField = null;
    this.geometryState.motionVectorFrameIndex = 0;
    this.geometryState.motionVectorVisualFrames[0].length = 0;
    this.geometryState.motionVectorVisualFrames[1].length = 0;
    this.waveState.buffers.liveSamples = new Float32Array(0);
    this.waveState.buffers.previousSamples = new Float32Array(0);
    this.waveState.buffers.smoothedSamples = new Float32Array(0);
    this.waveState.buffers.momentumSamples = new Float32Array(0);
    this.waveState.lastWaveSamples = this.waveState.buffers.smoothedSamples;
    this.waveState.lastWaveMomentum = this.waveState.buffers.momentumSamples;
    resetFrameTransformCache(this.geometryState);
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
    return this.randomState / 0x100000000;
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
      ...Object.fromEntries(
        Array.from({ length: MAX_CUSTOM_WAVE_SLOTS }, (_, index) => [
          `t${index + 1}`,
          0,
        ]),
      ),
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
      num_inst: shape.fields.num_inst ?? this.state[`${prefix}_num_inst`] ?? 1,
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
    this.signalEnv.aspect = signals.aspect ?? 1;
    deriveMilkdropViewportSignalValues(signals, this.signalEnv);
    const meshDensity = getMeshDensity(this.state, this.detailScale);
    this.signalEnv.meshx = meshDensity;
    this.signalEnv.meshy = meshDensity;
    this.signalEnv.bass = signals.bass;
    this.signalEnv.mid = signals.mid;
    this.signalEnv.med = signals.mid;
    this.signalEnv.mids = signals.mids;
    this.signalEnv.treb = signals.treb;
    this.signalEnv.att = signals.treb;
    this.signalEnv.treble = signals.treble;
    this.signalEnv.bass_att = signals.bass_att;
    this.signalEnv.mid_att = signals.mid_att;
    this.signalEnv.med_att = signals.mid_att;
    this.signalEnv.mids_att = signals.mids_att;
    this.signalEnv.treb_att = signals.treb_att;
    this.signalEnv.treble_att = signals.treble_att;
    this.signalEnv.bassAtt = signals.bassAtt;
    this.signalEnv.midsAtt = signals.midsAtt;
    this.signalEnv.trebleAtt = signals.trebleAtt;
    this.signalEnv.beat = signals.beat;
    this.signalEnv.beat_pulse = signals.beat_pulse;
    this.signalEnv.beatPulse = signals.beatPulse;
    this.signalEnv.beatBass = signals.beatBass;
    this.signalEnv.beatMid = signals.beatMid;
    this.signalEnv.beatTreble = signals.beatTreble;
    this.signalEnv.beat_bass = signals.beatBass;
    this.signalEnv.beat_mid = signals.beatMid;
    this.signalEnv.beat_treb = signals.beatTreble;
    this.signalEnv.bandFlux = signals.bandFlux;
    this.signalEnv.rms = signals.rms;
    this.signalEnv.vol = signals.vol;
    this.signalEnv.music = signals.music;
    this.signalEnv.weighted_energy = signals.weightedEnergy;
    this.signalEnv.progress = signals.frame;

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
        this.signalEnv[`spec_${i}`] = count > 0 ? sum / count / 255 : 0;
      }
    } else {
      for (let i = 0; i < 32; i += 1) {
        this.signalEnv[`spec_${i}`] = 0;
      }
    }
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

  private runProgram(
    block: MilkdropCompiledPreset['ir']['programs']['init'],
    env: MutableState,
    locals: MutableState | null = null,
  ) {
    compileMilkdropProgram(block)(
      env as Record<string, number>,
      this.state as Record<string, number>,
      this.registers as Record<string, number>,
      (locals ?? null) as Record<string, number> | null,
      this.megabuf,
      this.gmegabuf,
      this.nextRandom,
    );
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

  private createFrameCallbacks() {
    return {
      supportsProceduralWave: this.supportsProceduralWave.bind(this),
      runProgram: this.runProgram.bind(this),
      createEnv: this.createEnv.bind(this),
      createFlatEnv: this.createFlatEnv.bind(this),
      seedCustomWaveState: this.seedCustomWaveState.bind(this),
      seedCustomShapeState: this.seedCustomShapeState.bind(this),
      getProceduralCustomWaveDescriptor:
        this.getProceduralCustomWaveDescriptor.bind(this),
    };
  }

  async stepAsync(
    signals: MilkdropRuntimeSignals,
  ): Promise<MilkdropFrameState> {
    if (
      this.renderBackend === 'webgpu' &&
      this.webgpuOptimizationFlags.gpuComputeVM &&
      this.gpuRunner.isInitialized()
    ) {
      const result = await this.gpuRunner.dispatch(signals);
      Object.assign(this.state, result.state);
      this.randomState = result.randomState;
      this.prepareSignalEnv(signals);
    } else {
      this.runProgram(
        this.preset.ir.programs.perFrame,
        this.createEnv(signals),
      );
    }
    return this.buildFrame(signals);
  }

  step(signals: MilkdropRuntimeSignals): MilkdropFrameState {
    resetFrameTransformCache(this.geometryState);
    this.runProgram(this.preset.ir.programs.perFrame, this.createEnv(signals));

    return this.buildFrame(signals);
  }

  private buildFrame(signals: MilkdropRuntimeSignals): MilkdropFrameState {
    const {
      supportsProceduralWave,
      runProgram,
      createEnv,
      createFlatEnv,
      seedCustomWaveState,
      seedCustomShapeState,
      getProceduralCustomWaveDescriptor,
    } = this.frameCallbacks;
    const { visual: mainWave, procedural: proceduralMainWave } = buildMainWave({
      state: this.state,
      signals,
      detailScale: this.detailScale,
      waveState: this.waveState,
      supportsProceduralWave,
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
      runProgram,
      createEnv,
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
      runProgram,
      createEnv,
      seedCustomWaveState,
      getProceduralCustomWaveDescriptor,
    });
    const mesh = buildMesh({
      state: this.state,
      meshField,
      geometryState: this.geometryState,
    });
    const motionVectors = buildMotionVectors({
      state: this.state,
      preset: this.preset,
      signals,
      meshField,
      geometryState: this.geometryState,
      runProgram,
      createEnv,
      proceduralMotionVectorPlan,
    });
    const shapes = buildShapes({
      preset: this.preset,
      state: this.state,
      signals,
      shapeState: this.shapeState,
      runProgram,
      createEnv,
      seedCustomShapeState,
    });
    const borders = buildBorders(this.state);
    const post = buildPost({
      preset: this.preset,
      state: this.state,
      signals,
      createEnv: createFlatEnv,
    });

    this.frameVariablesSnapshot = null;
    this.frameCommonVars.mv_r = this.state.mv_r;
    this.frameCommonVars.mv_g = this.state.mv_g;
    this.frameCommonVars.mv_b = this.state.mv_b;
    this.frameCommonVars.mv_a = this.state.mv_a;

    const frameState: MilkdropFrameState = buildMilkdropFrameState({
      presetId: this.preset.source.id,
      title: this.preset.title,
      background: color(
        clamp(this.state.bg_r ?? 0, 0, 1),
        clamp(this.state.bg_g ?? 0, 0, 1),
        clamp(this.state.bg_b ?? 0, 0, 1),
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
      variables: this.variablesProxy,
      compatibility: this.preset.ir.compatibility,
      gpuGeometry,
    });
    gpuGeometry.customWaves = customWaves.procedural;
    resetFrameTransformCache(this.geometryState);

    return frameState;
  }
}

export function createMilkdropVM(
  preset: MilkdropCompiledPreset,
  webgpuOptimizationFlags: MilkdropWebGpuOptimizationFlags = DEFAULT_MILKDROP_WEBGPU_OPTIMIZATION_FLAGS,
) {
  return new MilkdropPresetVM(preset, webgpuOptimizationFlags);
}
