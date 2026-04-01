import { describe, expect, test } from 'bun:test';
import { createAdaptiveQualityController } from '../assets/js/core/services/adaptive-quality-controller.ts';

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
    expect(recovered.feedbackResolutionMultiplier).toBe(1);
    expect(recovered.supportsGpuTimestamps).toBe(true);
    expect(['steady', 'recovering']).toContain(recovered.adaptation);
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
    expect(recovered.qualityStep).toBe(1);
    expect(recovered.feedbackResolutionMultiplier).toBeCloseTo(0.9, 6);
    expect(['steady', 'recovering']).toContain(recovered.adaptation);
  });
});
