/* global GPUMapMode, GPUBufferUsage, GPUShaderStage */

type MultiWebGPUEffectsOptions = {
  enabled: boolean;
  particlePositions: Float32Array;
  particleCount: number;
  heightfieldSize?: number;
};

type MultiWebGPUEffectSnapshot = {
  audio: {
    bass: number;
    mids: number;
    highs: number;
    flux: number;
  };
  heightfield: {
    average: number;
    peak: number;
  };
};

type MultiWebGPUEffectsController = {
  enabled: boolean;
  tick(input: {
    frequencyData: Uint8Array;
    delta: number;
  }): MultiWebGPUEffectSnapshot;
  dispose(): void;
};

type GpuContext = {
  device: GPUDevice;
  queue: GPUQueue;
  particleCount: number;
  particleStride: number;
  heightfieldSize: number;
  frame: number;
  audioBinCount: number;
  audioInput: GPUBuffer;
  audioState: GPUBuffer;
  audioReadback: GPUBuffer;
  audioBindGroup: GPUBindGroup;
  audioPipeline: GPUComputePipeline;
  particleState: GPUBuffer;
  particleReadback: GPUBuffer;
  particleBindGroup: GPUBindGroup;
  particlePipeline: GPUComputePipeline;
  simUniforms: GPUBuffer;
  heightfieldState: GPUBuffer;
  heightfieldReadback: GPUBuffer;
  heightfieldBindGroup: GPUBindGroup;
  heightfieldPipeline: GPUComputePipeline;
};

const NOOP_SNAPSHOT: MultiWebGPUEffectSnapshot = {
  audio: { bass: 0, mids: 0, highs: 0, flux: 0 },
  heightfield: { average: 0, peak: 0 },
};

function asGpuMapModeRead() {
  return (
    (globalThis as typeof globalThis & { GPUMapMode?: { READ?: number } })
      .GPUMapMode?.READ ?? 1
  );
}

function ensureGpuUsage() {
  const usage = (
    globalThis as typeof globalThis & {
      GPUBufferUsage?: Record<string, number>;
    }
  ).GPUBufferUsage;
  if (!usage) {
    throw new Error('GPUBufferUsage is not available.');
  }
  return usage;
}

async function initGpuContext({
  particlePositions,
  particleCount,
  heightfieldSize,
}: {
  particlePositions: Float32Array;
  particleCount: number;
  heightfieldSize: number;
}): Promise<GpuContext | null> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu?.requestAdapter) return null;

  const adapter = await gpu.requestAdapter();
  if (!adapter?.requestDevice) return null;
  const device = await adapter.requestDevice();
  const queue = device.queue;
  const usage = ensureGpuUsage();

  const audioBinCount = 256;
  const particleStride = 8;
  const heightfieldCells = heightfieldSize * heightfieldSize;

  const audioInput = device.createBuffer({
    size: audioBinCount * 4,
    usage: usage.STORAGE | usage.COPY_DST,
  });
  const audioState = device.createBuffer({
    size: audioBinCount * 4,
    usage: usage.STORAGE | usage.COPY_SRC,
  });
  const audioReadback = device.createBuffer({
    size: audioBinCount * 4,
    usage: usage.COPY_DST | usage.MAP_READ,
  });

  const particleState = device.createBuffer({
    size: particleCount * particleStride * 4,
    usage: usage.STORAGE | usage.COPY_SRC,
  });
  const particleReadback = device.createBuffer({
    size: particleCount * 4 * 4,
    usage: usage.COPY_DST | usage.MAP_READ,
  });

  const initialParticleState = new Float32Array(particleCount * particleStride);
  for (let i = 0; i < particleCount; i++) {
    const base = i * particleStride;
    const p = i * 3;
    initialParticleState[base] = particlePositions[p] ?? 0;
    initialParticleState[base + 1] = particlePositions[p + 1] ?? 0;
    initialParticleState[base + 2] = particlePositions[p + 2] ?? 0;
    initialParticleState[base + 3] = (Math.random() - 0.5) * 0.08;
    initialParticleState[base + 4] = (Math.random() - 0.5) * 0.08;
    initialParticleState[base + 5] = (Math.random() - 0.5) * 0.08;
    initialParticleState[base + 6] = Math.random() * Math.PI * 2;
    initialParticleState[base + 7] = 0;
  }
  queue.writeBuffer(particleState, 0, initialParticleState.buffer);

  const simUniforms = device.createBuffer({
    size: 16,
    usage: usage.UNIFORM | usage.COPY_DST,
  });

  const heightfieldState = device.createBuffer({
    size: heightfieldCells * 4,
    usage: usage.STORAGE | usage.COPY_SRC,
  });
  const heightfieldReadback = device.createBuffer({
    size: heightfieldCells * 4,
    usage: usage.COPY_DST | usage.MAP_READ,
  });

  const audioModule = device.createShaderModule({
    code: `
      @group(0) @binding(0) var<storage, read> audioIn : array<f32>;
      @group(0) @binding(1) var<storage, read_write> audioState : array<f32>;

      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id : vec3<u32>) {
        let i = id.x;
        if (i >= arrayLength(&audioState)) {
          return;
        }
        let current = audioIn[i];
        let previous = audioState[i];
        audioState[i] = mix(previous, current, 0.24);
      }
    `,
  });

  const audioBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
    ],
  });
  const audioPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [audioBindGroupLayout],
    }),
    compute: { module: audioModule, entryPoint: 'main' },
  });
  const audioBindGroup = device.createBindGroup({
    layout: audioBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: audioInput } },
      { binding: 1, resource: { buffer: audioState } },
    ],
  });

  const particleModule = device.createShaderModule({
    code: `
      struct SimUniforms {
        delta: f32,
        bass: f32,
        mids: f32,
        highs: f32,
      }

      @group(0) @binding(0) var<storage, read_write> particles : array<vec4<f32>>;
      @group(0) @binding(1) var<uniform> uniforms : SimUniforms;

      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id : vec3<u32>) {
        let i = id.x;
        let positionIndex = i * 2u;
        let velocityIndex = positionIndex + 1u;
        if (velocityIndex >= arrayLength(&particles)) {
          return;
        }

        var p = particles[positionIndex];
        var v = particles[velocityIndex];

        let pulse = uniforms.bass * 0.2 + uniforms.mids * 0.08;
        let swirl = uniforms.highs * 0.06;
        let wobble = vec3<f32>(
          sin(p.y * 0.06 + p.w),
          cos(p.z * 0.05 + p.w * 0.5),
          sin(p.x * 0.05 - p.w)
        );

        v.xyz = v.xyz * 0.985 + wobble * swirl + normalize(p.xyz + vec3<f32>(0.001)) * pulse * 0.02;
        p.xyz = p.xyz + v.xyz * uniforms.delta * 60.0;
        p.w = p.w + uniforms.delta * (0.5 + uniforms.highs);

        let r = length(p.xyz);
        if (r > 280.0) {
          p.xyz = p.xyz * (240.0 / max(r, 0.001));
          v.xyz = v.xyz * -0.35;
        }

        particles[positionIndex] = p;
        particles[velocityIndex] = v;
      }
    `,
  });

  const particleBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' },
      },
    ],
  });
  const particlePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [particleBindGroupLayout],
    }),
    compute: { module: particleModule, entryPoint: 'main' },
  });
  const particleBindGroup = device.createBindGroup({
    layout: particleBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: particleState } },
      { binding: 1, resource: { buffer: simUniforms } },
    ],
  });

  const heightfieldModule = device.createShaderModule({
    code: `
      struct SimUniforms {
        delta: f32,
        bass: f32,
        mids: f32,
        highs: f32,
      }

      @group(0) @binding(0) var<storage, read_write> field : array<f32>;
      @group(0) @binding(1) var<uniform> uniforms : SimUniforms;

      const SIZE: u32 = ${heightfieldSize}u;

      fn idx(x: u32, y: u32) -> u32 {
        return y * SIZE + x;
      }

      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) id : vec3<u32>) {
        if (id.x >= SIZE || id.y >= SIZE) {
          return;
        }
        let x = id.x;
        let y = id.y;
        let center = field[idx(x, y)];
        let left = field[idx((x + SIZE - 1u) % SIZE, y)];
        let right = field[idx((x + 1u) % SIZE, y)];
        let up = field[idx(x, (y + SIZE - 1u) % SIZE)];
        let down = field[idx(x, (y + 1u) % SIZE)];

        let laplacian = (left + right + up + down) * 0.25 - center;
        let cx = f32(x) / f32(SIZE) - 0.5;
        let cy = f32(y) / f32(SIZE) - 0.5;
        let radial = max(0.0, 1.0 - length(vec2<f32>(cx, cy)) * 2.0);
        let inject = uniforms.bass * radial * 0.06 + uniforms.highs * 0.01;
        field[idx(x, y)] = center * 0.986 + laplacian * (0.22 + uniforms.mids * 0.05) + inject;
      }
    `,
  });

  const heightfieldBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform' },
      },
    ],
  });
  const heightfieldPipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [heightfieldBindGroupLayout],
    }),
    compute: { module: heightfieldModule, entryPoint: 'main' },
  });
  const heightfieldBindGroup = device.createBindGroup({
    layout: heightfieldBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: heightfieldState } },
      { binding: 1, resource: { buffer: simUniforms } },
    ],
  });

  return {
    device,
    queue,
    particleCount,
    particleStride,
    heightfieldSize,
    frame: 0,
    audioBinCount,
    audioInput,
    audioState,
    audioReadback,
    audioBindGroup,
    audioPipeline,
    particleState,
    particleReadback,
    particleBindGroup,
    particlePipeline,
    simUniforms,
    heightfieldState,
    heightfieldReadback,
    heightfieldBindGroup,
    heightfieldPipeline,
  };
}

function summarizeAudio(smoothedBins: Float32Array) {
  const bins = smoothedBins.length;
  if (!bins) return { bass: 0, mids: 0, highs: 0, flux: 0 };
  const bassLimit = Math.floor(bins * 0.15);
  const midsLimit = Math.floor(bins * 0.55);

  let bass = 0;
  let mids = 0;
  let highs = 0;
  let flux = 0;

  for (let i = 1; i < bins; i++) {
    const value = smoothedBins[i] ?? 0;
    const previous = smoothedBins[i - 1] ?? 0;
    flux += Math.abs(value - previous);
    if (i < bassLimit) bass += value;
    else if (i < midsLimit) mids += value;
    else highs += value;
  }

  return {
    bass: bass / Math.max(1, bassLimit),
    mids: mids / Math.max(1, midsLimit - bassLimit),
    highs: highs / Math.max(1, bins - midsLimit),
    flux: flux / Math.max(1, bins),
  };
}

function summarizeHeightfield(values: Float32Array) {
  if (!values.length) return { average: 0, peak: 0 };
  let sum = 0;
  let peak = 0;
  for (const value of values) {
    const mag = Math.abs(value);
    sum += mag;
    if (mag > peak) peak = mag;
  }
  return {
    average: sum / values.length,
    peak,
  };
}

export async function createMultiWebGPUEffects({
  enabled,
  particlePositions,
  particleCount,
  heightfieldSize = 24,
}: MultiWebGPUEffectsOptions): Promise<MultiWebGPUEffectsController> {
  if (!enabled || typeof navigator === 'undefined') {
    return {
      enabled: false,
      tick: () => NOOP_SNAPSHOT,
      dispose: () => {},
    };
  }

  const context = await initGpuContext({
    particlePositions,
    particleCount,
    heightfieldSize,
  }).catch((error) => {
    console.warn(
      'WebGPU effects disabled: failed to initialize compute pipelines.',
      error,
    );
    return null;
  });

  if (!context) {
    return {
      enabled: false,
      tick: () => NOOP_SNAPSHOT,
      dispose: () => {},
    };
  }

  let snapshot = NOOP_SNAPSHOT;
  let busy = false;

  const runPasses = async (frequencyData: Uint8Array, delta: number) => {
    const audioInput = new Float32Array(context.audioBinCount);
    for (let i = 0; i < context.audioBinCount; i++) {
      audioInput[i] = (frequencyData[i] ?? 0) / 255;
    }
    context.queue.writeBuffer(context.audioInput, 0, audioInput);

    const encoder = context.device.createCommandEncoder();
    const audioPass = encoder.beginComputePass();
    audioPass.setPipeline(context.audioPipeline);
    audioPass.setBindGroup(0, context.audioBindGroup);
    audioPass.dispatchWorkgroups(Math.ceil(context.audioBinCount / 64));
    audioPass.end();

    encoder.copyBufferToBuffer(
      context.audioState,
      0,
      context.audioReadback,
      0,
      context.audioBinCount * 4,
    );

    context.queue.submit([encoder.finish()]);

    await context.audioReadback.mapAsync(asGpuMapModeRead());
    const mappedAudio = context.audioReadback.getMappedRange();
    const smoothedBins = new Float32Array(mappedAudio.slice(0));
    context.audioReadback.unmap();
    const audioSummary = summarizeAudio(smoothedBins);

    const uniforms = new Float32Array([
      Math.max(0.008, Math.min(0.04, delta)),
      audioSummary.bass,
      audioSummary.mids,
      audioSummary.highs,
    ]);
    context.queue.writeBuffer(context.simUniforms, 0, uniforms);

    const simEncoder = context.device.createCommandEncoder();
    const particlePass = simEncoder.beginComputePass();
    particlePass.setPipeline(context.particlePipeline);
    particlePass.setBindGroup(0, context.particleBindGroup);
    particlePass.dispatchWorkgroups(Math.ceil(context.particleCount / 64));
    particlePass.end();

    const heightfieldPass = simEncoder.beginComputePass();
    heightfieldPass.setPipeline(context.heightfieldPipeline);
    heightfieldPass.setBindGroup(0, context.heightfieldBindGroup);
    heightfieldPass.dispatchWorkgroups(
      Math.ceil(context.heightfieldSize / 8),
      Math.ceil(context.heightfieldSize / 8),
    );
    heightfieldPass.end();

    simEncoder.copyBufferToBuffer(
      context.particleState,
      0,
      context.particleReadback,
      0,
      context.particleCount * 4 * 4,
    );
    simEncoder.copyBufferToBuffer(
      context.heightfieldState,
      0,
      context.heightfieldReadback,
      0,
      context.heightfieldSize * context.heightfieldSize * 4,
    );

    context.queue.submit([simEncoder.finish()]);

    await Promise.all([
      context.particleReadback.mapAsync(asGpuMapModeRead()),
      context.heightfieldReadback.mapAsync(asGpuMapModeRead()),
    ]);

    const mappedParticles = context.particleReadback.getMappedRange();
    const particleView = new Float32Array(mappedParticles);
    for (let i = 0; i < context.particleCount; i++) {
      const sourceBase = i * context.particleStride;
      const targetBase = i * 3;
      particlePositions[targetBase] =
        particleView[sourceBase] ?? particlePositions[targetBase] ?? 0;
      particlePositions[targetBase + 1] =
        particleView[sourceBase + 1] ?? particlePositions[targetBase + 1] ?? 0;
      particlePositions[targetBase + 2] =
        particleView[sourceBase + 2] ?? particlePositions[targetBase + 2] ?? 0;
    }
    context.particleReadback.unmap();

    const mappedField = context.heightfieldReadback.getMappedRange();
    const fieldValues = new Float32Array(mappedField.slice(0));
    context.heightfieldReadback.unmap();

    snapshot = {
      audio: audioSummary,
      heightfield: summarizeHeightfield(fieldValues),
    };
  };

  return {
    enabled: true,
    tick({ frequencyData, delta }) {
      if (!busy) {
        busy = true;
        void runPasses(frequencyData, delta)
          .catch((error) => {
            console.warn('WebGPU compute update failed.', error);
          })
          .finally(() => {
            busy = false;
          });
      }

      context.frame += 1;
      return snapshot;
    },
    dispose() {
      context.audioInput.destroy();
      context.audioState.destroy();
      context.audioReadback.destroy();
      context.particleState.destroy();
      context.particleReadback.destroy();
      context.simUniforms.destroy();
      context.heightfieldState.destroy();
      context.heightfieldReadback.destroy();
    },
  };
}
