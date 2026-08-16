/**
 * WebGPU Hardware Timestamp Query Profiler.
 *
 * Reads execution times directly from the GPU hardware via `GPUQuerySet` of type `'timestamp'`.
 * Measures render and compute pass durations with microsecond silicon precision,
 * completely decoupled from CPU scheduling and OS compositor queuing.
 */

export type WebGpuTimestampProfiler = {
  readonly supported: boolean;

  /** Encode the timestamp query resolve and buffer copy onto the command encoder. */
  resolve: (commandEncoder: GPUCommandEncoder) => void;

  /** Asynchronously read back the latest GPU execution duration in milliseconds. */
  readElapsedMs: () => Promise<number | null>;

  /** Clean up GPU buffers and query sets. */
  dispose: () => void;

  /** Get query set for writeTimestamp passes. */
  getQuerySet: () => GPUQuerySet | null;
};

export function createWebGpuTimestampProfiler(
  device: GPUDevice | null | undefined,
): WebGpuTimestampProfiler {
  if (!device?.features?.has('timestamp-query')) {
    return {
      supported: false,
      resolve: () => {},
      readElapsedMs: async () => null,
      dispose: () => {},
      getQuerySet: () => null,
    };
  }

  try {
    const querySet = device.createQuerySet({
      type: 'timestamp',
      count: 2,
    });

    const resolveBuffer = device.createBuffer({
      size: 2 * BigInt64Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });

    const readbackBuffer = device.createBuffer({
      size: 2 * BigInt64Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    let isMapped = false;
    let pendingResolve = false;

    return {
      supported: true,

      getQuerySet(): GPUQuerySet {
        return querySet;
      },

      resolve(commandEncoder: GPUCommandEncoder): void {
        if (isMapped) return;
        commandEncoder.resolveQuerySet(querySet, 0, 2, resolveBuffer, 0);
        commandEncoder.copyBufferToBuffer(
          resolveBuffer,
          0,
          readbackBuffer,
          0,
          2 * BigInt64Array.BYTES_PER_ELEMENT,
        );
        pendingResolve = true;
      },

      async readElapsedMs(): Promise<number | null> {
        if (!pendingResolve || isMapped) {
          return null;
        }

        try {
          isMapped = true;
          pendingResolve = false;
          await readbackBuffer.mapAsync(GPUMapMode.READ);
          const arrayBuffer = readbackBuffer.getMappedRange();
          const timestamps = new BigInt64Array(arrayBuffer.slice(0));
          readbackBuffer.unmap();
          isMapped = false;

          const startNs = Number(timestamps[0] ?? 0n);
          const endNs = Number(timestamps[1] ?? 0n);
          const durationNs = endNs - startNs;

          if (durationNs > 0 && durationNs < 1_000_000_000) {
            // Convert nanoseconds to milliseconds
            return durationNs / 1_000_000;
          }
          return null;
        } catch {
          isMapped = false;
          return null;
        }
      },

      dispose(): void {
        try {
          if (isMapped) {
            readbackBuffer.unmap();
            isMapped = false;
          }
          resolveBuffer.destroy();
          readbackBuffer.destroy();
          querySet.destroy();
        } catch {}
      },
    };
  } catch {
    return {
      supported: false,
      resolve: () => {},
      readElapsedMs: async () => null,
      dispose: () => {},
      getQuerySet: () => null,
    };
  }
}
