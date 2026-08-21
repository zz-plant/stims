import { EEL_F32_MAX } from '../compiler/eel-function-table.ts';

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
  /** Reused destination for readState, so the GPU tier does not allocate a
   * fresh state-sized ArrayBuffer every frame. Separate from `stagingBuffer`,
   * which is the WRITE staging path — sharing one would let a readback
   * clobber a pending write. */
  readStagingBuffer?: ArrayBuffer;
};

const FLOAT32_BYTES = 4;
const UINT32_BYTES = 4;

/**
 * Mirror of the WGSL `milkdropFinite` clamp — same `EEL_F32_MAX` bound, for values crossing the CPU/GPU
 * seam. `Number.isFinite` is NOT sufficient here: it accepts f64 values the
 * CPU tiers legitimately produce (1e300 survives their own finite clamp) that
 * become +/-Infinity the instant they are stored into a Float32Array. That
 * Infinity then reaches every WGSL expression reading the field and turns
 * into NaN on the first `Inf - Inf` / `Inf * 0`, and because VM state
 * persists across frames the NaN never washes out.
 */
function toGpuFinite(value: number): number {
  return Math.abs(value) < EEL_F32_MAX ? value : 0;
}

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
        // Always write. Skipping the store on a bad value left the previous
        // frame's number sitting at that offset in the reused staging
        // buffer, so the GPU silently ran a frame behind on that field
        // instead of seeing the 0 every other tier clamps to.
        floatView[floatIndex] = toGpuFinite(value);
      }
    }

    if (layout.fieldOffsets.rand_state !== undefined) {
      const randOffset = layout.fieldOffsets.rand_state;
      uintView[randOffset / UINT32_BYTES] = randomState;
    }

    device.queue.writeBuffer(layout.buffer, 0, data);
  }

  /**
   * Reads the whole state buffer back in ONE mapping, including `rand_state`.
   *
   * The random state lives inside this same buffer, so returning it here
   * costs nothing: the copy already carries those four bytes. vm-gpu used to
   * follow this call with its own encoder + submit + mapAsync just for
   * `rand_state`, which is a second full CPU/GPU sync point per frame for
   * data that was already in hand.
   */
  async function readState(device?: GPUDevice): Promise<{
    fields: Record<string, number>;
    randomState: number | null;
  }> {
    if (!layout?.buffer) {
      return { fields: {}, randomState: null };
    }

    // Reused across frames: readState runs once per frame on the GPU tier, and
    // a fresh ArrayBuffer per call is per-frame garbage for no benefit.
    layout.readStagingBuffer ??= new ArrayBuffer(layout.bufferSize);
    const data = layout.readStagingBuffer;
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
    let randomState: number | null = null;

    for (const key of Object.keys(layout.fieldOffsets)) {
      const offset = layout.fieldOffsets[key];
      if (offset === undefined) {
        continue;
      }
      if (key === 'rand_state') {
        // A u32, not a float — read through a Uint32 view of the same bytes.
        randomState = new Uint32Array(data, offset, 1)[0] ?? null;
        continue;
      }
      const floatIndex = offset / FLOAT32_BYTES;
      // Readback is the GPU -> persistent-CPU-state trust boundary: anything
      // non-finite that escaped a shader path without a milkdropFinite store
      // would otherwise be adopted as this preset's state forever.
      const raw = floatView[floatIndex];
      result[key] = raw === undefined ? 0 : toGpuFinite(raw);
    }

    return { fields: result, randomState };
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
