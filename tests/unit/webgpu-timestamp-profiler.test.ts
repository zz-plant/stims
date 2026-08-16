import { describe, expect, test } from 'bun:test';
import { createWebGpuTimestampProfiler } from '../../src/js/core/webgpu-timestamp-profiler.ts';

describe('createWebGpuTimestampProfiler', () => {
  test('gracefully degrades when device is null or lacks timestamp-query', async () => {
    const profiler = createWebGpuTimestampProfiler(null);
    expect(profiler.supported).toBe(false);
    expect(profiler.getQuerySet()).toBeNull();
    const elapsed = await profiler.readElapsedMs();
    expect(elapsed).toBeNull();
  });

  test('initializes query set when device supports timestamp-query', () => {
    const mockQuerySet = { destroy: () => {} };
    const mockBuffer = {
      destroy: () => {},
      mapAsync: async () => {},
      unmap: () => {},
      getMappedRange: () => new ArrayBuffer(16),
    };

    const mockDevice = {
      features: new Set(['timestamp-query']),
      createQuerySet: () => mockQuerySet,
      createBuffer: () => mockBuffer,
    } as unknown as GPUDevice;

    const profiler = createWebGpuTimestampProfiler(mockDevice);
    expect(profiler.supported).toBe(true);
    expect(profiler.getQuerySet()).toBe(mockQuerySet as unknown as GPUQuerySet);
    profiler.dispose();
  });
});
