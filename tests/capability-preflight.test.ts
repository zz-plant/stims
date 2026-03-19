import { afterEach, describe, expect, test } from 'bun:test';

import { attachCapabilityPreflight } from '../assets/js/core/capability-preflight.ts';
import type { CapabilityPreflightResult } from '../assets/js/core/services/capability-probe-service.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const setTestUrl = () => {
  (
    window as Window & { happyDOM?: { setURL?: (url: string) => void } }
  ).happyDOM?.setURL?.('https://example.com/toy.html?toy=milkdrop');
};

const readyResult: CapabilityPreflightResult = {
  rendering: {
    hasWebGL: true,
    rendererBackend: 'webgpu',
    webgpuFallbackReason: null,
    shouldRetryWebGPU: false,
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
    recommendedMaxPixelRatio: 1.25,
    recommendedRenderScale: 0.9,
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

  test('shows one primary CTA for the success step and keeps diagnostics collapsed', async () => {
    setTestUrl();

    const preflight = attachCapabilityPreflight({
      host: document.body,
      backHref: 'index.html',
      openOnAttach: true,
      showCloseButton: true,
      runPreflight: async () => readyResult,
    });

    await flush();
    await flush();

    const dialog = document.querySelector('dialog') as HTMLDialogElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(
      'Quick system check now, then a focused audio setup step.',
    );

    const primaryButtons = Array.from(
      dialog?.querySelectorAll('.cta-button.primary') ?? [],
    ).filter((button) => !(button as HTMLElement).hidden);

    expect(primaryButtons).toHaveLength(1);
    expect(primaryButtons[0]?.textContent).toContain('Continue to audio setup');

    const diagnostics = dialog?.querySelector(
      '.preflight-panel__details',
    ) as HTMLDetailsElement | null;
    expect(diagnostics?.open).toBe(false);

    preflight.destroy();
  });
});
