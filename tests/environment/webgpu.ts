const GPU_STAGE = {
  VERTEX: 1,
  FRAGMENT: 2,
  COMPUTE: 4,
};

const GPU_BUFFER_USAGE = {
  MAP_READ: 1,
  MAP_WRITE: 2,
  COPY_SRC: 4,
  COPY_DST: 8,
  INDEX: 16,
  VERTEX: 32,
  UNIFORM: 64,
  STORAGE: 128,
  INDIRECT: 256,
  QUERY_RESOLVE: 512,
};

const GPU_TEXTURE_USAGE = {
  COPY_SRC: 1,
  COPY_DST: 2,
  TEXTURE_BINDING: 4,
  STORAGE_BINDING: 8,
  RENDER_ATTACHMENT: 16,
  TRANSIENT_ATTACHMENT: 32,
};

const GPU_MAP_MODE = {
  READ: 1,
  WRITE: 2,
};

const originalNavigatorGpu =
  typeof navigator === 'undefined'
    ? undefined
    : Object.getOwnPropertyDescriptor(navigator, 'gpu');

export function installWebGpuGlobals() {
  Object.defineProperty(globalThis, 'GPUShaderStage', {
    configurable: true,
    writable: true,
    value: GPU_STAGE,
  });
  Object.defineProperty(globalThis, 'GPUBufferUsage', {
    configurable: true,
    writable: true,
    value: GPU_BUFFER_USAGE,
  });
  Object.defineProperty(globalThis, 'GPUTextureUsage', {
    configurable: true,
    writable: true,
    value: GPU_TEXTURE_USAGE,
  });
  Object.defineProperty(globalThis, 'GPUMapMode', {
    configurable: true,
    writable: true,
    value: GPU_MAP_MODE,
  });
}

export function installMockGpu(options?: {
  adapter?: Partial<GPUAdapter>;
  device?: Partial<GPUDevice>;
  preferredCanvasFormat?: GPUTextureFormat;
}) {
  const device = (options?.device ?? {
    label: 'test-webgpu-device',
  }) as GPUDevice;
  const requestDevice = async () => device;
  const adapter = {
    features: new Set(),
    limits: {},
    requestDevice,
    ...(options?.adapter ?? {}),
  } as GPUAdapter;

  const gpu = {
    requestAdapter: async () => adapter,
    getPreferredCanvasFormat: () =>
      options?.preferredCanvasFormat ?? 'bgra8unorm',
  };

  Object.defineProperty(navigator, 'gpu', {
    configurable: true,
    writable: true,
    value: gpu,
  });

  return { adapter, device, gpu, requestDevice };
}

export function resetMockGpu() {
  if (originalNavigatorGpu) {
    Object.defineProperty(navigator, 'gpu', originalNavigatorGpu);
    return;
  }

  Reflect.deleteProperty(navigator, 'gpu');
}
