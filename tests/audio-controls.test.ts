import { beforeEach, describe, expect, test } from 'bun:test';
import { initAudioControls } from '../assets/js/ui/audio-controls.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('audio controls primary emphasis', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    const bootstrapScript = document.createElement('script');
    document.body.appendChild(bootstrapScript);
    globalThis.HTMLButtonElement =
      window.HTMLButtonElement as unknown as typeof HTMLButtonElement;
    window.matchMedia = ((query: string) =>
      ({
        media: query,
        matches: query === '(pointer: coarse)',
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;
  });

  test('highlights demo row when preferDemoAudio is true', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      preferDemoAudio: true,
    });

    const micRow = container.querySelector('[data-audio-row="mic"]');
    const demoRow = container.querySelector('[data-audio-row="demo"]');

    expect(micRow?.classList.contains('control-panel__row--primary')).toBe(
      false,
    );
    expect(demoRow?.classList.contains('control-panel__row--primary')).toBe(
      true,
    );
    expect(
      (
        container.querySelector(
          '[data-recommended-for="demo"]',
        ) as HTMLElement | null
      )?.hidden,
    ).toBe(false);
    expect(
      (
        container.querySelector(
          '[data-recommended-for="mic"]',
        ) as HTMLElement | null
      )?.hidden,
    ).toBe(true);
  });

  test('keeps microphone row primary by default', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    const micRow = container.querySelector('[data-audio-row="mic"]');
    const demoRow = container.querySelector('[data-audio-row="demo"]');

    expect(micRow?.classList.contains('control-panel__row--primary')).toBe(
      true,
    );
    expect(demoRow?.classList.contains('control-panel__row--primary')).toBe(
      false,
    );
  });

  test('shows comparison guidance and recommended source badge', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    expect(container.textContent).toContain(
      'Mic reacts to your space right now. Demo starts instantly with no permissions.',
    );

    const micBadge = container.querySelector('[data-recommended-for="mic"]');
    const demoBadge = container.querySelector('[data-recommended-for="demo"]');

    expect((micBadge as HTMLElement | null)?.hidden).toBe(false);
    expect((demoBadge as HTMLElement | null)?.hidden).toBe(true);
  });

  test('shows a two-step sequence with advanced options labeled optional', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestTabAudio: async () => {},
    });

    const stageLabels = Array.from(
      container.querySelectorAll('.control-panel__stage-label'),
    ).map((node) => node.textContent?.trim());

    expect(stageLabels).toContain('Step 1 · Start audio');
    expect(stageLabels).toContain('Step 2 · Advanced capture (optional)');
  });

  test('reveals touch gesture hints after audio starts on touch-capable devices', async () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      gestureHints: ['Pinch/rotate gestures', 'Drag to steer'],
    });

    const hintPanel = container.querySelector(
      '[data-gesture-hints]',
    ) as HTMLElement;
    expect(hintPanel.hidden).toBe(true);

    const demoButton = container.querySelector(
      '#use-demo-audio',
    ) as HTMLButtonElement;
    demoButton.click();
    await flush();

    expect(hintPanel.hidden).toBe(false);
    expect(hintPanel.textContent).toContain('Touch gestures');
    expect(hintPanel.textContent).toContain('Pinch/rotate gestures');
  });
  test('renders and dismisses the first-steps onboarding strip', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      firstRunHint: 'Try turning the main knob slowly for smoother motion.',
    });

    const firstSteps = container.querySelector(
      '[data-first-steps]',
    ) as HTMLElement;
    expect(firstSteps.hidden).toBe(false);
    expect(firstSteps.textContent).toContain('First 10 seconds');
    expect(firstSteps.textContent).toContain(
      'Try turning the main knob slowly for smoother motion.',
    );

    const dismiss = container.querySelector(
      '[data-dismiss-first-steps]',
    ) as HTMLButtonElement;
    dismiss.click();

    expect(firstSteps.hidden).toBe(true);
    expect(sessionStorage.getItem('stims-first-steps-dismissed')).toBe('true');
  });

  test('updates onboarding source copy when demo is preferred', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      preferDemoAudio: true,
    });

    const sourceStep = container.querySelector('[data-first-step-source]');
    expect(sourceStep?.textContent).toContain(
      'Start with demo for instant sound',
    );
  });
  test('switches emphasis to demo row after microphone failure', async () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {
        throw new Error('Mic denied');
      },
      onRequestDemoAudio: async () => {},
    });

    const micButton = container.querySelector(
      '#start-audio-btn',
    ) as HTMLButtonElement;
    micButton.click();
    await flush();

    const micRow = container.querySelector('[data-audio-row="mic"]');
    const demoRow = container.querySelector('[data-audio-row="demo"]');

    expect(micRow?.classList.contains('control-panel__row--primary')).toBe(
      false,
    );
    expect(demoRow?.classList.contains('control-panel__row--primary')).toBe(
      true,
    );
    expect(
      (
        container.querySelector(
          '[data-recommended-for="demo"]',
        ) as HTMLElement | null
      )?.hidden,
    ).toBe(false);
    expect(
      (
        container.querySelector(
          '[data-recommended-for="mic"]',
        ) as HTMLElement | null
      )?.hidden,
    ).toBe(true);
  });
});
