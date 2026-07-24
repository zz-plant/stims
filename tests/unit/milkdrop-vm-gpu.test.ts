import { describe, expect, test } from 'bun:test';
import type { MilkdropProgramBlock } from '../../src/js/milkdrop/types.ts';
import { createGpuVmRunner } from '../../src/js/milkdrop/vm-gpu.ts';

describe('GPU VM Runner', () => {
  test('initializes and dispatches without recreating signal buffer per frame', async () => {
    let bufferCreations = 0;
    let bindGroupCreations = 0;
    let destroyedBuffers = 0;

    const mockDevice = {
      createBuffer(desc: { label?: string; size: number }) {
        bufferCreations += 1;
        const bufSize = desc.size || 256;
        return {
          destroy() {
            destroyedBuffers += 1;
          },
          async mapAsync() {},
          getMappedRange() {
            return new ArrayBuffer(bufSize);
          },
          unmap() {},
        };
      },
      createShaderModule() {
        return {};
      },
      createBindGroupLayout() {
        return {};
      },
      createPipelineLayout() {
        return {};
      },
      createComputePipeline() {
        return {
          getBindGroupLayout() {
            return {};
          },
        };
      },
      createBindGroup() {
        bindGroupCreations += 1;
        return {};
      },
      createCommandEncoder() {
        return {
          beginComputePass() {
            return {
              setPipeline() {},
              setBindGroup() {},
              dispatchWorkgroups() {},
              end() {},
            };
          },
          finish() {
            return {};
          },
        };
      },
      queue: {
        writeBuffer() {},
        submit() {},
        async onSubmittedWorkDone() {},
      },
    };

    const runner = createGpuVmRunner();

    const block: MilkdropProgramBlock = {
      statements: [
        {
          target: 'q1',
          expression: {
            type: 'binary',
            operator: '+',
            left: { type: 'identifier', name: 'bass' },
            right: { type: 'literal', value: 1 },
          },
          source: 'q1=bass+1;',
          line: 1,
        },
      ],
      sourceLines: ['q1=bass+1;'],
    };

    runner.init(mockDevice as unknown as GPUDevice, block, { q1: 0 }, 12345);
    expect(runner.isInitialized()).toBe(true);

    const initialBufferCount = bufferCreations;
    const initialBindGroupCount = bindGroupCreations;

    // First frame dispatch
    await runner.dispatch({
      time: 1.0,
      frame: 60,
      fps: 60,
      bass: 0.8,
    });

    // Second frame dispatch
    await runner.dispatch({
      time: 1.016,
      frame: 61,
      fps: 60,
      bass: 0.85,
    });

    // No new signal buffer or bind group should be allocated on frame dispatches
    expect(bufferCreations).toBe(initialBufferCount);
    expect(bindGroupCreations).toBe(initialBindGroupCount);

    runner.dispose();
    expect(runner.isInitialized()).toBe(false);
    expect(destroyedBuffers).toBeGreaterThan(0);
  });
});
