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

  test('skips the floating prompt when shell controls already exist', () => {
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

    expect(showAudioPrompt).not.toHaveBeenCalled();
  });
});
