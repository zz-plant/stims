export type VmBufferLayout = {
  fieldOffsets: Record<string, number>;
  fieldCount: number;
  bufferSize: number;
  buffer: GPUBuffer | null;
};

const FLOAT32_BYTES = 4;
const UINT32_BYTES = 4;

export function createVmBufferManager() {
  let layout: VmBufferLayout | null = null;

  function computeLayout(fieldKeys: string[], usesRandom: boolean) {
    const sortedFields = [...fieldKeys].sort();
    let offset = 0;
    const fieldOffsets: Record<string, number> = {};

    for (const key of sortedFields) {
      fieldOffsets[key] = offset;
      if (key === 'rand_state') {
        offset += UINT32_BYTES;
      } else {
        offset += FLOAT32_BYTES;
      }
    }

    if (usesRandom && !fieldKeys.includes('rand_state')) {
      fieldOffsets.rand_state = offset;
      offset += UINT32_BYTES;
    }

    return {
      fieldOffsets,
      fieldCount: Object.keys(fieldOffsets).length,
      bufferSize: offset,
      buffer: null as GPUBuffer | null,
    } satisfies VmBufferLayout;
  }

  function allocateBuffer(
    device: GPUDevice,
    fieldKeys: string[],
    usesRandom: boolean,
    label: string,
  ) {
    const newLayout = computeLayout(fieldKeys, usesRandom);
    const buffer = device.createBuffer({
      label,
      size: newLayout.bufferSize,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    newLayout.buffer = buffer;
    layout = newLayout;
    return newLayout;
  }

  function writeState(
    device: GPUDevice,
    state: Record<string, number>,
    randomState: number,
  ) {
    if (!layout?.buffer) {
      return;
    }

    const data = new ArrayBuffer(layout.bufferSize);
    const floatView = new Float32Array(data);
    const uintView = new Uint32Array(data);

    for (const [key, value] of Object.entries(state)) {
      const offset = layout.fieldOffsets[key];
      if (offset === undefined) {
        continue;
      }
      if (key === 'rand_state') {
        uintView[offset / UINT32_BYTES] = randomState;
      } else {
        const floatIndex = offset / FLOAT32_BYTES;
        if (Number.isFinite(value)) {
          floatView[floatIndex] = value;
        }
      }
    }

    if (layout.fieldOffsets.rand_state !== undefined) {
      const randOffset = layout.fieldOffsets.rand_state;
      uintView[randOffset / UINT32_BYTES] = randomState;
    }

    device.queue.writeBuffer(layout.buffer, 0, data);
  }

  async function readState(): Promise<Record<string, number>> {
    if (!layout?.buffer) {
      return {};
    }

    const data = new ArrayBuffer(layout.bufferSize);
    await layout.buffer.mapAsync(GPUMapMode.READ);
    const mapped = layout.buffer.getMappedRange();
    new Uint8Array(data).set(new Uint8Array(mapped));
    layout.buffer.unmap();

    const floatView = new Float32Array(data);
    const result: Record<string, number> = {};

    for (const key of Object.keys(layout.fieldOffsets)) {
      const offset = layout.fieldOffsets[key];
      if (offset === undefined) {
        continue;
      }
      if (key === 'rand_state') {
        continue;
      }
      const floatIndex = offset / FLOAT32_BYTES;
      result[key] =
        floatView[floatIndex] !== undefined ? floatView[floatIndex] : 0;
    }

    return result;
  }

  function dispose() {
    layout?.buffer?.destroy();
    layout = null;
  }

  function getLayout() {
    return layout;
  }

  return {
    allocateBuffer,
    writeState,
    readState,
    dispose,
    getLayout,
  };
}
