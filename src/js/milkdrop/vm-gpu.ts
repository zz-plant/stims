/**
 * Runs preset equations as WebGPU compute passes instead of on the CPU.
 *
 * The GPU tier of the expression runtime. Programs are lowered to WGSL by
 * `compiler/wgsl-generator.ts`, then dispatched as compute work with the same
 * `megabuf`/`gmegabuf` scratch space the CPU VM uses, so per-vertex evaluation
 * scales past what the JIT can do on one thread.
 *
 * The CPU VM in `vm.ts` is the reference. This tier is expected to reproduce
 * its numbers, and where it cannot — floating-point ordering, precision, or an
 * unsupported construct — the runtime is expected to fall back rather than
 * render something different. `bun run lab:replay -- --replay <trace> --tier gpu`
 * reports the first frame where the two disagree, which is the fastest way to
 * find out that a change here changed behavior.
 */
/* global GPUDevice, GPUComputePipeline, GPUBindGroup, GPUBuffer, GPUBindGroupLayout, GPUCommandEncoder, GPUComputePassEncoder */

import {
  compileProgramToWgsl,
  type WgslProgramCompilation,
} from './compiler/wgsl-generator';
import {
  MILKDROP_GMEGABUF_SIZE,
  MILKDROP_MEGABUF_SIZE,
} from './expression-jit';
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

  // Megabuffer bindings exist only when the program touches them, so the
  // explicit layout must match the module's conditional declarations.
  // (Explicit rather than layout:'auto' — see the gpu-differential harness:
  // 'auto' prunes bindings a program doesn't statically reach and silently
  // zeroes the dispatch.)
  const entries = [
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
  ];
  if (program.usesMegabuf) {
    entries.push({
      binding: 2,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' as const },
    });
  }
  if (program.usesGmegabuf) {
    entries.push({
      binding: 3,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: 'storage' as const },
    });
  }
  const bindGroupLayout = device.createBindGroupLayout({ entries });

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
  const signalData = new Float32Array(MILKDROP_WGSL_SIGNAL_FIELDS.length);

  // Guest-memory mirrors. The CPU Float32Arrays passed to init() stay the
  // canonical copy (per-pixel and custom-wave programs still run on the CPU
  // and read/write them mid-frame); the GPU buffers are re-uploaded on every
  // syncState and copied back after each dispatch that can write them.
  let megabufBuffer: GPUBuffer | null = null;
  let gmegabufBuffer: GPUBuffer | null = null;
  let megabufReadback: GPUBuffer | null = null;
  let gmegabufReadback: GPUBuffer | null = null;
  let cpuMegabuf: Float32Array | null = null;
  let cpuGmegabuf: Float32Array | null = null;

  function destroyGuestMemoryBuffers() {
    for (const buffer of [
      megabufBuffer,
      gmegabufBuffer,
      megabufReadback,
      gmegabufReadback,
    ]) {
      buffer?.destroy();
    }
    megabufBuffer = null;
    gmegabufBuffer = null;
    megabufReadback = null;
    gmegabufReadback = null;
    cpuMegabuf = null;
    cpuGmegabuf = null;
  }

  function createGuestMemoryBuffer(
    gpuDevice: GPUDevice,
    label: string,
    sizeFloats: number,
    wantReadback: boolean,
  ): { storage: GPUBuffer; readback: GPUBuffer | null } {
    const sizeBytes = sizeFloats * 4;
    return {
      storage: gpuDevice.createBuffer({
        label,
        size: sizeBytes,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      }),
      // Read-only programs never need their guest memory copied back, so
      // skip the 4 MiB staging allocation entirely.
      readback: wantReadback
        ? gpuDevice.createBuffer({
            label: `${label}-readback`,
            size: sizeBytes,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          })
        : null,
    };
  }

  function uploadGuestMemory(gpuDevice: GPUDevice) {
    if (megabufBuffer && cpuMegabuf) {
      gpuDevice.queue.writeBuffer(megabufBuffer, 0, cpuMegabuf);
    }
    if (gmegabufBuffer && cpuGmegabuf && cpuGmegabuf.length > 0) {
      gpuDevice.queue.writeBuffer(gmegabufBuffer, 0, cpuGmegabuf);
    }
  }

  function init(
    gpuDevice: GPUDevice,
    block: MilkdropProgramBlock,
    initialState: Record<string, number>,
    initialRandomState: number,
    initialRegisters: Record<string, number> = {},
    guestMemory: { megabuf?: Float32Array; gmegabuf?: Float32Array } = {},
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

    destroyGuestMemoryBuffers();
    if (compilation.usesMegabuf) {
      cpuMegabuf =
        guestMemory.megabuf ?? new Float32Array(MILKDROP_MEGABUF_SIZE);
      const created = createGuestMemoryBuffer(
        gpuDevice,
        'milkdrop-vm-megabuf',
        MILKDROP_MEGABUF_SIZE,
        compilation.writesMegabuf,
      );
      megabufBuffer = created.storage;
      megabufReadback = created.readback;
    }
    if (compilation.usesGmegabuf) {
      cpuGmegabuf =
        guestMemory.gmegabuf && guestMemory.gmegabuf.length > 0
          ? guestMemory.gmegabuf
          : new Float32Array(MILKDROP_GMEGABUF_SIZE);
      const created = createGuestMemoryBuffer(
        gpuDevice,
        'milkdrop-vm-gmegabuf',
        MILKDROP_GMEGABUF_SIZE,
        compilation.writesGmegabuf,
      );
      gmegabufBuffer = created.storage;
      gmegabufReadback = created.readback;
    }
    uploadGuestMemory(gpuDevice);

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
        ...(megabufBuffer
          ? [{ binding: 2, resource: { buffer: megabufBuffer } }]
          : []),
        ...(gmegabufBuffer
          ? [{ binding: 3, resource: { buffer: gmegabufBuffer } }]
          : []),
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

    // Copy guest memory to the readback buffers in the same submission so
    // buffer writes made by this dispatch are visible to the CPU tiers
    // (per-pixel programs read megabuf on the CPU later in the frame).
    if (megabufBuffer && megabufReadback && activeCompilation.writesMegabuf) {
      commandEncoder.copyBufferToBuffer(
        megabufBuffer,
        0,
        megabufReadback,
        0,
        MILKDROP_MEGABUF_SIZE * 4,
      );
    }
    if (
      gmegabufBuffer &&
      gmegabufReadback &&
      activeCompilation.writesGmegabuf
    ) {
      commandEncoder.copyBufferToBuffer(
        gmegabufBuffer,
        0,
        gmegabufReadback,
        0,
        MILKDROP_GMEGABUF_SIZE * 4,
      );
    }

    device.queue.submit([commandEncoder.finish()]);

    await device.queue.onSubmittedWorkDone();

    if (megabufReadback && cpuMegabuf && activeCompilation.writesMegabuf) {
      await megabufReadback.mapAsync(GPUMapMode.READ);
      cpuMegabuf.set(
        new Float32Array(
          megabufReadback.getMappedRange(),
          0,
          cpuMegabuf.length,
        ),
      );
      megabufReadback.unmap();
    }
    if (gmegabufReadback && cpuGmegabuf && activeCompilation.writesGmegabuf) {
      await gmegabufReadback.mapAsync(GPUMapMode.READ);
      cpuGmegabuf.set(
        new Float32Array(
          gmegabufReadback.getMappedRange(),
          0,
          cpuGmegabuf.length,
        ),
      );
      gmegabufReadback.unmap();
    }

    // One readback for the whole state buffer, rand_state included. This used
    // to be followed by a second encoder + submit + mapAsync just for those
    // four bytes — an entire extra CPU/GPU sync point per frame for data the
    // copy above already carried.
    const { fields: storedValues, randomState: readRandomState } =
      await bufferManager.readState(device);
    const registers: Record<string, number> = {};
    for (const key of activeCompilation.registerKeys) {
      registers[key] = storedValues[key] ?? 0;
      delete storedValues[key];
    }

    return {
      state: storedValues,
      registers,
      randomState: activeCompilation.usesRandom
        ? (readRandomState ?? 2531011)
        : 1,
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
    // The CPU mirror may have been written by CPU-tier programs (per-pixel,
    // custom waves) since the last dispatch — it is canonical between frames.
    uploadGuestMemory(device);
  }

  function dispose() {
    clearGpuVmCaches();
    if (currentSignalBuffer) {
      currentSignalBuffer.destroy();
      currentSignalBuffer = null;
    }
    destroyGuestMemoryBuffers();
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
