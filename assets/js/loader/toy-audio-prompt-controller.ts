import { setAudioActive } from '../core/agent-api.ts';
import type { ToyLaunchResult } from '../core/toy-launch.ts';

type LoaderView = {
  showAudioPrompt: (
    active?: boolean,
    callbacks?: {
      onRequestMicrophone: () => Promise<void>;
      onRequestDemoAudio: () => Promise<void>;
      onSuccess?: () => void;
      preferDemoAudio?: boolean;
      starterTips?: string[];
    },
  ) => void;
};

export function createToyAudioPromptController({ view }: { view: LoaderView }) {
  const shellOwnsAudioControls = () => {
    const container = document.querySelector<HTMLElement>(
      '[data-audio-controls]',
    );
    return Boolean(container && container.childElementCount > 0);
  };

  const hasActiveAudio = () => document.body.dataset.audioActive === 'true';

  const maybeShowPrompt = ({
    launchResult,
    preferDemoAudio,
    container,
    starterTips,
  }: {
    launchResult: ToyLaunchResult;
    preferDemoAudio: boolean;
    container: HTMLElement | null;
    starterTips: string[];
  }) => {
    if (
      !launchResult.audioStarterAvailable ||
      !launchResult.startAudio ||
      shellOwnsAudioControls() ||
      hasActiveAudio()
    ) {
      return;
    }

    let lastAudioSource: 'microphone' | 'demo' = 'microphone';
    view.showAudioPrompt(true, {
      preferDemoAudio,
      starterTips,
      onRequestMicrophone: async () => {
        lastAudioSource = 'microphone';
        await launchResult.startAudio?.({ source: 'microphone' });
      },
      onRequestDemoAudio: async () => {
        lastAudioSource = 'demo';
        await launchResult.startAudio?.({ source: 'demo' });
      },
      onSuccess: () => {
        view.showAudioPrompt(false);
        setAudioActive(true, lastAudioSource);
      },
    });

    if (preferDemoAudio) {
      const demoButton = container?.querySelector('#use-demo-audio');
      if (demoButton instanceof HTMLButtonElement) {
        demoButton.click();
      }
    }
  };

  return {
    maybeShowPrompt,
  };
}
