import type { AnimationContext } from '../core/animation-loop';
import { setupMicrophonePermissionFlow } from '../core/microphone-flow';
import type WebToy from '../core/web-toy';
import { startToyAudio } from './start-audio';

export type AudioFlowMode = 'microphone' | 'sample';

type AudioFlowElements = {
  startButton: HTMLButtonElement | null;
  fallbackButton: HTMLButtonElement | null;
  statusElement: HTMLElement | null;
};

type AudioFlowControllerOptions = {
  doc: Document;
  toy: WebToy;
  prefersReducedMotion: MediaQueryList | null;
  renderFrame: (ctx: AnimationContext) => void;
  renderOnce: () => void;
  setStatus: (message: string, variant?: 'info' | 'error') => void;
  elements: AudioFlowElements;
  analytics?: {
    log?: (message: string, detail?: unknown) => void;
  };
  onSuccess?: (mode: AudioFlowMode) => void;
};

export type AudioFlowController = {
  setupMicrophoneFlow: () => ReturnType<typeof setupMicrophonePermissionFlow>;
  handleVisibilityChange: () => Promise<void>;
  handleReducedMotionChange: (event: MediaQueryListEvent) => void;
  handlePageHide: () => void;
  cleanupAudio: () => void;
};

export function createAudioFlowController({
  doc,
  toy,
  prefersReducedMotion,
  renderFrame,
  renderOnce,
  setStatus,
  elements,
  analytics,
  onSuccess,
}: AudioFlowControllerOptions): AudioFlowController {
  let isReducedMotionPreferred = prefersReducedMotion?.matches ?? false;
  let shouldAnimate = true;
  let animationContext: AnimationContext | null = null;
  let audioMode: AudioFlowMode | null = null;

  const clearAnimationLoop = () => {
    if (toy.renderer?.setAnimationLoop) {
      toy.renderer.setAnimationLoop(null);
    }
  };

  const startAnimationLoop = (ctx: AnimationContext) => {
    if (!toy.renderer) return;
    if (!shouldAnimate) {
      renderOnce();
      clearAnimationLoop();
      return;
    }
    toy.renderer.setAnimationLoop(() => renderFrame(ctx));
  };

  const cleanupAudio = () => {
    clearAnimationLoop();
    toy?.audioCleanup?.();
    toy.analyser = null;
    toy.audioListener = null;
    toy.audio = null;
    toy.audioStream = null;
    toy.audioCleanup = null;
    animationContext = null;
  };

  const startAudio = async (mode: AudioFlowMode) => {
    if (!toy) {
      setStatus('Renderer is not ready yet. Please retry.', 'error');
      return;
    }

    shouldAnimate = !isReducedMotionPreferred;
    audioMode = mode;

    try {
      animationContext = await startToyAudio(toy, renderFrame, {
        fallbackToSynthetic: mode === 'microphone',
        preferSynthetic: mode === 'sample',
      });

      if (isReducedMotionPreferred) {
        renderOnce();
      } else if (animationContext) {
        startAnimationLoop(animationContext);
      }
    } catch (error) {
      audioMode = null;
      clearAnimationLoop();
      throw error;
    }
  };

  const handleVisibilityChange = async () => {
    if (!doc) return;

    if (doc.visibilityState === 'hidden') {
      clearAnimationLoop();
      if (toy.audioListener?.context?.state === 'running') {
        try {
          await toy.audioListener.context.suspend();
        } catch (error) {
          console.error('Error suspending audio context:', error);
        }
      } else {
        cleanupAudio();
      }
      return;
    }

    if (doc.visibilityState === 'visible') {
      if (toy.audioListener?.context?.state === 'suspended') {
        try {
          await toy.audioListener.context.resume();
        } catch (error) {
          console.error('Error resuming audio context:', error);
        }
      } else if (audioMode && !animationContext) {
        try {
          await startAudio(audioMode);
        } catch (error) {
          setStatus(
            'Microphone or demo audio is required for the visualization to work. Please try again.',
            'error',
          );
          console.error(
            'Unable to restart audio after visibility change',
            error,
          );
        }
      }

      if (animationContext) {
        startAnimationLoop(animationContext);
      }
    }
  };

  const handleReducedMotionChange = (event: MediaQueryListEvent) => {
    isReducedMotionPreferred = event.matches;
    shouldAnimate = !isReducedMotionPreferred;

    if (isReducedMotionPreferred) {
      clearAnimationLoop();
      renderOnce();
    } else if (animationContext) {
      startAnimationLoop(animationContext);
    }
  };

  const handlePageHide = () => {
    cleanupAudio();
    clearAnimationLoop();
  };

  const setupMicrophoneFlow = () =>
    setupMicrophonePermissionFlow({
      startButton: elements.startButton,
      fallbackButton: elements.fallbackButton,
      statusElement: elements.statusElement,
      requestMicrophone: () => startAudio('microphone'),
      requestSampleAudio: () => startAudio('sample'),
      analytics,
      onSuccess: (mode) => {
        if (elements.startButton instanceof HTMLButtonElement) {
          elements.startButton.style.display = 'none';
        }

        if (
          mode === 'microphone' &&
          elements.fallbackButton instanceof HTMLButtonElement
        ) {
          elements.fallbackButton.hidden = true;
        }

        onSuccess?.(mode);
      },
    });

  return {
    setupMicrophoneFlow,
    handleVisibilityChange,
    handleReducedMotionChange,
    handlePageHide,
    cleanupAudio,
  };
}
