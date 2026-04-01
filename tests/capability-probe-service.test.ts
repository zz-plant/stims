import { describe, expect, test } from 'bun:test';
import { buildCapabilityPreflightResult } from '../assets/js/core/services/capability-probe-service.ts';
import { getMicrophoneCapabilityFromState } from '../assets/js/core/services/microphone-permission-service.ts';

describe('capability probe service', () => {
  test('derives blocking issue when rendering backend is unavailable', () => {
    const result = buildCapabilityPreflightResult({
      renderingSupport: { hasWebGL: false },
      rendererPlan: {
        backend: null,
        reasonCode: 'RENDERER_UNAVAILABLE',
        reasonMessage: 'Renderer unavailable',
        canRetryWebGPU: false,
      },
      rendererCapabilities: null,
      microphone: getMicrophoneCapabilityFromState('granted'),
      environment: {
        secureContext: true,
        hardwareConcurrency: 8,
      },
      performanceProfile: {
        lowPower: false,
        reason: null,
        reducedMotion: false,
      },
    });

    expect(result.blockingIssues).toEqual([
      'Graphics acceleration is unavailable (WebGL/WebGPU).',
    ]);
    expect(result.canProceed).toBe(false);
  });

  test('derives warnings from webgl fallback, denied microphone, and low-power profile', () => {
    const result = buildCapabilityPreflightResult({
      renderingSupport: { hasWebGL: true },
      rendererPlan: {
        backend: 'webgl',
        reasonCode: 'WEBGPU_UNAVAILABLE',
        reasonMessage: 'WebGPU unsupported',
        canRetryWebGPU: false,
      },
      rendererCapabilities: null,
      microphone: getMicrophoneCapabilityFromState('denied'),
      environment: {
        secureContext: true,
        hardwareConcurrency: 2,
      },
      performanceProfile: {
        lowPower: true,
        reason: 'limited CPU cores',
        reducedMotion: false,
      },
    });

    expect(result.warnings).toEqual([
      'WebGPU unsupported',
      'Microphone access is blocked; visuals will fall back to demo audio.',
      'Performance mode recommended for smoother visuals on this device.',
    ]);
    expect(result.canProceed).toBe(true);
    expect(result.rendering).toMatchObject({
      hasWebGL: true,
      rendererBackend: 'webgl',
      shouldRetryWebGPU: false,
      webgpuFallbackReason: 'WebGPU unsupported',
      webgpuCapabilities: null,
    });
    expect(result.performance.recommendedQualityPresetId).toBe('performance');
  });

  test('keeps output shape stable for unsupported microphone state', () => {
    const result = buildCapabilityPreflightResult({
      renderingSupport: { hasWebGL: true },
      rendererPlan: {
        backend: 'webgpu',
        reasonCode: null,
        reasonMessage: null,
        canRetryWebGPU: false,
      },
      rendererCapabilities: {
        webgpu: {
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
          preferredCanvasFormat: 'bgra8unorm',
          performanceTier: 'high-end',
          recommendedQualityPreset: 'hi-fi',
        },
      },
      microphone: getMicrophoneCapabilityFromState('unsupported'),
      environment: {
        secureContext: false,
        hardwareConcurrency: null,
      },
      performanceProfile: {
        lowPower: true,
        reason: 'mobile device detected',
        reducedMotion: true,
      },
    });

    expect(result.rendering).toEqual({
      hasWebGL: true,
      rendererBackend: 'webgpu',
      webgpuFallbackReason: null,
      shouldRetryWebGPU: false,
      webgpuCapabilities: {
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
        preferredCanvasFormat: 'bgra8unorm',
        performanceTier: 'high-end',
        recommendedQualityPreset: 'hi-fi',
      },
    });
    expect(result.performance).toEqual({
      lowPower: true,
      reason: 'mobile device detected',
      recommendedMaxPixelRatio: 1.25,
      recommendedRenderScale: 0.9,
      recommendedQualityPresetId: 'performance',
    });
    expect(result.environment).toEqual({
      secureContext: false,
      reducedMotion: true,
      hardwareConcurrency: null,
    });
    expect(result.warnings).toContain(
      'Microphone APIs are unavailable in this browser.',
    );
  });

  test('recommends hi-fi defaults for high-end WebGPU devices without low-power constraints', () => {
    const result = buildCapabilityPreflightResult({
      renderingSupport: { hasWebGL: true },
      rendererPlan: {
        backend: 'webgpu',
        reasonCode: null,
        reasonMessage: null,
        canRetryWebGPU: false,
      },
      rendererCapabilities: {
        webgpu: {
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
          preferredCanvasFormat: 'bgra8unorm',
          performanceTier: 'high-end',
          recommendedQualityPreset: 'hi-fi',
        },
      },
      microphone: getMicrophoneCapabilityFromState('granted'),
      environment: {
        secureContext: true,
        hardwareConcurrency: 10,
      },
      performanceProfile: {
        lowPower: false,
        reason: null,
        reducedMotion: false,
      },
    });

    expect(result.performance).toEqual({
      lowPower: false,
      reason: null,
      recommendedMaxPixelRatio: 2.5,
      recommendedRenderScale: 1,
      recommendedQualityPresetId: 'hi-fi',
    });
  });

  test('keeps popular handheld WebGPU devices on balanced defaults', () => {
    const result = buildCapabilityPreflightResult({
      renderingSupport: { hasWebGL: true },
      rendererPlan: {
        backend: 'webgpu',
        reasonCode: null,
        reasonMessage: null,
        canRetryWebGPU: false,
      },
      rendererCapabilities: {
        webgpu: {
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
          preferredCanvasFormat: 'bgra8unorm',
          performanceTier: 'high-end',
          recommendedQualityPreset: 'balanced',
        },
      },
      microphone: getMicrophoneCapabilityFromState('prompt'),
      environment: {
        secureContext: true,
        hardwareConcurrency: 6,
      },
      performanceProfile: {
        lowPower: false,
        reason: null,
        reducedMotion: false,
      },
    });

    expect(result.performance).toEqual({
      lowPower: false,
      reason: null,
      recommendedMaxPixelRatio: 2,
      recommendedRenderScale: 1,
      recommendedQualityPresetId: 'balanced',
    });
  });
});
