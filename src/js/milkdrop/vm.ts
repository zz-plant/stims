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
  createDefaultSignalEnv,
  type GeometryBuilderState,
  hashSeed,
  MAX_CUSTOM_WAVE_SLOTS,
  type MutableState,
  type ShapeBuilderState,
  seedCustomShapeFields,
  seedCustomWaveFields,
  syncSignalEnvironment,
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
  if (!/gmegabuf/iu.test(preset.source.raw)) {
    return sharedGlobalBuffer ?? EMPTY_BUFFER;
  }
  sharedGlobalBuffer ??= new Float32Array(MILKDROP_GMEGABUF_SIZE);
  return sharedGlobalBuffer;
}

class MilkdropPresetVM implements MilkdropVM {
  private preset: MilkdropCompiledPreset;
  private state: MutableState = {};
  private registers: MutableState = {};
  private readonly signalEnv: MutableState = createDefaultSignalEnv();
  private lastPreparedSignalSource: MilkdropRuntimeSignals | null = null;
  private lastPreparedSignalFrame = Number.NaN;
  private lastPreparedSignalTime = Number.NaN;
  private randomState = 1;
  private qAfterInit: MutableState = {};
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
    customWaveTAfterInit: [],
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
    customShapeTAfterInit: [],
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
    // Ceiling must admit the full ultra-pipeline product (preset particle
    // scale x budget x backend boost x shader quality can reach ~4.5);
    // downstream consumers apply their own per-feature caps.
    this.detailScale = clamp(scale, 0.5, 4);
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
      this.registers,
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
    this.megabuf.fill(0);
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

    // Snapshot q values after init — these are restored before each per-frame run
    this.qAfterInit = {};
    for (let index = 1; index <= 32; index += 1) {
      this.qAfterInit[`q${index}`] = this.registers[`q${index}`] ?? 0;
    }

    this.waveState.customWaveTAfterInit = [];
    this.preset.ir.customWaves.forEach((wave, index) => {
      this.runProgram(
        wave.programs.init,
        this.createEnv(
          zeroSignals,
          this.waveState.customWaveLocals[index] ?? {},
        ),
        this.waveState.customWaveLocals[index],
      );
      // Capture t1-t8 values after each wave init
      const waveLocals = this.waveState.customWaveLocals[index];
      const tSnapshot: MutableState = {};
      for (let t = 1; t <= 8; t += 1) {
        tSnapshot[`t${t}`] = waveLocals?.[`t${t}`] ?? 0;
      }
      this.waveState.customWaveTAfterInit[index] = tSnapshot;
    });

    this.shapeState.customShapeTAfterInit = [];
    this.preset.ir.customShapes.forEach((shape, index) => {
      this.runProgram(
        shape.programs.init,
        this.createEnv(
          zeroSignals,
          this.shapeState.customShapeLocals[index] ?? {},
        ),
        this.shapeState.customShapeLocals[index],
      );
      // Capture t1-t8 values after each shape init
      const shapeLocals = this.shapeState.customShapeLocals[index];
      const tSnapshot: MutableState = {};
      for (let t = 1; t <= 8; t += 1) {
        tSnapshot[`t${t}`] = shapeLocals?.[`t${t}`] ?? 0;
      }
      this.shapeState.customShapeTAfterInit[index] = tSnapshot;
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
    return seedCustomWaveFields(wave, this.state);
  }

  private seedCustomShapeState(shape: MilkdropShapeDefinition) {
    return seedCustomShapeFields(shape, this.state);
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

    const meshDensity = getMeshDensity(this.state, this.detailScale);
    syncSignalEnvironment(signals, this.signalEnv, meshDensity);
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
      Object.assign(this.registers, result.registers);
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

    // Restore q values from post-init snapshot before per-frame runs
    for (let index = 1; index <= 32; index += 1) {
      this.registers[`q${index}`] = this.qAfterInit[`q${index}`] ?? 0;
    }

    this.runProgram(this.preset.ir.programs.perFrame, this.createEnv(signals));

    return this.buildFrame(signals);
  }

  private buildFrame(signals: MilkdropRuntimeSignals): MilkdropFrameState {
    const { visual: mainWave, procedural: proceduralMainWave } = buildMainWave({
      state: this.state,
      signals,
      detailScale: this.detailScale,
      waveState: this.waveState,
      supportsProceduralWave: this.frameCallbacks.supportsProceduralWave,
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
      runProgram: this.frameCallbacks.runProgram,
      createEnv: this.frameCallbacks.createEnv,
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
      runProgram: this.frameCallbacks.runProgram,
      createEnv: this.frameCallbacks.createEnv,
      seedCustomWaveState: this.frameCallbacks.seedCustomWaveState,
      getProceduralCustomWaveDescriptor:
        this.frameCallbacks.getProceduralCustomWaveDescriptor,
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
      runProgram: this.frameCallbacks.runProgram,
      createEnv: this.frameCallbacks.createEnv,
      proceduralMotionVectorPlan,
    });
    const shapes = buildShapes({
      preset: this.preset,
      state: this.state,
      signals,
      shapeState: this.shapeState,
      runProgram: this.frameCallbacks.runProgram,
      createEnv: this.frameCallbacks.createEnv,
      seedCustomShapeState: this.frameCallbacks.seedCustomShapeState,
    });
    const borders = buildBorders(this.state);
    const post = buildPost({
      preset: this.preset,
      state: this.state,
      signals,
      createEnv: this.frameCallbacks.createFlatEnv,
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
