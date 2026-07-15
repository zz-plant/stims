import { expect, mock, test } from 'bun:test';
import {
  buildPlayToyArtifactStem,
  buildPlayToyPerformanceMetrics,
  buildPlayToyPerformanceMetricsFromDebugSnapshot,
  buildPlayToyUrl,
  captureActiveToyCanvas,
  didPlayToyRendererFallback,
  getPlayToyAudioActivationError,
  isPlayToyPresetReady,
  normalizePlayToyOptions,
  resolveChromiumRendererArgs,
  shouldRequestDemoAudio,
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
    'http://127.0.0.1:4173/?agent=true&audio=demo&preset=eos-glowsticks-v2-03-music&renderer=webgl',
  );
});

test('buildPlayToyUrl omits the preset when none is provided', () => {
  expect(
    buildPlayToyUrl({
      port: 5173,
      slug: 'milkdrop',
    }),
  ).toBe('http://127.0.0.1:5173/?agent=true&audio=demo&renderer=webgl');
});

test('buildPlayToyUrl pins compatibility captures to WebGL', () => {
  expect(
    buildPlayToyUrl({
      port: 4174,
      slug: 'milkdrop',
      presetId: '100-square',
      rendererProfile: 'compatibility',
    }),
  ).toBe(
    'http://127.0.0.1:4174/?agent=true&audio=demo&preset=100-square&renderer=webgl',
  );
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

test('didPlayToyRendererFallback only reports a departure from the requested backend', () => {
  expect(
    didPlayToyRendererFallback({
      requestedProfile: 'compatibility',
      actualBackend: 'webgl',
      explicitFallback: false,
    }),
  ).toBe(false);
  expect(
    didPlayToyRendererFallback({
      requestedProfile: 'webgpu',
      actualBackend: 'webgl',
      explicitFallback: false,
    }),
  ).toBe(true);
  expect(
    didPlayToyRendererFallback({
      requestedProfile: 'webgpu',
      actualBackend: 'webgpu',
      explicitFallback: false,
    }),
  ).toBe(false);
});

test('normalizePlayToyOptions keeps vibe mode opt-in for visual captures', () => {
  expect(normalizePlayToyOptions({ slug: 'milkdrop' }).vibeMode).toBe(false);
  expect(
    normalizePlayToyOptions({ slug: 'milkdrop', vibeMode: true }).vibeMode,
  ).toBe(true);
});

test('shouldRequestDemoAudio does not treat a loaded canvas as active audio', () => {
  expect(
    shouldRequestDemoAudio({
      demoRequestedByRoute: true,
      audioActive: false,
    }),
  ).toBe(true);
  expect(
    shouldRequestDemoAudio({
      demoRequestedByRoute: true,
      audioActive: true,
    }),
  ).toBe(false);
  expect(
    shouldRequestDemoAudio({
      demoRequestedByRoute: false,
      audioActive: false,
    }),
  ).toBe(false);
});

test('capture runs fail clearly when requested demo audio never activates', () => {
  expect(
    getPlayToyAudioActivationError({
      demoRequestedByRoute: true,
      audioActive: false,
    }),
  ).toBe(
    'Demo audio was requested by the capture route, but audio never became active.',
  );
});

test('active requested demo audio does not fail capture validation', () => {
  expect(
    getPlayToyAudioActivationError({
      demoRequestedByRoute: true,
      audioActive: true,
    }),
  ).toBeNull();
  expect(
    getPlayToyAudioActivationError({
      demoRequestedByRoute: false,
      audioActive: false,
    }),
  ).toBeNull();
});

test('isPlayToyPresetReady waits for the requested preset instead of shell readiness', () => {
  expect(
    isPlayToyPresetReady({
      requestedPresetId: '100-square',
      activePresetId: 'signal-bloom',
    }),
  ).toBe(false);
  expect(
    isPlayToyPresetReady({
      requestedPresetId: '100-square',
      activePresetId: '100-square',
    }),
  ).toBe(true);
  expect(
    isPlayToyPresetReady({
      requestedPresetId: undefined,
      activePresetId: 'signal-bloom',
    }),
  ).toBe(true);
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

test('captureActiveToyCanvas isolates undersized backing buffers from shell overlays', async () => {
  const outputPath = '/tmp/stims-canvas-capture-regression.png';
  const screenshot = mock(async ({ path }: { path: string }) => {
    expect(path).toBe(outputPath);
  });
  let evaluateCall = 0;
  const evaluate = mock(async () => {
    evaluateCall += 1;
    if (evaluateCall === 1) {
      return {
        bitmapWidth: 910,
        bitmapHeight: 518,
        rectWidth: 1215,
        rectHeight: 690,
        viewportWidth: 1280,
        viewportHeight: 720,
      };
    }
    if (evaluateCall === 2) {
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
    }
    return null;
  });
  const locator = {
    screenshot,
  };
  const page = {
    evaluate,
    viewportSize: () => ({ width: 1280, height: 720 }),
    locator: () => locator,
  } as never;

  expect(await captureActiveToyCanvas(page, outputPath)).toBe(true);

  expect(screenshot).toHaveBeenCalledTimes(0);
});

test('captureActiveToyCanvas fails closed when WebGL pixel reads are unavailable', async () => {
  const screenshot = mock(async () => undefined);
  const page = {
    evaluate: mock(async (callback: unknown) => {
      const source = String(callback);
      if (source.includes('bitmapWidth:')) {
        return {
          bitmapWidth: 1142,
          bitmapHeight: 648,
          rectWidth: 1215,
          rectHeight: 690,
          viewportWidth: 1265,
          viewportHeight: 720,
        };
      }
      return null;
    }),
    viewportSize: () => ({ width: 1280, height: 720 }),
    locator: () => ({ first: () => ({ screenshot }) }),
  } as never;

  expect(await captureActiveToyCanvas(page, '/tmp/canvas-only.png')).toBe(
    false,
  );
  expect(screenshot).toHaveBeenCalledTimes(0);
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
