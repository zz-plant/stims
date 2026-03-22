import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { createToyAudioPromptController } from '../assets/js/loader/toy-audio-prompt-controller.ts';

describe('toy audio prompt controller', () => {
  beforeEach(() => {
    delete document.body.dataset.audioActive;
    document.body.innerHTML = '<div id="active-toy-container"></div>';
  });

  test('shows the shell-managed prompt when audio starters are available and shell controls are absent', () => {
    const showAudioPrompt = mock();
    const controller = createToyAudioPromptController({
      view: { showAudioPrompt },
    });

    controller.maybeShowPrompt({
      launchResult: {
        instance: {},
        audioStarterAvailable: true,
        supportedSources: ['microphone', 'demo'],
        startAudio: async () => {},
      },
      preferDemoAudio: false,
      container: document.getElementById('active-toy-container'),
      starterTips: ['Try mic first'],
    });

    expect(showAudioPrompt).toHaveBeenCalledTimes(1);
    const [active, options] = showAudioPrompt.mock.calls[0];
    expect(active).toBe(true);
    expect(options.preferDemoAudio).toBe(false);
    expect(options.starterTips).toEqual(['Try mic first']);
  });

  test('still shows the floating prompt when shell controls exist behind the active toy overlay', () => {
    document.body.innerHTML =
      '<div id="active-toy-container"></div><div data-audio-controls><div data-existing="true"></div></div>';

    const showAudioPrompt = mock();
    const controller = createToyAudioPromptController({
      view: { showAudioPrompt },
    });

    controller.maybeShowPrompt({
      launchResult: {
        instance: {},
        audioStarterAvailable: true,
        supportedSources: ['microphone', 'demo'],
        startAudio: async () => {},
      },
      preferDemoAudio: true,
      container: document.getElementById('active-toy-container'),
      starterTips: ['Try demo first'],
    });

    expect(showAudioPrompt).toHaveBeenCalledTimes(1);
    const [active, options] = showAudioPrompt.mock.calls[0];
    expect(active).toBe(true);
    expect(options.preferDemoAudio).toBe(true);
    expect(options.starterTips).toEqual(['Try demo first']);
  });

  test('suppresses the floating prompt while shell-managed audio startup is already pending', () => {
    document.body.innerHTML = `
      <div id="active-toy-container"></div>
      <div data-audio-controls>
        <button type="button" data-loading aria-busy="true">Starting…</button>
      </div>
    `;

    const showAudioPrompt = mock();
    const controller = createToyAudioPromptController({
      view: { showAudioPrompt },
    });

    controller.maybeShowPrompt({
      launchResult: {
        instance: {},
        audioStarterAvailable: true,
        supportedSources: ['microphone', 'demo'],
        startAudio: async () => {},
      },
      preferDemoAudio: false,
      container: document.getElementById('active-toy-container'),
      starterTips: ['Try mic first'],
    });

    expect(showAudioPrompt).not.toHaveBeenCalled();
  });

  test('hides the floating prompt when audio becomes active through shell-managed startup', async () => {
    const showAudioPrompt = mock();
    const controller = createToyAudioPromptController({
      view: { showAudioPrompt },
    });

    controller.maybeShowPrompt({
      launchResult: {
        instance: {},
        audioStarterAvailable: true,
        supportedSources: ['microphone', 'demo'],
        startAudio: async () => {},
      },
      preferDemoAudio: false,
      container: document.getElementById('active-toy-container'),
      starterTips: ['Try mic first'],
    });

    expect(showAudioPrompt).toHaveBeenCalledTimes(1);

    document.body.dataset.audioActive = 'true';
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(showAudioPrompt).toHaveBeenCalledTimes(2);
    expect(showAudioPrompt.mock.calls[1]).toEqual([false]);
  });
});
