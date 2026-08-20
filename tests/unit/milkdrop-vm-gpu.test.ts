import { describe, expect, test } from 'bun:test';
import type { MilkdropProgramBlock } from '../../src/js/milkdrop/types.ts';
import { createGpuVmRunner } from '../../src/js/milkdrop/vm-gpu.ts';

describe('GPU VM Runner', () => {
  test('initializes and dispatches without recreating signal buffer per frame', async () => {
    let bufferCreations = 0;
    let bindGroupCreations = 0;
    let destroyedBuffers = 0;
    let pipelineBindGroupEntries: Array<{
      binding: number;
      buffer?: { type?: string };
    }> = [];

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
      createBindGroupLayout(desc: {
        entries: Array<{ binding: number; buffer?: { type?: string } }>;
      }) {
        pipelineBindGroupEntries = desc.entries;
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
          copyBufferToBuffer() {},
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
    expect(
      pipelineBindGroupEntries.find((entry) => entry.binding === 1)?.buffer
        ?.type,
    ).toBe('read-only-storage');

    const initialBufferCount = bufferCreations;
    const initialBindGroupCount = bindGroupCreations;

    // First frame dispatch
    const firstResult = await runner.dispatch({
      time: 1.0,
      frame: 60,
      fps: 60,
      bass: 0.8,
    });
    expect(firstResult.registers).toHaveProperty('q1');

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

  test('megabuf programs run on the GPU with a bound guest-memory buffer', () => {
    const bufferLabels: string[] = [];
    let layoutEntries: Array<{ binding: number; buffer?: { type?: string } }> =
      [];
    let bindGroupBindings: number[] = [];
    const writtenBuffers = new Set<string>();

    const mockDevice = {
      createBuffer(desc: { label?: string; size: number }) {
        bufferLabels.push(desc.label ?? '');
        const bufSize = desc.size || 256;
        return {
          label: desc.label,
          destroy() {},
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
      createBindGroupLayout(desc: {
        entries: Array<{ binding: number; buffer?: { type?: string } }>;
      }) {
        layoutEntries = desc.entries;
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
      createBindGroup(desc: { entries: Array<{ binding: number }> }) {
        bindGroupBindings = desc.entries.map((entry) => entry.binding);
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
          copyBufferToBuffer() {},
          finish() {
            return {};
          },
        };
      },
      queue: {
        writeBuffer(buffer: { label?: string }) {
          writtenBuffers.add(buffer.label ?? '');
        },
        submit() {},
        async onSubmittedWorkDone() {},
      },
    };

    const runner = createGpuVmRunner();
    const megabuf = new Float32Array(8);
    megabuf[4] = 2.5;
    const initialized = runner.init(
      mockDevice as unknown as GPUDevice,
      {
        statements: [
          {
            target: 'q1',
            expression: {
              type: 'call',
              name: 'megabuf',
              args: [{ type: 'literal', value: 4 }],
            },
            source: 'q1=megabuf(4);',
            line: 1,
          },
        ],
        sourceLines: ['q1=megabuf(4);'],
      },
      { q1: 0 },
      1,
      {},
      { megabuf },
    );

    expect(initialized).toBe(true);
    expect(runner.isInitialized()).toBe(true);
    // binding 2 = megabuf storage; no binding 3 (program never touches
    // gmegabuf) and no megabuf readback allocation (read-only program).
    expect(
      layoutEntries.find((entry) => entry.binding === 2)?.buffer?.type,
    ).toBe('storage');
    expect(layoutEntries.some((entry) => entry.binding === 3)).toBe(false);
    expect(bindGroupBindings).toContain(2);
    expect(bufferLabels).toContain('milkdrop-vm-megabuf');
    expect(bufferLabels).not.toContain('milkdrop-vm-megabuf-readback');
    // The CPU mirror was uploaded at init.
    expect(writtenBuffers.has('milkdrop-vm-megabuf')).toBe(true);
    runner.dispose();
  });

  test('gmegabuf writer programs allocate the readback staging buffer', () => {
    const bufferLabels: string[] = [];
    const mockDevice = {
      createBuffer(desc: { label?: string; size: number }) {
        bufferLabels.push(desc.label ?? '');
        return {
          label: desc.label,
          destroy() {},
          async mapAsync() {},
          getMappedRange() {
            return new ArrayBuffer(desc.size || 256);
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
          copyBufferToBuffer() {},
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
    const initialized = runner.init(
      mockDevice as unknown as GPUDevice,
      {
        statements: [
          {
            target: 'gmegabuf',
            targetExpression: { type: 'literal', value: 7 },
            expression: { type: 'identifier', name: 'bass' },
            source: 'gmegabuf(7)=bass;',
            line: 1,
          },
        ],
        sourceLines: ['gmegabuf(7)=bass;'],
      },
      {},
      1,
      {},
      { gmegabuf: new Float32Array(16) },
    );

    expect(initialized).toBe(true);
    expect(bufferLabels).toContain('milkdrop-vm-gmegabuf');
    expect(bufferLabels).toContain('milkdrop-vm-gmegabuf-readback');
    runner.dispose();
  });
});
