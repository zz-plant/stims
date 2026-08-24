import { describe, expect, test } from 'bun:test';
import { createGpuRenderTimingSampler } from '../../src/js/core/services/gpu-render-timing.ts';

describe('createGpuRenderTimingSampler', () => {
  test('resolves WebGPU timestamps off-frame and emits each sample once', async () => {
    let resolveSample!: (value: number) => void;
    const renderer = {
      isWebGPURenderer: true,
      resolveTimestampsAsync: () =>
        new Promise<number>((resolve) => {
          resolveSample = resolve;
        }),
    };
    const sampler = createGpuRenderTimingSampler({ sampleIntervalFrames: 2 });

    expect(sampler.sample(renderer)).toBeUndefined();
    expect(sampler.sample(renderer)).toBeUndefined();
    expect(resolveSample).toBeFunction();

    resolveSample(7.25);
    await Promise.resolve();
    await Promise.resolve();

    expect(sampler.sample(renderer)).toBe(7.25);
    expect(sampler.sample(renderer)).toBeUndefined();
  });

  test('keeps one resolve in flight and rejects invalid durations', async () => {
    let resolveCalls = 0;
    let finishResolve!: (value: number) => void;
    const renderer = {
      isWebGPURenderer: true,
      resolveTimestampsAsync: () => {
        resolveCalls += 1;
        return new Promise<number>((resolve) => {
          finishResolve = resolve;
        });
      },
    };
    const sampler = createGpuRenderTimingSampler({ sampleIntervalFrames: 1 });

    sampler.sample(renderer);
    sampler.sample(renderer);
    expect(resolveCalls).toBe(1);

    finishResolve(Number.NaN);
    await Promise.resolve();
    await Promise.resolve();

    expect(sampler.sample(renderer)).toBeUndefined();
  });
});
