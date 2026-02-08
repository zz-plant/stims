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
  });
});
