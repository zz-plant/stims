import { expect, test } from 'bun:test';
import {
  buildPlayToyArtifactStem,
  buildPlayToyPerformanceMetrics,
  buildPlayToyPerformanceMetricsFromDebugSnapshot,
  buildPlayToyUrl,
  resolveChromiumRendererArgs,
  shouldUseCanvasBitmapCapture,
  summarizePlayToyPerformanceSamples,
} from '../scripts/play-toy.ts';

test('buildPlayToyUrl includes the requested preset for milkdrop captures', () => {
  expect(
    buildPlayToyUrl({
      port: 4173,
      slug: 'milkdrop',
      presetId: 'eos-glowsticks-v2-03-music',
    }),
  ).toBe(
    'http://127.0.0.1:4173/?agent=true&audio=demo&preset=eos-glowsticks-v2-03-music',
  );
});

test('buildPlayToyUrl omits the preset when none is provided', () => {
  expect(
    buildPlayToyUrl({
      port: 5173,
      slug: 'milkdrop',
    }),
  ).toBe('http://127.0.0.1:5173/?agent=true&audio=demo');
});

test('buildPlayToyUrl can force the certification corpus and webgpu runtime', () => {
  expect(
    buildPlayToyUrl({
      port: 4175,
      slug: 'milkdrop',
      presetId: '100-square',
      rendererProfile: 'webgpu',
      catalogMode: 'certification',
    }),
  ).toBe(
    'http://127.0.0.1:4175/?agent=true&audio=demo&preset=100-square&renderer=webgpu&corpus=certification',
  );
});

test('buildPlayToyArtifactStem normalizes slug and preset ids for saved artifacts', () => {
  expect(
    buildPlayToyArtifactStem({
      slug: 'MilkDrop',
      presetId: 'Rovastar / Parallel Universe',
    }),
  ).toBe('milkdrop--preset-rovastar-parallel-universe');
});

test('resolveChromiumRendererArgs keeps compatibility and webgpu launch profiles separate', () => {
  expect(resolveChromiumRendererArgs('compatibility')).toContain(
    '--enable-unsafe-swiftshader',
  );
  expect(resolveChromiumRendererArgs('compatibility')).not.toContain(
    '--enable-unsafe-webgpu',
  );
  expect(resolveChromiumRendererArgs('webgpu')).toContain(
    '--enable-unsafe-webgpu',
  );
  expect(resolveChromiumRendererArgs('webgpu')).not.toContain(
    '--enable-unsafe-swiftshader',
  );
});

test('shouldUseCanvasBitmapCapture only keeps bitmap capture when the live canvas already matches the viewport', () => {
  expect(
    shouldUseCanvasBitmapCapture({
      bitmapWidth: 2550,
      bitmapHeight: 1794,
      rectWidth: 2550,
      rectHeight: 1794,
      viewportWidth: 2550,
      viewportHeight: 1794,
    }),
  ).toBe(true);

  expect(
    shouldUseCanvasBitmapCapture({
      bitmapWidth: 2207,
      bitmapHeight: 1541,
      rectWidth: 2508,
      rectHeight: 1752,
      viewportWidth: 2550,
      viewportHeight: 1794,
    }),
  ).toBe(false);
});

test('summarizePlayToyPerformanceSamples computes average and p95 frame timings', () => {
  expect(
    summarizePlayToyPerformanceSamples([
      { frameMs: 10, renderMs: 4, simulationMs: 6 },
      { frameMs: 20, renderMs: 7, simulationMs: 13 },
      { frameMs: 15, renderMs: 5, simulationMs: 10 },
      { frameMs: 30, renderMs: 12, simulationMs: 18 },
    ]),
  ).toEqual({
    sampleCount: 4,
    averageFrameMs: 18.75,
    p95FrameMs: 30,
    averageSimulationMs: 11.75,
    averageRenderMs: 7,
  });
});

test('buildPlayToyPerformanceMetrics preserves terminal state alongside summarized timings', () => {
  expect(
    buildPlayToyPerformanceMetrics({
      samples: [
        { frameMs: 10, renderMs: 4, simulationMs: 6 },
        { frameMs: 14, renderMs: 5, simulationMs: 9 },
      ],
      durationMs: 4500,
      warmupMs: 1000,
      actualBackend: 'webgpu',
      fallbackOccurred: false,
      terminalAdaptiveQuality: { qualityPresetId: 'balanced' },
    }),
  ).toEqual({
    sampleCount: 2,
    averageFrameMs: 12,
    p95FrameMs: 14,
    averageSimulationMs: 7.5,
    averageRenderMs: 4.5,
    durationMs: 4500,
    warmupMs: 1000,
    actualBackend: 'webgpu',
    fallbackOccurred: false,
    terminalAdaptiveQuality: { qualityPresetId: 'balanced' },
  });
});

test('debug snapshot perf fallback prefers live runtime metrics when available', () => {
  expect(
    buildPlayToyPerformanceMetricsFromDebugSnapshot({
      snapshot: {
        performance: {
          sampleCount: 4,
          averageFrameMs: 38.4,
          p95FrameMs: 141.9,
          averageSimulationMs: 2.85,
          averageRenderMs: 35.55,
        },
      },
      durationMs: 4500,
      warmupMs: 1000,
      actualBackend: 'webgpu',
      fallbackOccurred: false,
      runtimePerformance: {
        sampleCount: 120,
        averageFrameMs: 9.5,
        p95FrameMs: 14,
        averageSimulationMs: 2,
        averageRenderMs: 7.5,
      },
      runtimeAdaptiveQuality: {
        sampleCount: 120,
        averageFrameMs: 10,
        averageRenderMs: 8,
      },
    }),
  ).toEqual({
    sampleCount: 120,
    averageFrameMs: 9.5,
    p95FrameMs: 14,
    averageSimulationMs: 2,
    averageRenderMs: 7.5,
    durationMs: 4500,
    warmupMs: 1000,
    actualBackend: 'webgpu',
    fallbackOccurred: false,
    terminalAdaptiveQuality: {
      sampleCount: 120,
      averageFrameMs: 10,
      averageRenderMs: 8,
    },
  });
});
