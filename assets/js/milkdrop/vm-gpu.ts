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
        buffer: { type: 'storage' as const },
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

function buildSignalBuffer(
  device: GPUDevice,
  signals: MilkdropGpuVmSignals,
): GPUBuffer {
  const data = new Float32Array(MILKDROP_WGSL_SIGNAL_FIELDS.length);
  const signalMap: Record<string, number> = {
    time: signals.time,
    frame: signals.frame,
    fps: signals.fps,
    aspect: signals.aspect ?? 1,
    bass: signals.bass ?? 0,
    mid: signals.mid ?? 0,
    mids: signals.mids ?? 0,
    treb: signals.treb ?? 0,
    treble: signals.treble ?? 0,
    bass_att: signals.bass_att ?? 0,
    mid_att: signals.mid_att ?? 0,
    mids_att: signals.mids_att ?? 0,
    treb_att: signals.treb_att ?? 0,
    treble_att: signals.treble_att ?? 0,
    bassAtt: signals.bassAtt ?? 0,
    midAtt: signals.midAtt ?? 0,
    midsAtt: signals.midsAtt ?? 0,
    trebleAtt: signals.trebleAtt ?? 0,
    beat: signals.beat ?? 0,
    beat_pulse: signals.beat_pulse ?? 0,
    beatPulse: signals.beatPulse ?? 0,
    beat_bass: signals.beat_bass ?? 0,
    beat_mid: signals.beat_mid ?? 0,
    beat_treb: signals.beat_treb ?? 0,
    beatBass: signals.beatBass ?? 0,
    beatMid: signals.beatMid ?? 0,
    beatTreble: signals.beatTreble ?? 0,
    bandFlux: signals.bandFlux ?? 0,
    rms: signals.rms ?? 0,
    vol: signals.vol ?? 0,
    music: signals.music ?? 0,
    weighted_energy: signals.weightedEnergy ?? 0,
    progress: signals.frame,
  };

  for (let i = 0; i < MILKDROP_WGSL_SIGNAL_FIELDS.length; i++) {
    data[i] = signalMap[MILKDROP_WGSL_SIGNAL_FIELDS[i]] ?? 0;
  }

  const buffer = device.createBuffer({
    label: 'milkdrop-vm-signals',
    size: SIGNAL_BUFFER_SIZE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

export function createGpuVmRunner() {
  const bufferManager = createVmBufferManager();
  let device: GPUDevice | null = null;
  let stateBuffer: GPUBuffer | null = null;
  let bindGroup: GPUBindGroup | null = null;
  let pipeline: GPUComputePipeline | null = null;
  let activeCompilation: WgslProgramCompilation | null = null;

  let currentSignalBuffer: GPUBuffer | null = null;

  function init(
    gpuDevice: GPUDevice,
    block: MilkdropProgramBlock,
    initialState: Record<string, number>,
    initialRandomState: number,
  ) {
    device = gpuDevice;
    const compilation = getOrCompileProgram(block);
    activeCompilation = compilation;

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

    const bindGroupLayout = pipeline.getBindGroupLayout(0);
    const initialSignalBuffer = buildSignalBuffer(gpuDevice, {
      time: 0,
      frame: 0,
      fps: 60,
    });
    currentSignalBuffer = initialSignalBuffer;
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
          resource: { buffer: initialSignalBuffer },
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
      !activeCompilation
    ) {
      throw new Error('GPU VM not initialized');
    }

    if (currentSignalBuffer) {
      currentSignalBuffer.destroy();
    }
    const signalBuffer = buildSignalBuffer(device, signals);
    currentSignalBuffer = signalBuffer;
    const bindGroupLayout = pipeline.getBindGroupLayout(0);
    bindGroup = device.createBindGroup({
      label: 'milkdrop-vm-bind-group',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: stateBuffer } },
        { binding: 1, resource: { buffer: signalBuffer } },
      ],
    });

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

    signalBuffer.destroy();

    const state = await bufferManager.readState();
    const randOffset = bufferManager.getLayout()?.fieldOffsets?.rand_state;

    let randomState = 1;
    if (randOffset !== undefined && activeCompilation.usesRandom) {
      const readbackBuffer = device.createBuffer({
        label: 'milkdrop-vm-rand-readback',
        size: 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const copyEncoder = device.createCommandEncoder();
      copyEncoder.copyBufferToBuffer(
        stateBuffer,
        randOffset,
        readbackBuffer,
        0,
        4,
      );
      device.queue.submit([copyEncoder.finish()]);

      await readbackBuffer.mapAsync(GPUMapMode.READ);
      const mapped = new Uint32Array(readbackBuffer.getMappedRange());
      randomState = mapped[0] ?? 2531011;
      readbackBuffer.unmap();
      readbackBuffer.destroy();
    }

    return {
      state,
      randomState,
    };
  }

  function dispose() {
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
