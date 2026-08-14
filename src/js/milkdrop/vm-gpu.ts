/* global GPUDevice, GPUComputePipeline, GPUBindGroup, GPUBuffer, GPUBindGroupLayout, GPUCommandEncoder, GPUComputePassEncoder */

import {
  compileProgramToWgsl,
  type WgslProgramCompilation,
} from './compiler/wgsl-generator';
import type { MilkdropProgramBlock, MilkdropRuntimeSignals } from './types';
import { createVmBufferManager } from './vm/buffer-manager';
import { syncSignalEnvironment } from './vm/shared';
import {
  MILKDROP_WGSL_SIGNAL_FIELDS,
  type MilkdropGpuVmSignals,
} from './wgsl-signal-layout.ts';

export type GpuVmResult = {
  state: Record<string, number>;
  registers: Record<string, number>;
  randomState: number;
};

const PROGRAM_CACHE = new WeakMap<
  MilkdropProgramBlock,
  WgslProgramCompilation
>();
const PIPELINE_CACHE = new Map<string, GPUComputePipeline>();

export function clearGpuVmCaches() {
  PIPELINE_CACHE.clear();
}

export function preloadGpuProgramPipeline(
  device: GPUDevice,
  block: MilkdropProgramBlock,
): GPUComputePipeline {
  const compilation = getOrCompileProgram(block, device);
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
  device?: GPUDevice,
): WgslProgramCompilation {
  const cached = PROGRAM_CACHE.get(block);
  if (cached) {
    return cached;
  }
  const enableF16 = device?.features?.has('shader-f16') ?? false;
  const enableSubgroups = device?.features?.has('subgroups') ?? false;
  const compiled = compileProgramToWgsl(block, { enableF16, enableSubgroups });
  PROGRAM_CACHE.set(block, compiled);
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

const SIGNAL_SCRATCH_ENV: Record<string, number> = {};

function populateSignalData(
  target: Float32Array,
  signals: MilkdropGpuVmSignals,
): void {
  syncSignalEnvironment(
    signals as unknown as MilkdropRuntimeSignals,
    SIGNAL_SCRATCH_ENV,
  );
  for (let i = 0; i < MILKDROP_WGSL_SIGNAL_FIELDS.length; i++) {
    const field = MILKDROP_WGSL_SIGNAL_FIELDS[i];
    target[i] = SIGNAL_SCRATCH_ENV[field] ?? 0;
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
    initialRegisters: Record<string, number> = {},
  ) {
    device = gpuDevice;
    clearGpuVmCaches();
    const compilation = getOrCompileProgram(block, gpuDevice);
    if (!compilation.gpuExecutable) {
      dispose();
      return false;
    }
    activeCompilation = compilation;

    bufferManager.dispose();
    const layout = bufferManager.allocateBuffer(
      gpuDevice,
      compilation.fieldKeys,
      compilation.usesRandom,
      'milkdrop-vm-state',
    );
    stateBuffer = layout.buffer;

    bufferManager.writeState(
      gpuDevice,
      { ...initialState, ...initialRegisters },
      initialRandomState,
    );

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
    return true;
  }

  function dispatchInEncoder(
    commandEncoder: GPUCommandEncoder,
    signals: MilkdropGpuVmSignals,
  ): GPUBuffer {
    if (
      !device ||
      !pipeline ||
      !bindGroup ||
      !stateBuffer ||
      !currentSignalBuffer
    ) {
      throw new Error('GPU VM not initialized');
    }

    populateSignalData(signalData, signals);
    device.queue.writeBuffer(currentSignalBuffer, 0, signalData);

    const pass = commandEncoder.beginComputePass({
      label: 'milkdrop-vm-compute-pass',
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();

    return stateBuffer;
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

    const storedValues = await bufferManager.readState();
    const registers: Record<string, number> = {};
    for (const key of activeCompilation.registerKeys) {
      registers[key] = storedValues[key] ?? 0;
      delete storedValues[key];
    }
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
      state: storedValues,
      registers,
      randomState,
    };
  }

  /** Re-uploads the CPU state mirror into the GPU-resident state buffer.
   * Used before each dispatch so the per-frame base-value reset (MilkDrop
   * reload semantics) applies to GPU-accumulated state as well. */
  function syncState(
    state: Record<string, number>,
    registers: Record<string, number>,
    randomState: number,
  ) {
    if (!device || !stateBuffer) {
      return;
    }
    bufferManager.writeState(device, { ...state, ...registers }, randomState);
  }

  function dispose() {
    clearGpuVmCaches();
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
    dispatchInEncoder,
    syncState,
    dispose,
    isInitialized,
  };
}
