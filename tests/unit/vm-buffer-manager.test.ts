import { describe, expect, test } from 'bun:test';
import { createVmBufferManager } from '../../src/js/milkdrop/vm/buffer-manager.ts';

describe('createVmBufferManager', () => {
  test('computes layout with persistent staging buffers and float/uint views', () => {
    const manager = createVmBufferManager();
    const mockDevice = {
      createBuffer: () => ({ destroy: () => {} }),
      queue: {
        writeBuffer: () => {},
      },
    } as unknown as GPUDevice;

    const layout = manager.allocateBuffer(
      mockDevice,
      ['zoom', 'rot', 'dx', 'rand_state'],
      true,
      'test-buffer',
    );

    expect(layout.fieldCount).toBe(4);
    expect(layout.bufferSize).toBe(16);
    expect(layout.stagingBuffer).toBeInstanceOf(ArrayBuffer);
    expect(layout.stagingFloatView).toBeInstanceOf(Float32Array);
    expect(layout.stagingUintView).toBeInstanceOf(Uint32Array);
    expect(layout.stagingFloatView?.length).toBe(4);
    expect(layout.stagingUintView?.length).toBe(4);

    manager.dispose();
  });

  test('writeState reuses staging buffers across multiple writes', () => {
    const manager = createVmBufferManager();
    let writtenBuffer: unknown = null;

    const mockDevice = {
      createBuffer: () => ({ destroy: () => {} }),
      queue: {
        writeBuffer: (_buffer: unknown, _offset: number, data: unknown) => {
          writtenBuffer = data;
        },
      },
    } as unknown as GPUDevice;

    const layout = manager.allocateBuffer(
      mockDevice,
      ['zoom', 'rot'],
      false,
      'test-buffer',
    );

    const initialStagingBuffer = layout.stagingBuffer;
    expect(initialStagingBuffer).toBeDefined();

    manager.writeState(mockDevice, { zoom: 1.05, rot: 0.02 }, 12345);
    expect(writtenBuffer).toBe(initialStagingBuffer);

    manager.writeState(mockDevice, { zoom: 1.1, rot: 0.05 }, 67890);
    expect(writtenBuffer).toBe(initialStagingBuffer);

    manager.dispose();
  });

  test('writeState zeroes values f32 cannot hold instead of leaking Infinity', () => {
    const manager = createVmBufferManager();
    const mockDevice = {
      createBuffer: () => ({ destroy: () => {} }),
      queue: { writeBuffer: () => {} },
    } as unknown as GPUDevice;

    const layout = manager.allocateBuffer(
      mockDevice,
      ['zoom', 'rot'],
      false,
      'test-buffer',
    );
    const floats = layout.stagingFloatView as Float32Array;
    const zoomIndex = (layout.fieldOffsets.zoom as number) / 4;
    const rotIndex = (layout.fieldOffsets.rot as number) / 4;

    manager.writeState(mockDevice, { zoom: 1.05, rot: 0.02 }, 0);
    expect(floats[zoomIndex]).toBeCloseTo(1.05, 5);

    // 1e300 passes Number.isFinite but is +Infinity once stored as f32, and
    // the shader turns that into NaN on the first Inf-Inf. Every other tier
    // clamps this magnitude to 0, so the upload must too.
    manager.writeState(mockDevice, { zoom: 1e300, rot: Number.NaN }, 0);
    expect(floats[zoomIndex]).toBe(0);
    expect(floats[rotIndex]).toBe(0);

    manager.dispose();
  });
});
