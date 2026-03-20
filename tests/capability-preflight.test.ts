import { afterEach, describe, expect, test } from 'bun:test';

import { attachCapabilityPreflight } from '../assets/js/core/capability-preflight.ts';
import type { CapabilityPreflightResult } from '../assets/js/core/services/capability-probe-service.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const setTestUrl = () => {
  (
    window as Window & { happyDOM?: { setURL?: (url: string) => void } }
  ).happyDOM?.setURL?.('https://example.com/milkdrop/');
};

const readyResult: CapabilityPreflightResult = {
  rendering: {
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
      preferredCanvasFormat: 'bgra8unorm',
      performanceTier: 'high-end',
      recommendedQualityPreset: 'hi-fi',
    },
  },
  microphone: {
    supported: true,
    state: 'prompt',
    reason: null,
  },
  environment: {
    secureContext: true,
    reducedMotion: false,
    hardwareConcurrency: 8,
  },
  performance: {
    lowPower: false,
    reason: null,
    recommendedMaxPixelRatio: 2.5,
    recommendedRenderScale: 1,
    recommendedQualityPresetId: 'hi-fi',
  },
  blockingIssues: [],
  warnings: [],
  canProceed: true,
};

describe('capability preflight launch flow', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    setTestUrl();
    sessionStorage.clear();
  });

  test('shows one primary CTA for the success step and keeps technical details collapsed', async () => {
    setTestUrl();

    const preflight = attachCapabilityPreflight({
      host: document.body,
      backHref: '/',
      openOnAttach: true,
      showCloseButton: true,
      runPreflight: async () => readyResult,
    });

    await flush();
    await flush();

    const dialog = document.querySelector('dialog') as HTMLDialogElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(
      'We check whether visuals and audio can start here.',
    );

    const primaryButtons = Array.from(
      dialog?.querySelectorAll('.cta-button.primary') ?? [],
    ).filter((button) => !(button as HTMLElement).hidden);

    expect(primaryButtons).toHaveLength(1);
    expect(primaryButtons[0]?.textContent).toContain('Choose audio');

    const diagnostics = dialog?.querySelector(
      '.preflight-panel__details',
    ) as HTMLDetailsElement | null;
    expect(diagnostics?.open).toBe(false);
    expect(diagnostics?.textContent).toContain('Technical details');

    preflight.destroy();
  });
});
