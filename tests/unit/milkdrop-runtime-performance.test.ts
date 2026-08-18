import { expect, test } from 'bun:test';
import { buildAgentMilkdropDebugSnapshot } from '../../src/js/milkdrop/runtime/debug-snapshot.ts';
import { createMilkdropRuntimePerformanceTracker } from '../../src/js/milkdrop/runtime/performance-tracker.ts';
import { createMilkdropPresentationController } from '../../src/js/milkdrop/runtime/presentation-controller.ts';

test('tracks rolling performance metrics and exposes p95 frame time', () => {
  const tracker = createMilkdropRuntimePerformanceTracker(5);

  tracker.recordFrame({ frameMs: 10, simulationMs: 3, renderMs: 7 });
  tracker.recordFrame({ frameMs: 20, simulationMs: 6, renderMs: 14 });
  tracker.recordFrame({ frameMs: 30, simulationMs: 9, renderMs: 21 });

  expect(tracker.getSnapshot()).toEqual({
    sampleCount: 3,
    windowSize: 5,
    averageFrameMs: 20,
    averageSimulationMs: 6,
    averageRenderMs: 14,
    p95FrameMs: 30,
    maxFrameMs: 30,
    gpuTimings: null,
  });
});

test('buildAgentMilkdropDebugSnapshot carries performance metrics', () => {
  const snapshot = buildAgentMilkdropDebugSnapshot({
    activePresetId: 'rovastar-parallel-universe',
    compiledPreset: null,
    frameState: null,
    status: 'ok',
    performance: {
      sampleCount: 4,
      windowSize: 8,
      averageFrameMs: 15.5,
      averageSimulationMs: 5.5,
      averageRenderMs: 10,
      p95FrameMs: 17,
      maxFrameMs: 18,
      gpuTimings: null,
    },
  });

  expect(snapshot.performance).toEqual({
    sampleCount: 4,
    windowSize: 8,
    averageFrameMs: 15.5,
    averageSimulationMs: 5.5,
    averageRenderMs: 10,
    p95FrameMs: 17,
    maxFrameMs: 18,
    gpuTimings: null,
  });
});

// Blend-alpha behavior now lives in runtime/transition-controller.ts and is
// covered by tests/unit/milkdrop-transition-controller.test.ts.
