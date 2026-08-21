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
  try {
    globalThis.window.sessionStorage?.removeItem(
      'stims:webgpu-performance-tier',
    );
  } catch {}
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

    for (let index = 0; index < 42; index += 1) {
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

  test('does not eagerly degrade during startup warmup or transient stutters', () => {
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

    const initialStep = controller.getState().qualityStep;

    // First 18 frames have shader compile jank (during 24-frame warmup)
    for (let index = 0; index < 18; index += 1) {
      controller.recordFrame({
        frameMs: 35,
        phases: { renderMs: 25 },
      });
    }
    // Controller should remain in warmup without stepping down
    expect(controller.getState().qualityStep).toBe(initialStep);

    // Next 10 frames are smooth (finishing warmup)
    for (let index = 0; index < 10; index += 1) {
      controller.recordFrame({
        frameMs: 12,
        phases: { renderMs: 8 },
      });
    }
    expect(controller.getState().qualityStep).toBe(initialStep);

    // Transient 5-frame hitch (less than DEGRADE_THRESHOLD_SAMPLES = 12)
    for (let index = 0; index < 5; index += 1) {
      controller.recordFrame({
        frameMs: 30,
        phases: { renderMs: 22 },
      });
    }
    expect(controller.getState().qualityStep).toBe(initialStep);
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
    // clear warmup and the rolling-window degrade threshold. Capture the state
    // at the moment of the degrade event: steady-state republishing means the
    // final published state legitimately settles back to 'steady' afterwards.
    let degradeState: ReturnType<typeof controller.getState> | null = null;
    for (let index = 0; index < windowSize + 12; index += 1) {
      const next = controller.recordFrame({
        frameMs: overBudgetFrameMs,
        phases: { renderMs: 2 },
      });
      if (!degradeState && next.adaptation === 'degraded') {
        degradeState = next;
      }
    }

    const state = controller.getState();
    expect(state.rollingAverageFrameMs).not.toBeNull();
    expect(state.rollingAverageFrameMs as number).toBeGreaterThan(budgetMs);
    expect(state.qualityStep).toBeGreaterThan(0);
    expect(degradeState).not.toBeNull();
    expect(
      degradeState?.reasons.some((reason) => reason.includes('5-second')),
    ).toBe(true);
  });

  test('starts conservatively and adapts on webgl backends', () => {
    const controller = createAdaptiveQualityController({
      backend: 'webgl',
      capabilities: null,
    });

    for (let index = 0; index < 42; index += 1) {
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
    expect(recovered.qualityStep).toBe(1);
    expect(recovered.feedbackResolutionMultiplier).toBeCloseTo(1.0, 6);
    expect(['steady', 'recovering']).toContain(recovered.adaptation);
  });

  test('degrades when presentation cadence misses budget despite cheap CPU work', () => {
    const controller = createAdaptiveQualityController({
      backend: 'webgl',
      capabilities: null,
    });

    for (let index = 0; index < 42; index += 1) {
      controller.recordFrame({
        frameMs: 5,
        cadenceMs: 28,
        phases: { renderMs: 2 },
      });
    }

    const state = controller.getState();
    expect(state.qualityStep).toBeGreaterThan(0);
    expect(state.averageFrameMs).toBeCloseTo(5, 6);
    expect(state.averageCadenceMs).toBeCloseTo(28, 6);
  });

  test('recovers when presenting exactly at the display cadence', () => {
    // Regression: hasHeadroom used to require averageCadenceMs to be
    // *faster* than the frame budget (`< budget * 0.9`). A session
    // presenting perfectly at vsync has cadenceMs === frameBudgetMs, which
    // never satisfies "faster than budget" — so once degraded, a session
    // that was rendering fine could never recover, on any 60Hz/120Hz
    // display. This pins that cadence exactly at budget still counts as
    // headroom.
    const controller = createAdaptiveQualityController({
      backend: 'webgl',
      capabilities: null,
    });

    for (let index = 0; index < 42; index += 1) {
      controller.recordFrame({
        frameMs: 20,
        cadenceMs: 28,
        phases: { renderMs: 2 },
      });
    }
    const degraded = controller.getState();
    expect(degraded.qualityStep).toBeGreaterThan(0);

    const frameBudgetMs = degraded.frameBudgetMs;
    for (let index = 0; index < 220; index += 1) {
      controller.recordFrame({
        frameMs: frameBudgetMs * 0.5,
        cadenceMs: frameBudgetMs,
        phases: { renderMs: frameBudgetMs * 0.3 },
      });
    }

    const recovered = controller.getState();
    expect(recovered.qualityStep).toBeLessThan(degraded.qualityStep);
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

    for (let index = 0; index < 42; index += 1) {
      controller.recordFrame({
        frameMs: 5,
        cadenceMs: 16,
        gpuMs: 16,
        phases: { renderMs: 2 },
      });
    }

    const state = controller.getState();
    expect(state.qualityStep).toBeGreaterThan(0);
    expect(state.averageRenderMs).toBeCloseTo(2, 6);
    expect(state.averageGpuMs).toBeCloseTo(16, 6);
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
      expect(state.qualityStep).toBe(1);
      expect(state.frameBudgetMs).toBeCloseTo(1000 / 60, 4);
      expect(state.reasons).toContain(
        'Flagship mobile sessions start from full quality with adaptive throttling headroom.',
      );

      // Sustained headroom must not enhance mobile past the full-quality
      // floor back into ultra (step 0): the extra density/feedback fill costs
      // more on a phone than the over-1.0 multipliers are worth.
      for (let index = 0; index < 60; index += 1) {
        controller.recordFrame({
          frameMs: 8,
          phases: { renderMs: 5 },
        });
      }
      expect(controller.getState().qualityStep).toBe(1);
    } finally {
      Object.defineProperty(navigator, 'maxTouchPoints', {
        configurable: true,
        value: originalMaxTouchPoints,
      });
      window.matchMedia = originalMatchMedia;
    }
  });

  test('notePresetApplied pre-degrades constrained profiles after warmup, never high-end', () => {
    const capabilitiesForTier = (performanceTier: 'baseline' | 'high-end') => ({
      preferredCanvasFormat: 'bgra8unorm' as const,
      performanceTier,
      recommendedQualityPreset: 'balanced' as const,
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
    });

    const baseline = createAdaptiveQualityController({
      backend: 'webgpu',
      capabilities: capabilitiesForTier('baseline'),
    });
    const startStep = baseline.getState().qualityStep;

    // During session warmup a switch clears evidence but must not pre-degrade
    // (the boot heuristics already start conservatively).
    baseline.notePresetApplied();
    expect(baseline.getState().qualityStep).toBe(startStep);

    // Get past warmup with settled frames, then pin a known mid step so the
    // +1 is observable regardless of where this environment's heuristics
    // settle the baseline profile.
    for (let index = 0; index < 30; index += 1) {
      baseline.recordFrame({ frameMs: 12, phases: { renderMs: 8 } });
    }
    baseline.setQualityStep(2);
    const state = baseline.notePresetApplied();
    expect(state.qualityStep).toBe(3);
    expect(state.adaptation).toBe('degraded');

    const highEnd = createAdaptiveQualityController({
      backend: 'webgpu',
      capabilities: capabilitiesForTier('high-end'),
    });
    for (let index = 0; index < 30; index += 1) {
      highEnd.recordFrame({ frameMs: 6, phases: { renderMs: 4 } });
    }
    const highEndStep = highEnd.getState().qualityStep;
    highEnd.notePresetApplied();
    expect(highEnd.getState().qualityStep).toBe(highEndStep);

    const locked = createAdaptiveQualityController({
      backend: 'webgpu',
      capabilities: capabilitiesForTier('baseline'),
      lockedQualityStep: 2,
    });
    for (let index = 0; index < 30; index += 1) {
      locked.recordFrame({ frameMs: 12, phases: { renderMs: 8 } });
    }
    locked.notePresetApplied();
    expect(locked.getState().qualityStep).toBe(2);
  });

  test('a burst of preset switches does not ratchet quality down', () => {
    // Reported as "swiping through presets too quickly makes the rendering
    // break". It was not a rendering bug: the switch pre-degrade is charged
    // per switch, but earning a step back needs RECOVER_THRESHOLD_SAMPLES
    // *consecutive* under-budget frames, and every switch resets that
    // counter. Stacking took a constrained device from `full` to `minimal` in
    // four switches — density 1 -> 0.55, feedback resolution 1 -> 0.52 — on
    // frames that were never once over budget.
    const healthy = { frameMs: 8, cadenceMs: 16.7, gpuMs: 4 };
    const controller = createAdaptiveQualityController({
      backend: 'webgl',
      capabilities: null,
    });
    for (let index = 0; index < 40; index += 1) {
      controller.recordFrame(healthy);
    }
    const settled = controller.getState().qualityStep;

    controller.notePresetApplied();
    const afterFirstSwitch = controller.getState().qualityStep;
    // The single-switch warm-up pre-pay is deliberate and still happens.
    expect(afterFirstSwitch).toBe(settled + 1);

    // Seven more switches at a swipe cadence, every frame healthy.
    for (let swipe = 0; swipe < 7; swipe += 1) {
      controller.notePresetApplied();
      for (let frame = 0; frame < 12; frame += 1) {
        controller.recordFrame(healthy);
      }
    }
    expect(controller.getState().qualityStep).toBe(afterFirstSwitch);

    // And it still recovers once the swiping stops.
    for (let frame = 0; frame < 400; frame += 1) {
      controller.recordFrame(healthy);
    }
    expect(controller.getState().qualityStep).toBe(settled);

    // Recovery re-arms the pre-pay, so a later switch is covered again.
    controller.notePresetApplied();
    expect(controller.getState().qualityStep).toBe(settled + 1);
  });

  test('genuine sustained pressure still walks down past the pre-pay', () => {
    // The guard above must not blunt the real controller: a device that is
    // actually over budget still has to keep stepping down.
    const controller = createAdaptiveQualityController({
      backend: 'webgl',
      capabilities: null,
    });
    for (let index = 0; index < 40; index += 1) {
      controller.recordFrame({ frameMs: 8, cadenceMs: 16.7, gpuMs: 4 });
    }
    const settled = controller.getState().qualityStep;

    controller.notePresetApplied();
    for (let frame = 0; frame < 200; frame += 1) {
      controller.recordFrame({ frameMs: 45, cadenceMs: 45, gpuMs: 40 });
    }
    expect(controller.getState().qualityStep).toBeGreaterThan(settled + 1);
  });

  test('pressure-induced recovery does not re-arm the switch pre-pay early', () => {
    // The pre-pay tracks the step it degraded FROM, not a bare flag. With a
    // flag, pressure could degrade further steps and the first recovery — which
    // only claws back a pressure step — would re-arm the pre-pay while quality
    // was still below where the switch found it. Alternating pressure,
    // one-step recovery and switching then walks downward again.
    const healthy = { frameMs: 8, cadenceMs: 16.7, gpuMs: 4 };
    const slow = { frameMs: 45, cadenceMs: 45, gpuMs: 40 };
    const controller = createAdaptiveQualityController({
      backend: 'webgl',
      capabilities: null,
    });
    for (let index = 0; index < 40; index += 1) {
      controller.recordFrame(healthy);
    }
    const settled = controller.getState().qualityStep;

    controller.notePresetApplied();
    expect(controller.getState().qualityStep).toBe(settled + 1);

    // Real pressure takes it further down.
    for (let frame = 0; frame < 120; frame += 1) {
      controller.recordFrame(slow);
    }
    const underPressure = controller.getState().qualityStep;
    expect(underPressure).toBeGreaterThan(settled + 1);

    // Enough headroom to claw back one step, but not back to `settled`.
    let step = underPressure;
    let guard = 0;
    while (step >= underPressure && guard < 200) {
      controller.recordFrame(healthy);
      step = controller.getState().qualityStep;
      guard += 1;
    }
    expect(step).toBeGreaterThan(settled);

    // A switch here must NOT pre-pay again — the first one is still unearned.
    controller.notePresetApplied();
    expect(controller.getState().qualityStep).toBe(step);
  });
});
