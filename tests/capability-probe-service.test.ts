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
        triedWebGPU: false,
        canRetryWebGPU: false,
      },
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
        triedWebGPU: true,
        canRetryWebGPU: false,
      },
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
      rendererBackend: 'webgl',
      triedWebGPU: true,
      shouldRetryWebGPU: false,
      webgpuFallbackReason: 'WebGPU unsupported',
    });
  });

  test('keeps output shape stable for unsupported microphone state', () => {
    const result = buildCapabilityPreflightResult({
      renderingSupport: { hasWebGL: true },
      rendererPlan: {
        backend: 'webgpu',
        reasonCode: null,
        reasonMessage: null,
        triedWebGPU: true,
        canRetryWebGPU: false,
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
      triedWebGPU: true,
      shouldRetryWebGPU: false,
    });
    expect(result.performance).toEqual({
      lowPower: true,
      reason: 'mobile device detected',
      recommendedMaxPixelRatio: 1.25,
      recommendedRenderScale: 0.9,
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
});
