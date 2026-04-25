/* global GPUDevice, GPUQuerySet, GPUCommandEncoder, GPUComputePassEncoder, GPURenderPassEncoder, GPUBuffer */

export type GpuTimestampLabels =
  | 'simulation'
  | 'render'
  | 'postprocess'
  | 'present';

export type GpuTimestampResult = {
  simulationMs: number | null;
  renderMs: number | null;
  postprocessMs: number | null;
  presentMs: number | null;
  gpuTotalMs: number | null;
  available: boolean;
};

const QUERY_COUNT = 4;
const TIMESTAMP_INDEX: Record<GpuTimestampLabels, number> = {
  simulation: 0,
  render: 1,
  postprocess: 2,
  present: 3,
};

type ActiveQuerySet = {
  querySet: GPUQuerySet;
  resolveBuffer: GPUBuffer;
  readbackBuffer: GPUBuffer;
};

export function createGpuTimestampInstrumentation() {
  let device: GPUDevice | null = null;
  let activeQuerySet: ActiveQuerySet | null = null;
  let timestampPeriodNs = 1;

  function init(gpuDevice: GPUDevice) {
    device = gpuDevice;
    timestampPeriodNs = 1;
  }

  function beginFrame() {
    if (!device) {
      return null;
    }

    const querySet = device.createQuerySet({
      label: 'milkdrop-gpu-timestamps',
      type: 'timestamp' as GPUQueryType,
      count: QUERY_COUNT,
    });

    const resolveBuffer = device.createBuffer({
      label: 'milkdrop-gpu-timestamp-resolve',
      size: QUERY_COUNT * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });

    const readbackBuffer = device.createBuffer({
      label: 'milkdrop-gpu-timestamp-readback',
      size: QUERY_COUNT * 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    activeQuerySet = { querySet, resolveBuffer, readbackBuffer };
    return activeQuerySet;
  }

  function writeTimestamp(
    pass: { writeTimestamp?: (querySet: GPUQuerySet, index: number) => void },
    label: GpuTimestampLabels,
  ) {
    if (!activeQuerySet) {
      return;
    }
    pass.writeTimestamp?.(activeQuerySet.querySet, TIMESTAMP_INDEX[label]);
  }

  function resolveFrame(commandEncoder: GPUCommandEncoder) {
    if (!activeQuerySet || !device) {
      return;
    }

    commandEncoder.resolveQuerySet(
      activeQuerySet.querySet,
      0,
      QUERY_COUNT,
      activeQuerySet.resolveBuffer,
      0,
    );

    commandEncoder.copyBufferToBuffer(
      activeQuerySet.resolveBuffer,
      0,
      activeQuerySet.readbackBuffer,
      0,
      QUERY_COUNT * 8,
    );
  }

  async function readResults(): Promise<GpuTimestampResult> {
    if (!activeQuerySet) {
      return {
        simulationMs: null,
        renderMs: null,
        postprocessMs: null,
        presentMs: null,
        gpuTotalMs: null,
        available: false,
      };
    }

    try {
      await activeQuerySet.readbackBuffer.mapAsync(GPUMapMode.READ);
      const mapped = new BigInt64Array(
        activeQuerySet.readbackBuffer.getMappedRange(),
      );
      const timestamps = Array.from(mapped);

      activeQuerySet.readbackBuffer.unmap();
      activeQuerySet.resolveBuffer.destroy();
      activeQuerySet.querySet.destroy();
      activeQuerySet = null;

      const scale = Number(timestampPeriodNs) / 1e6;

      const simulationTs = timestamps[TIMESTAMP_INDEX.simulation];
      const renderTs = timestamps[TIMESTAMP_INDEX.render];
      const postprocessTs = timestamps[TIMESTAMP_INDEX.postprocess];
      const presentTs = timestamps[TIMESTAMP_INDEX.present];

      if (
        simulationTs === undefined ||
        renderTs === undefined ||
        postprocessTs === undefined ||
        presentTs === undefined
      ) {
        return {
          simulationMs: null,
          renderMs: null,
          postprocessMs: null,
          presentMs: null,
          gpuTotalMs: null,
          available: false,
        };
      }

      const simulationMs = Number(renderTs - simulationTs) * scale;
      const renderMs = Number(postprocessTs - renderTs) * scale;
      const postprocessMs = Number(presentTs - postprocessTs) * scale;
      const presentMs = Number(presentTs - simulationTs) * scale;

      return {
        simulationMs: clampPositive(simulationMs),
        renderMs: clampPositive(renderMs),
        postprocessMs: clampPositive(postprocessMs),
        presentMs: clampPositive(presentMs),
        gpuTotalMs: clampPositive(presentMs),
        available: true,
      };
    } catch (_error) {
      if (activeQuerySet) {
        activeQuerySet.resolveBuffer.destroy();
        activeQuerySet.querySet.destroy();
        activeQuerySet = null;
      }
      return {
        simulationMs: null,
        renderMs: null,
        postprocessMs: null,
        presentMs: null,
        gpuTotalMs: null,
        available: false,
      };
    }
  }

  function dispose() {
    if (activeQuerySet) {
      activeQuerySet.resolveBuffer.destroy();
      activeQuerySet.querySet.destroy();
      activeQuerySet = null;
    }
    device = null;
  }

  return {
    init,
    beginFrame,
    writeTimestamp,
    resolveFrame,
    readResults,
    dispose,
  };
}

function clampPositive(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
