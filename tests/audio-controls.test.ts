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
