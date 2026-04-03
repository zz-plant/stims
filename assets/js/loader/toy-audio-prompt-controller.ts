import { setAudioActive } from '../core/agent-api.ts';
import { clearMilkdropCapturedVideoStream } from '../core/services/captured-video-texture.ts';
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
  const hasActiveAudio = () => document.body.dataset.audioActive === 'true';
  const hasForegroundedToyContent = (container: HTMLElement | null) => {
    if (!(container instanceof HTMLElement)) {
      return false;
    }

    const activeToyRoot =
      container.closest('#active-toy-container') ??
      (container.id === 'active-toy-container' ? container : null);
    if (
      !(activeToyRoot instanceof HTMLElement) ||
      activeToyRoot.hidden ||
      activeToyRoot.classList.contains('is-hidden')
    ) {
      return false;
    }

    const activeStage =
      container.dataset.stageSlot !== undefined
        ? container
        : activeToyRoot.querySelector<HTMLElement>('[data-stage-slot]');
    if (activeStage instanceof HTMLElement) {
      return Array.from(activeStage.children).some(
        (child) =>
          child instanceof HTMLElement && child.dataset.preserve !== 'toy-ui',
      );
    }

    return Array.from(activeToyRoot.children).some(
      (child) =>
        child instanceof HTMLElement &&
        child.dataset.preserve !== 'toy-ui' &&
        !child.matches('[data-audio-controls]'),
    );
  };
  const hasVisibleShellManagedAudioControls = () => {
    const shellControls = document.querySelector('[data-audio-controls]');
    return shellControls instanceof HTMLElement && !shellControls.hidden;
  };
  const isShellLaunchContext = () =>
    document.documentElement.dataset.focusedSession === 'launch';
  const hasShellManagedAudioStartupInFlight = () =>
    document.querySelector(
      '[data-audio-controls] [data-loading], [data-audio-controls] [aria-busy="true"]',
    ) !== null;

  let promptVisibilityTimer: ReturnType<typeof setTimeout> | null = null;

  const stopWatchingPromptVisibility = () => {
    if (promptVisibilityTimer !== null) {
      clearTimeout(promptVisibilityTimer);
      promptVisibilityTimer = null;
    }
  };

  const hidePrompt = () => {
    view.showAudioPrompt(false);
    stopWatchingPromptVisibility();
  };

  const watchForExternalAudioStart = () => {
    stopWatchingPromptVisibility();

    const checkPromptVisibility = () => {
      if (hasActiveAudio()) {
        hidePrompt();
        return;
      }
      promptVisibilityTimer = setTimeout(checkPromptVisibility, 16);
    };

    promptVisibilityTimer = setTimeout(checkPromptVisibility, 16);
  };

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
      hasActiveAudio() ||
      hasShellManagedAudioStartupInFlight() ||
      (isShellLaunchContext() &&
        hasVisibleShellManagedAudioControls() &&
        !hasForegroundedToyContent(container))
    ) {
      return;
    }

    let lastAudioSource: 'microphone' | 'demo' = 'microphone';
    watchForExternalAudioStart();
    view.showAudioPrompt(true, {
      preferDemoAudio,
      starterTips,
      onRequestMicrophone: async () => {
        lastAudioSource = 'microphone';
        clearMilkdropCapturedVideoStream();
        await launchResult.startAudio?.({ source: 'microphone' });
      },
      onRequestDemoAudio: async () => {
        lastAudioSource = 'demo';
        clearMilkdropCapturedVideoStream();
        await launchResult.startAudio?.({ source: 'demo' });
      },
      onSuccess: () => {
        hidePrompt();
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
