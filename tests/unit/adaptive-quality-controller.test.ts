import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createAdaptiveQualityController } from '../../src/js/core/services/adaptive-quality-controller.ts';

const originalMatchMedia = globalThis.window?.matchMedia;
const originalNavigator = globalThis.navigator;

/**
 * The controller reads pointer/reduced-motion media queries and touch points
 * when choosing a starting quality step. Other suites replace matchMedia
 * globally, so without a deterministic baseline these assertions depend on
 * which test file ran first — they passed on developer machines and failed on
 * CI for exactly that reason. Individual tests still override as needed.
 */
beforeEach(() => {
  // Navigator first, and never behind a `window` guard: the starting quality
  // step is gated on isMobileDevice()/isInAppBrowser(), which read userAgent,
  // platform and maxTouchPoints. An earlier version of this hook returned
  // early when window was undefined and silently skipped all of it.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      ...originalNavigator,
      // A plain desktop browser: not mobile, not an in-app webview.
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Linux x86_64',
      userAgentData: undefined,
      maxTouchPoints: 0,
      // getDevicePerformanceProfile treats <=3 cores or <=3GB as low power.
      hardwareConcurrency: 8,
      deviceMemory: 8,
    },
  });

  if (typeof globalThis.window === 'undefined') return;

  // Nothing matches: no coarse pointer, no reduced motion, and no
  // `(update: fast)`, which pins getDisplayRefreshRate to its 60Hz baseline.
  // The expected quality steps in this suite are written against 60Hz; a
  // 120Hz budget starts the controller several steps more aggressive.
  globalThis.window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;

  // happy-dom exposes screen.refreshRate on some hosts and not others, and it
  // short-circuits the refresh-rate probe before matchMedia is consulted.
  if (typeof screen !== 'undefined' && 'refreshRate' in screen) {
    delete (screen as unknown as { refreshRate?: number }).refreshRate;
  }

  // renderer-capabilities stamps this on window at runtime and most suites
  // never clear it; a leaked "high-end" value promotes every device to ultra.
  delete (
    globalThis.window as unknown as {
      __stims_webgpu_performance_tier?: string;
    }
  ).__stims_webgpu_performance_tier;
});

afterEach(() => {
  if (typeof globalThis.window !== 'undefined' && originalMatchMedia) {
    globalThis.window.matchMedia = originalMatchMedia;
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });
});

describe('createAdaptiveQualityController', () => {
  test('starts from capability heuristics for baseline webgpu devices', () => {
    const controller = createAdaptiveQualityController({
      backend: 'webgpu',
      capabilities: {
        preferredCanvasFormat: 'bgra8unorm',
        performanceTier: 'baseline',
        recommendedQualityPreset: 'balanced',
        workers: {
          workers: true,
          offscreenCanvas: true,
          transferControlToOffscreen: true,
        },
        optimization: {
          timestampQuery: false,
          shaderF16: false,
          subgroups: false,
          workers: true,
          offscreenCanvas: true,
          transferControlToOffscreen: true,
          workerOffscreenPipeline: true,
        },
        features: {
          bgra8unormStorage: false,
          float32Blendable: false,
          float32Filterable: false,
          shaderF16: false,
          subgroups: false,
          timestampQuery: false,
        },
        limits: {
          maxColorAttachments: 4,
          maxComputeInvocationsPerWorkgroup: 256,
          maxStorageBufferBindingSize: 268_435_456,
          maxTextureDimension2D: 4_096,
        },
      },
    });

    const state = controller.getState();
    expect(state.enabled).toBe(true);
    expect(state.profile).toBe('baseline');
    expect(state.qualityStep).toBeGreaterThan(1);
    expect(state.renderScaleMultiplier).toBeLessThan(1);
    expect(state.feedbackResolutionMultiplier).toBeLessThan(1);
    expect(state.timingMode).toBe('coarse-frame');
  });

  test('degrades quickly under sustained pressure and recovers with headroom', () => {
    const controller = createAdaptiveQualityController({
      backend: 'webgpu',
      capabilities: {
        preferredCanvasFormat: 'bgra8unorm',
        performanceTier: 'high-end',
        recommendedQualityPreset: 'hi-fi',
        workers: {
          workers: true,
          offscreenCanvas: true,
          transferControlToOffscreen: true,
        },
        optimization: {
          timestampQuery: true,
          shaderF16: true,
          subgroups: true,
          workers: true,
          offscreenCanvas: true,
          transferControlToOffscreen: true,
          workerOffscreenPipeline: true,
        },
        features: {
          bgra8unormStorage: true,
          float32Blendable: true,
          float32Filterable: true,
          shaderF16: true,
          subgroups: true,
          timestampQuery: true,
        },
        limits: {
          maxColorAttachments: 8,
          maxComputeInvocationsPerWorkgroup: 1_024,
          maxStorageBufferBindingSize: 1_073_741_824,
          maxTextureDimension2D: 16_384,
        },
      },
    });

    for (let index = 0; index < 24; index += 1) {
      controller.recordFrame({
        frameMs: 24,
        phases: { renderMs: 18 },
      });
    }

    const degraded = controller.getState();
    expect(degraded.qualityStep).toBeGreaterThan(0);
    expect(degraded.renderScaleMultiplier).toBeLessThan(1);

    for (let index = 0; index < 160; index += 1) {
      controller.recordFrame({
        frameMs: 8,
        phases: { renderMs: 5 },
      });
    }

    const recovered = controller.getState();
    expect(recovered.qualityStep).toBe(0);
    expect(recovered.feedbackResolutionMultiplier).toBeCloseTo(1.25, 6);
    expect(recovered.supportsGpuTimestamps).toBe(true);
    expect(['steady', 'recovering', 'enhanced']).toContain(
      recovered.adaptation,
    );
  });

  test('degrades when the 5-second rolling frame-time average exceeds budget', () => {
    const controller = createAdaptiveQualityController({
      backend: 'webgpu',
      capabilities: {
        preferredCanvasFormat: 'bgra8unorm',
        performanceTier: 'high-end',
        recommendedQualityPreset: 'hi-fi',
        workers: {
          workers: true,
          offscreenCanvas: true,
          transferControlToOffscreen: true,
        },
        optimization: {
          timestampQuery: true,
          shaderF16: true,
          subgroups: true,
          workers: true,
          offscreenCanvas: true,
          transferControlToOffscreen: true,
          workerOffscreenPipeline: true,
        },
        features: {
          bgra8unormStorage: true,
          float32Blendable: true,
          float32Filterable: true,
          shaderF16: true,
          subgroups: true,
          timestampQuery: true,
        },
        limits: {
          maxColorAttachments: 8,
          maxComputeInvocationsPerWorkgroup: 1_024,
          maxStorageBufferBindingSize: 1_073_741_824,
          maxTextureDimension2D: 16_384,
        },
      },
    });

    const budgetMs = controller.getState().frameBudgetMs;
    const windowSize = controller.getState().rollingWindowSize;
    const overBudgetFrameMs = budgetMs * 1.5;

    // Fill the rolling window with over-budget frames, plus enough samples to
    // clear warmup and the rolling-window degrade threshold.
    for (let index = 0; index < windowSize + 6; index += 1) {
      controller.recordFrame({
        frameMs: overBudgetFrameMs,
        phases: { renderMs: 2 },
      });
    }

    const state = controller.getState();
    expect(state.rollingAverageFrameMs).not.toBeNull();
    expect(state.rollingAverageFrameMs as number).toBeGreaterThan(budgetMs);
    expect(state.qualityStep).toBeGreaterThan(0);
    expect(state.adaptation).toBe('degraded');
    expect(state.reasons.some((reason) => reason.includes('5-second'))).toBe(
      true,
    );
  });

  test('starts conservatively and adapts on webgl backends', () => {
    const controller = createAdaptiveQualityController({
      backend: 'webgl',
      capabilities: null,
    });

    for (let index = 0; index < 24; index += 1) {
      controller.recordFrame({
        frameMs: 34,
        phases: { renderMs: 28 },
      });
    }

    const degraded = controller.getState();
    expect(degraded.enabled).toBe(true);
    expect(degraded.profile).toBe('fallback-webgl');
    expect(degraded.qualityStep).toBeGreaterThan(1);
    expect(degraded.renderScaleMultiplier).toBeLessThan(1);

    for (let index = 0; index < 160; index += 1) {
      controller.recordFrame({
        frameMs: 8,
        phases: { renderMs: 5 },
      });
    }

    const recovered = controller.getState();
    expect(recovered.qualityStep).toBe(2);
    expect(recovered.feedbackResolutionMultiplier).toBeCloseTo(0.9, 6);
    expect(['steady', 'recovering']).toContain(recovered.adaptation);
  });

  test('degrades when presentation cadence misses budget despite cheap CPU work', () => {
    const controller = createAdaptiveQualityController({
      backend: 'webgl',
      capabilities: null,
    });

    for (let index = 0; index < 24; index += 1) {
      controller.recordFrame({
        frameMs: 5,
        cadenceMs: 28,
        phases: { renderMs: 2 },
      });
    }

    const state = controller.getState();
    expect(state.qualityStep).toBeGreaterThan(2);
    expect(state.averageFrameMs).toBeCloseTo(5, 6);
    expect(state.averageCadenceMs).toBeCloseTo(28, 6);
  });

  test('uses supplied GPU duration to detect render pressure', () => {
    const controller = createAdaptiveQualityController({
      backend: 'webgpu',
      capabilities: {
        preferredCanvasFormat: 'bgra8unorm',
        performanceTier: 'high-end',
        recommendedQualityPreset: 'hi-fi',
        workers: {
          workers: true,
          offscreenCanvas: true,
          transferControlToOffscreen: true,
        },
        optimization: {
          timestampQuery: true,
          shaderF16: true,
          subgroups: true,
          workers: true,
          offscreenCanvas: true,
          transferControlToOffscreen: true,
          workerOffscreenPipeline: true,
        },
        features: {
          bgra8unormStorage: true,
          float32Blendable: true,
          float32Filterable: true,
          shaderF16: true,
          subgroups: true,
          timestampQuery: true,
        },
        limits: {
          maxColorAttachments: 8,
          maxComputeInvocationsPerWorkgroup: 1024,
          maxStorageBufferBindingSize: 4294967292,
          maxTextureDimension2D: 16384,
        },
      },
    });

    for (let index = 0; index < 24; index += 1) {
      controller.recordFrame({
        frameMs: 5,
        cadenceMs: 16,
        gpuMs: 15,
        phases: { renderMs: 2 },
      });
    }

    const state = controller.getState();
    expect(state.qualityStep).toBeGreaterThan(0);
    expect(state.averageRenderMs).toBeCloseTo(2, 6);
    expect(state.averageGpuMs).toBeCloseTo(15, 6);
  });

  test('starts one step down when high-end webgpu devices prefer balanced quality', () => {
    const controller = createAdaptiveQualityController({
      backend: 'webgpu',
      capabilities: {
        preferredCanvasFormat: 'bgra8unorm',
        performanceTier: 'high-end',
        recommendedQualityPreset: 'balanced',
        workers: {
          workers: false,
          offscreenCanvas: false,
          transferControlToOffscreen: false,
        },
        optimization: {
          timestampQuery: true,
          shaderF16: true,
          subgroups: true,
          workers: false,
          offscreenCanvas: false,
          transferControlToOffscreen: false,
          workerOffscreenPipeline: false,
        },
        features: {
          bgra8unormStorage: true,
          float32Blendable: true,
          float32Filterable: true,
          shaderF16: true,
          subgroups: true,
          timestampQuery: true,
        },
        limits: {
          maxColorAttachments: 8,
          maxComputeInvocationsPerWorkgroup: 1024,
          maxStorageBufferBindingSize: 4294967292,
          maxTextureDimension2D: 16384,
        },
      },
    });

    const state = controller.getState();
    expect(state.qualityStep).toBe(1);
    expect(state.renderScaleMultiplier).toBe(1);
    expect(state.reasons).toContain(
      'Balanced startup quality is preferred on touch-first devices for steadier frame pacing.',
    );
  });

  test('uses a sustained 60hz budget and balanced start on mobile webgpu', () => {
    const originalMaxTouchPoints = navigator.maxTouchPoints;
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      value: 5,
    });
    window.matchMedia = ((query: string) =>
      ({
        media: query,
        matches: query === '(pointer: coarse)' || query === '(hover: none)',
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;

    try {
      const controller = createAdaptiveQualityController({
        backend: 'webgpu',
        capabilities: {
          preferredCanvasFormat: 'bgra8unorm',
          performanceTier: 'high-end',
          recommendedQualityPreset: 'hi-fi',
          workers: {
            workers: true,
            offscreenCanvas: true,
            transferControlToOffscreen: true,
          },
          optimization: {
            timestampQuery: true,
            shaderF16: true,
            subgroups: true,
            workers: true,
            offscreenCanvas: true,
            transferControlToOffscreen: true,
            workerOffscreenPipeline: true,
          },
          features: {
            bgra8unormStorage: true,
            float32Blendable: true,
            float32Filterable: true,
            shaderF16: true,
            subgroups: true,
            timestampQuery: true,
          },
          limits: {
            maxColorAttachments: 8,
            maxComputeInvocationsPerWorkgroup: 1024,
            maxStorageBufferBindingSize: 4294967292,
            maxTextureDimension2D: 16384,
          },
        },
      });

      const state = controller.getState();
      expect(state.qualityStep).toBe(2);
      expect(state.frameBudgetMs).toBeCloseTo(1000 / 60, 4);
      expect(state.reasons).toContain(
        'Touch-first mobile sessions start from balanced quality for steadier sustained performance.',
      );
    } finally {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        value: originalMaxTouchPoints,
      });
      window.matchMedia = originalMatchMedia;
    }
  });
});
