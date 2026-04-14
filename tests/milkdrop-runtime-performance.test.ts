import { expect, test } from 'bun:test';
import { buildAgentMilkdropDebugSnapshot } from '../assets/js/milkdrop/runtime/debug-snapshot.ts';
import { buildBlendStateForRender } from '../assets/js/milkdrop/runtime/lifecycle.ts';
import { createMilkdropRuntimePerformanceTracker } from '../assets/js/milkdrop/runtime/performance-tracker.ts';
import { createMilkdropPresentationController } from '../assets/js/milkdrop/runtime/presentation-controller.ts';

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
  });
});

test('buildBlendStateForRender reuses the active blend payload', () => {
  const blendState = {
    mode: 'gpu' as const,
    previousFrame: { presetId: 'signal-bloom' } as never,
    alpha: 1,
  };

  const result = buildBlendStateForRender({
    transitionMode: 'blend',
    shaderQuality: 'balanced',
    canBlendCurrentFrame: true,
    blendState,
    now: 500,
    blendEndAtMs: 1500,
    blendDuration: 2,
  });

  expect(result).toBe(blendState);
  expect(result?.alpha).toBeCloseTo(0.5, 6);
});

test('presentation controller throttles agent debug snapshot refreshes', () => {
  const setDebugSnapshotCalls: Array<{ tool: string; snapshot: unknown }> = [];

  const controller = createMilkdropPresentationController({
    getOverlay: () => null,
    session: {
      getState: () => ({}),
    } as never,
    vm: {
      setPreset: () => {},
      setRenderBackend: () => {},
    } as never,
    getAdapter: () => null,
    getState: () => ({
      activePresetId: 'rovastar-parallel-universe',
      compiledPreset: {
        source: { id: 'rovastar-parallel-universe' },
        title: 'Rovastar Parallel Universe',
      } as never,
      frameState: null,
      backend: 'webgpu',
      status: null,
      adaptiveQuality: null,
    }),
    setCompiledState: () => {},
    isAgentMode: () => true,
    setDebugSnapshot: (tool, snapshot) => {
      setDebugSnapshotCalls.push({ tool, snapshot });
    },
    getPerformanceMetrics: () => ({
      sampleCount: 1,
      windowSize: 4,
      averageFrameMs: 12,
      averageSimulationMs: 4,
      averageRenderMs: 8,
      p95FrameMs: 12,
      maxFrameMs: 12,
    }),
  });

  controller.updateAgentDebugSnapshot(true);
  controller.updateAgentDebugSnapshot();
  expect(setDebugSnapshotCalls).toHaveLength(1);

  controller.updateAgentDebugSnapshot(true);
  expect(setDebugSnapshotCalls).toHaveLength(2);
});
