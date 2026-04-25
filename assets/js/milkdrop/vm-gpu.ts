/* global GPUDevice, GPUComputePipeline, GPUBindGroup, GPUBuffer, GPUBindGroupLayout, GPUCommandEncoder, GPUComputePassEncoder */

import {
  compileProgramToWgsl,
  type WgslProgramCompilation,
} from './compiler/wgsl-generator';
import type { MilkdropProgramBlock, MilkdropRuntimeSignals } from './types';
import { createVmBufferManager } from './vm/buffer-manager';

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

const SIGNAL_FIELD_LIST = [
  'time',
  'frame',
  'fps',
  'bass',
  'mid',
  'mids',
  'treb',
  'treble',
  'bass_att',
  'mid_att',
  'mids_att',
  'treb_att',
  'treble_att',
  'bassAtt',
  'midAtt',
  'midsAtt',
  'trebleAtt',
  'beat',
  'beat_pulse',
  'beatPulse',
  'rms',
  'vol',
  'music',
  'weighted_energy',
  'progress',
] as const;

const SIGNAL_BUFFER_SIZE_BYTES = SIGNAL_FIELD_LIST.length * 4;

function buildSignalBuffer(
  device: GPUDevice,
  signals: Pick<MilkdropRuntimeSignals, 'time' | 'frame' | 'fps'> &
    Partial<Omit<MilkdropRuntimeSignals, 'time' | 'frame' | 'fps'>>,
): GPUBuffer {
  const data = new Float32Array(SIGNAL_FIELD_LIST.length);
  const signalMap = new Map<string, number>();
  signalMap.set('time', signals.time);
  signalMap.set('frame', signals.frame);
  signalMap.set('fps', signals.fps);
  signalMap.set('bass', signals.bass ?? 0);
  signalMap.set('mid', signals.mid ?? 0);
  signalMap.set('mids', signals.mids ?? 0);
  signalMap.set('treb', signals.treb ?? 0);
  signalMap.set('treble', signals.treble ?? 0);
  signalMap.set('bass_att', signals.bass_att ?? 0);
  signalMap.set('mid_att', signals.mid_att ?? 0);
  signalMap.set('mids_att', signals.mids_att ?? 0);
  signalMap.set('treb_att', signals.treb_att ?? 0);
  signalMap.set('treble_att', signals.treble_att ?? 0);
  signalMap.set('bassAtt', signals.bassAtt ?? 0);
  signalMap.set('midAtt', signals.midAtt ?? 0);
  signalMap.set('midsAtt', signals.midsAtt ?? 0);
  signalMap.set('trebleAtt', signals.trebleAtt ?? 0);
  signalMap.set('beat', signals.beat ?? 0);
  signalMap.set('beat_pulse', signals.beat_pulse ?? 0);
  signalMap.set('beatPulse', signals.beatPulse ?? 0);
  signalMap.set('rms', signals.rms ?? 0);
  signalMap.set('vol', signals.vol ?? 0);
  signalMap.set('music', signals.music ?? 0);
  signalMap.set('weighted_energy', signals.weightedEnergy ?? 0);
  signalMap.set('progress', signals.frame);

  for (let i = 0; i < SIGNAL_FIELD_LIST.length; i++) {
    data[i] = signalMap.get(SIGNAL_FIELD_LIST[i]) ?? 0;
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
          resource: {
            buffer: buildSignalBuffer(gpuDevice, {
              time: 0,
              frame: 0,
              fps: 60,
            }),
          },
        },
      ],
    });
  }

  async function dispatch(
    signals: Pick<MilkdropRuntimeSignals, 'time' | 'frame' | 'fps'> &
      Partial<Omit<MilkdropRuntimeSignals, 'time' | 'frame' | 'fps'>>,
  ): Promise<GpuVmResult> {
    if (
      !device ||
      !pipeline ||
      !bindGroup ||
      !stateBuffer ||
      !activeCompilation
    ) {
      throw new Error('GPU VM not initialized');
    }

    const signalBuffer = buildSignalBuffer(device, signals);
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
