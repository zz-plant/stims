import { describe, expect, test } from 'bun:test';
import { buildCapabilityPreflightResult } from '../assets/js/core/services/capability-probe-service.ts';
import { getMicrophoneCapabilityFromState } from '../assets/js/core/services/microphone-permission-service.ts';

describe('capability probe service', () => {
  test('derives blocking issue when rendering backend is unavailable', () => {
    const result = buildCapabilityPreflightResult({
      renderingSupport: { hasWebGL: false },
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
      rendererCapabilities: {
        preferredBackend: 'webgl',
        fallbackReason: 'WebGPU unsupported',
        triedWebGPU: true,
        shouldRetryWebGPU: false,
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
      rendererCapabilities: {
        preferredBackend: 'webgpu',
        fallbackReason: null,
        triedWebGPU: true,
        shouldRetryWebGPU: false,
      },
      microphone: getMicrophoneCapabilityFromState('unsupported'),
      environment: {
        secureContext: false,
        hardwareConcurrency: null,
      },
      performanceProfile: {
        lowPower: false,
        reason: null,
        reducedMotion: true,
      },
    });

    expect(result).toEqual({
      rendering: {
        hasWebGL: true,
        rendererBackend: 'webgpu',
        webgpuFallbackReason: null,
        triedWebGPU: true,
        shouldRetryWebGPU: false,
      },
      microphone: {
        supported: false,
        state: 'unsupported',
        reason: 'This browser cannot capture microphone audio.',
      },
      environment: {
        secureContext: false,
        reducedMotion: true,
        hardwareConcurrency: null,
      },
      performance: {
        lowPower: false,
        reason: null,
        recommendedMaxPixelRatio: 1.25,
        recommendedRenderScale: 0.9,
      },
      blockingIssues: [],
      warnings: ['Microphone APIs are unavailable in this browser.'],
      canProceed: true,
    });
  });
});
