import { expect, mock, test } from 'bun:test';
import sharp from 'sharp';
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
} from '../../scripts/play-toy.ts';

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

test('normalizePlayToyOptions can keep deterministic captures silent', () => {
  expect(
    normalizePlayToyOptions({ slug: 'milkdrop', audioMode: 'none' }).audioMode,
  ).toBe('none');
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
  expect(resolveChromiumRendererArgs('webgpu', 'darwin')).not.toContain(
    '--use-angle=vulkan',
  );
  expect(resolveChromiumRendererArgs('webgpu', 'linux')).toContain(
    '--use-angle=vulkan',
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

/**
 * The capture path changed shape: it screenshots the canvas *element* with
 * siblings hidden by visibility (what lab:visual has always done and what
 * survives on WebGPU), and refuses a frame with no picture in it rather than
 * writing it as evidence. The compositor clip is the second chance, not the
 * first.
 */
test('captureActiveToyCanvas screenshots the canvas element', async () => {
  const outputPath = '/tmp/stims-canvas-capture-element.png';
  // Two different pixels, so the blank-frame guard keeps it.
  const png = await sharp({
    create: {
      width: 2,
      height: 1,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: 1,
            height: 1,
            channels: 3,
            background: { r: 255, g: 255, b: 255 },
          },
        },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  const elementScreenshot = mock(async () => png);
  const pageScreenshot = mock(async () => png);
  const page = {
    evaluate: mock(async () => ({
      bitmapWidth: 910,
      bitmapHeight: 518,
      rectX: 0,
      rectY: 0,
      rectWidth: 1215,
      rectHeight: 690,
      viewportWidth: 1280,
      viewportHeight: 720,
      backend: 'webgl',
    })),
    viewportSize: () => ({ width: 4, height: 2 }),
    locator: () => ({ first: () => ({ screenshot: elementScreenshot }) }),
    screenshot: pageScreenshot,
  } as never;

  expect(await captureActiveToyCanvas(page, outputPath)).toBe(true);
  expect(elementScreenshot).toHaveBeenCalledTimes(1);
  // The compositor path is only the fallback for a blank element capture.
  expect(pageScreenshot).toHaveBeenCalledTimes(0);
});

test('captureActiveToyCanvas refuses a frame with no picture in it', async () => {
  const outputPath = '/tmp/stims-canvas-capture-blank.png';
  const blank = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
  const elementScreenshot = mock(async () => blank);
  const pageScreenshot = mock(async () => blank);
  const page = {
    evaluate: mock(async () => ({
      bitmapWidth: 1142,
      bitmapHeight: 648,
      rectX: 15,
      rectY: 10,
      rectWidth: 1265,
      rectHeight: 720,
      viewportWidth: 1280,
      viewportHeight: 720,
      backend: 'webgpu',
    })),
    viewportSize: () => ({ width: 4, height: 4 }),
    locator: () => ({ first: () => ({ screenshot: elementScreenshot }) }),
    screenshot: pageScreenshot,
  } as never;

  expect(await captureActiveToyCanvas(page, outputPath)).toBe(false);
  // Both paths tried before giving up, and neither result was kept.
  expect(elementScreenshot).toHaveBeenCalledTimes(1);
  expect(pageScreenshot).toHaveBeenCalledTimes(1);
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
    locator: () => ({ screenshot }),
  } as never;

  expect(await captureActiveToyCanvas(page, '/tmp/canvas-only.png')).toBe(
    false,
  );
  expect(screenshot).toHaveBeenCalledTimes(0);
});

test('summarizePlayToyPerformanceSamples computes average and p95 frame timings', () => {
  expect(
    summarizePlayToyPerformanceSamples([
      // The first sample has no predecessor, so it carries no cadence and must
      // be excluded from the cadence average rather than counted as zero.
      { frameMs: 10, renderMs: 4, simulationMs: 6, cadenceMs: null },
      { frameMs: 20, renderMs: 7, simulationMs: 13, cadenceMs: 40 },
      { frameMs: 15, renderMs: 5, simulationMs: 10, cadenceMs: 60 },
      { frameMs: 30, renderMs: 12, simulationMs: 18, cadenceMs: 50 },
    ]),
  ).toEqual({
    sampleCount: 4,
    averageFrameMs: 18.75,
    p95FrameMs: 30,
    averageSimulationMs: 11.75,
    averageRenderMs: 7,
    averageCadenceMs: 50,
    medianCadenceMs: 50,
    p95CadenceMs: 60,
    averageFps: 20,
    medianFps: 20,
  });
});

test('buildPlayToyPerformanceMetrics preserves terminal state alongside summarized timings', () => {
  expect(
    buildPlayToyPerformanceMetrics({
      samples: [
        { frameMs: 10, renderMs: 4, simulationMs: 6, cadenceMs: null },
        { frameMs: 14, renderMs: 5, simulationMs: 9, cadenceMs: 25 },
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
    averageCadenceMs: 25,
    medianCadenceMs: 25,
    p95CadenceMs: 25,
    averageFps: 40,
    medianFps: 40,
    metricsSource: 'sampler',
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
        averageCadenceMs: 50,
      },
    }),
  ).toEqual({
    sampleCount: 120,
    averageFrameMs: 9.5,
    p95FrameMs: 14,
    averageSimulationMs: 2,
    averageRenderMs: 7.5,
    // Cadence, not in-callback frame time, is what the fallback path reports as
    // delivered FPS.
    averageCadenceMs: 50,
    medianCadenceMs: null,
    p95CadenceMs: null,
    averageFps: 20,
    medianFps: null,
    metricsSource: 'debug-snapshot',
    durationMs: 4500,
    warmupMs: 1000,
    actualBackend: 'webgpu',
    fallbackOccurred: false,
    terminalAdaptiveQuality: {
      sampleCount: 120,
      averageFrameMs: 10,
      averageRenderMs: 8,
      averageCadenceMs: 50,
    },
  });
});
