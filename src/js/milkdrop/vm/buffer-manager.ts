export type VmBufferLayout = {
  fieldOffsets: Record<string, number>;
  fieldCount: number;
  bufferSize: number;
  buffer: GPUBuffer | null;
  /** COPY_DST|MAP_READ staging buffer for readState — the storage buffer
   * itself cannot be mapped (STORAGE+MAP_READ is an invalid usage
   * combination, and mapping it directly throws on real devices). */
  readbackBuffer?: GPUBuffer | null;
  stagingBuffer?: ArrayBuffer;
  stagingFloatView?: Float32Array;
  stagingUintView?: Uint32Array;
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

    const stagingBuffer = new ArrayBuffer(offset);
    return {
      fieldOffsets,
      fieldCount: Object.keys(fieldOffsets).length,
      bufferSize: offset,
      buffer: null as GPUBuffer | null,
      readbackBuffer: null as GPUBuffer | null,
      stagingBuffer,
      stagingFloatView: new Float32Array(stagingBuffer),
      stagingUintView: new Uint32Array(stagingBuffer),
    } satisfies VmBufferLayout;
  }

  function allocateBuffer(
    device: GPUDevice,
    fieldKeys: string[],
    usesRandom: boolean,
    label: string,
  ) {
    if (layout?.buffer) {
      layout.buffer.destroy();
    }
    layout?.readbackBuffer?.destroy();
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
    newLayout.readbackBuffer = device.createBuffer({
      label: `${label}-readback`,
      size: newLayout.bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
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

    let data = layout.stagingBuffer;
    let floatView = layout.stagingFloatView;
    let uintView = layout.stagingUintView;

    if (
      !data ||
      !floatView ||
      !uintView ||
      data.byteLength !== layout.bufferSize
    ) {
      data = new ArrayBuffer(layout.bufferSize);
      floatView = new Float32Array(data);
      uintView = new Uint32Array(data);
      layout.stagingBuffer = data;
      layout.stagingFloatView = floatView;
      layout.stagingUintView = uintView;
    }

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

  async function readState(
    device?: GPUDevice,
  ): Promise<Record<string, number>> {
    if (!layout?.buffer) {
      return {};
    }

    const data = new ArrayBuffer(layout.bufferSize);
    // Route through the MAP_READ staging buffer when a device is available;
    // mapping the storage buffer directly is a validation error on real GPUs
    // (kept as a fallback for mock devices in unit tests that predate the
    // readback buffer).
    const readback = layout.readbackBuffer;
    if (device && readback) {
      const encoder = device.createCommandEncoder({
        label: 'milkdrop-vm-state-readback',
      });
      encoder.copyBufferToBuffer(
        layout.buffer,
        0,
        readback,
        0,
        layout.bufferSize,
      );
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      new Uint8Array(data).set(new Uint8Array(readback.getMappedRange()));
      readback.unmap();
    } else {
      await layout.buffer.mapAsync(GPUMapMode.READ);
      new Uint8Array(data).set(new Uint8Array(layout.buffer.getMappedRange()));
      layout.buffer.unmap();
    }

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
    layout?.readbackBuffer?.destroy();
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
