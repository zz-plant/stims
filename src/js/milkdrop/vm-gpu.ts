/* global GPUDevice, GPUComputePipeline, GPUBindGroup, GPUBuffer, GPUBindGroupLayout, GPUCommandEncoder, GPUComputePassEncoder */

import {
  compileProgramToWgsl,
  type WgslProgramCompilation,
} from './compiler/wgsl-generator';
import type { MilkdropProgramBlock } from './types';
import { createVmBufferManager } from './vm/buffer-manager';
import {
  MILKDROP_WGSL_SIGNAL_FIELDS,
  type MilkdropGpuVmSignals,
} from './wgsl-signal-layout.ts';

export type GpuVmResult = {
  state: Record<string, number>;
  randomState: number;
};

const PROGRAM_CACHE = new Map<string, WgslProgramCompilation>();
const PIPELINE_CACHE = new Map<string, GPUComputePipeline>();

export function clearGpuVmCaches() {
  PROGRAM_CACHE.clear();
  PIPELINE_CACHE.clear();
}

export function preloadGpuProgramPipeline(
  device: GPUDevice,
  block: MilkdropProgramBlock,
): GPUComputePipeline {
  const compilation = getOrCompileProgram(block);
  return getOrCreatePipeline(device, compilation);
}

export async function warmupGpuPipelines(
  device: GPUDevice,
  blocks: MilkdropProgramBlock[],
): Promise<GPUComputePipeline[]> {
  const pipelines: GPUComputePipeline[] = [];
  for (const block of blocks) {
    pipelines.push(preloadGpuProgramPipeline(device, block));
  }
  return pipelines;
}

function getOrCompileProgram(
  block: MilkdropProgramBlock,
): WgslProgramCompilation {
  const signature = JSON.stringify(
    block.statements.map((s) => ({ target: s.target, source: s.source })),
  );
  const cached = PROGRAM_CACHE.get(signature);
  if (cached) {
    return cached;
  }
  const compiled = compileProgramToWgsl(block);
  PROGRAM_CACHE.set(signature, compiled);
  return compiled;
}

function getOrCreatePipeline(
  device: GPUDevice,
  program: WgslProgramCompilation,
): GPUComputePipeline {
  const key = program.signature;
  const cached = PIPELINE_CACHE.get(key);
  if (cached) {
    return cached;
  }

  const shaderModule = device.createShaderModule({
    label: 'milkdrop-vm-shader',
    code: program.wgslCode,
  });

  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' as const },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' as const },
      },
    ],
  });

  const pipeline = device.createComputePipeline({
    label: 'milkdrop-vm-pipeline',
    layout: device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    }),
    compute: {
      module: shaderModule,
      entryPoint: program.entryPoint,
    },
  });

  PIPELINE_CACHE.set(key, pipeline);
  return pipeline;
}

const SIGNAL_BUFFER_SIZE_BYTES = MILKDROP_WGSL_SIGNAL_FIELDS.length * 4;

function populateSignalData(
  target: Float32Array,
  signals: MilkdropGpuVmSignals,
): void {
  for (let i = 0; i < MILKDROP_WGSL_SIGNAL_FIELDS.length; i++) {
    const field = MILKDROP_WGSL_SIGNAL_FIELDS[i];
    switch (field) {
      case 'time':
        target[i] = signals.time;
        break;
      case 'frame':
      case 'progress':
        target[i] = signals.frame;
        break;
      case 'fps':
        target[i] = signals.fps;
        break;
      case 'aspect':
        target[i] = signals.aspect ?? 1;
        break;
      case 'bass':
        target[i] = signals.bass ?? 0;
        break;
      case 'mid':
      case 'mids':
        target[i] = signals.mid ?? signals.mids ?? 0;
        break;
      case 'treb':
      case 'treble':
        target[i] = signals.treb ?? signals.treble ?? 0;
        break;
      case 'bass_att':
      case 'bassAtt':
        target[i] = signals.bass_att ?? signals.bassAtt ?? 0;
        break;
      case 'mid_att':
      case 'mids_att':
      case 'midAtt':
      case 'midsAtt':
        target[i] =
          signals.mid_att ??
          signals.mids_att ??
          signals.midAtt ??
          signals.midsAtt ??
          0;
        break;
      case 'treb_att':
      case 'treble_att':
      case 'trebleAtt':
        target[i] =
          signals.treb_att ?? signals.treble_att ?? signals.trebleAtt ?? 0;
        break;
      case 'beat':
        target[i] = signals.beat ?? 0;
        break;
      case 'beat_pulse':
      case 'beatPulse':
        target[i] = signals.beat_pulse ?? signals.beatPulse ?? 0;
        break;
      case 'beat_bass':
      case 'beatBass':
        target[i] = signals.beat_bass ?? signals.beatBass ?? 0;
        break;
      case 'beat_mid':
      case 'beatMid':
        target[i] = signals.beat_mid ?? signals.beatMid ?? 0;
        break;
      case 'beat_treb':
      case 'beatTreble':
        target[i] = signals.beat_treb ?? signals.beatTreble ?? 0;
        break;
      case 'bandFlux':
        target[i] = signals.bandFlux ?? 0;
        break;
      case 'rms':
        target[i] = signals.rms ?? 0;
        break;
      case 'vol':
        target[i] = signals.vol ?? 0;
        break;
      case 'music':
        target[i] = signals.music ?? 0;
        break;
      case 'weighted_energy':
        target[i] = signals.weightedEnergy ?? 0;
        break;
      default:
        target[i] = 0;
        break;
    }
  }
}

export function createGpuVmRunner() {
  const bufferManager = createVmBufferManager();
  let device: GPUDevice | null = null;
  let stateBuffer: GPUBuffer | null = null;
  let bindGroup: GPUBindGroup | null = null;
  let pipeline: GPUComputePipeline | null = null;
  let activeCompilation: WgslProgramCompilation | null = null;

  let currentSignalBuffer: GPUBuffer | null = null;
  let randReadbackBuffer: GPUBuffer | null = null;
  const signalData = new Float32Array(MILKDROP_WGSL_SIGNAL_FIELDS.length);

  function init(
    gpuDevice: GPUDevice,
    block: MilkdropProgramBlock,
    initialState: Record<string, number>,
    initialRandomState: number,
  ) {
    device = gpuDevice;
    clearGpuVmCaches();
    const compilation = getOrCompileProgram(block);
    activeCompilation = compilation;

    bufferManager.dispose();
    const layout = bufferManager.allocateBuffer(
      gpuDevice,
      compilation.fieldKeys,
      compilation.usesRandom,
      'milkdrop-vm-state',
    );
    stateBuffer = layout.buffer;

    bufferManager.writeState(gpuDevice, initialState, initialRandomState);

    pipeline = getOrCreatePipeline(gpuDevice, compilation);

    const currentStateBuffer = stateBuffer;
    if (!currentStateBuffer) {
      throw new Error('GPU VM state buffer not allocated');
    }

    if (currentSignalBuffer) {
      currentSignalBuffer.destroy();
    }
    currentSignalBuffer = gpuDevice.createBuffer({
      label: 'milkdrop-vm-signals',
      size: SIGNAL_BUFFER_SIZE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    if (randReadbackBuffer) {
      randReadbackBuffer.destroy();
      randReadbackBuffer = null;
    }
    if (compilation.usesRandom) {
      randReadbackBuffer = gpuDevice.createBuffer({
        label: 'milkdrop-vm-rand-readback',
        size: 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    }

    populateSignalData(signalData, {
      time: 0,
      frame: 0,
      fps: 60,
    });
    gpuDevice.queue.writeBuffer(currentSignalBuffer, 0, signalData);

    const bindGroupLayout = pipeline.getBindGroupLayout(0);
    bindGroup = gpuDevice.createBindGroup({
      label: 'milkdrop-vm-bind-group',
      layout: bindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: { buffer: currentStateBuffer },
        },
        {
          binding: 1,
          resource: { buffer: currentSignalBuffer },
        },
      ],
    });
  }

  async function dispatch(signals: MilkdropGpuVmSignals): Promise<GpuVmResult> {
    if (
      !device ||
      !pipeline ||
      !bindGroup ||
      !stateBuffer ||
      !currentSignalBuffer ||
      !activeCompilation
    ) {
      throw new Error('GPU VM not initialized');
    }

    populateSignalData(signalData, signals);
    device.queue.writeBuffer(currentSignalBuffer, 0, signalData);

    const commandEncoder = device.createCommandEncoder({
      label: 'milkdrop-vm-encoder',
    });
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();

    device.queue.submit([commandEncoder.finish()]);

    await device.queue.onSubmittedWorkDone();

    const state = await bufferManager.readState();
    const randOffset = bufferManager.getLayout()?.fieldOffsets?.rand_state;

    let randomState = 1;
    if (
      randOffset !== undefined &&
      activeCompilation.usesRandom &&
      randReadbackBuffer
    ) {
      const copyEncoder = device.createCommandEncoder({
        label: 'milkdrop-vm-copy-rand',
      });
      copyEncoder.copyBufferToBuffer(
        stateBuffer,
        randOffset,
        randReadbackBuffer,
        0,
        4,
      );
      device.queue.submit([copyEncoder.finish()]);

      await randReadbackBuffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint32Array(randReadbackBuffer.getMappedRange());
      randomState = mapped[0] ?? 2531011;
      randReadbackBuffer.unmap();
    }

    return {
      state,
      randomState,
    };
  }

  function dispose() {
    if (currentSignalBuffer) {
      currentSignalBuffer.destroy();
      currentSignalBuffer = null;
    }
    if (randReadbackBuffer) {
      randReadbackBuffer.destroy();
      randReadbackBuffer = null;
    }
    pipeline = null;
    bindGroup = null;
    stateBuffer = null;
    activeCompilation = null;
    bufferManager.dispose();
    device = null;
  }

  function isInitialized() {
    return device !== null && pipeline !== null;
  }

  return {
    init,
    dispatch,
    dispose,
    isInitialized,
  };
}
