import type { AudioFlowController } from './audio-flow-controller';
import { createAudioFlowController } from './audio-flow-controller';

type ManagedAudioFlowOptions = Parameters<
  typeof createAudioFlowController
>[0] & {
  windowRef?: Window | null;
};

type ManagedAudioFlowHandle = {
  setupMicrophoneFlow: AudioFlowController['setupMicrophoneFlow'];
  cleanup: () => void;
};

export function createManagedAudioFlow({
  windowRef = typeof window !== 'undefined' ? window : null,
  ...options
}: ManagedAudioFlowOptions): ManagedAudioFlowHandle {
  const controller = createAudioFlowController(options);
  let microphoneFlow: ReturnType<
    AudioFlowController['setupMicrophoneFlow']
  > | null = null;
  let handleReducedMotionChange: ((event: MediaQueryListEvent) => void) | null =
    null;
  let handleVisibilityChange: (() => void) | null = null;
  let handlePageHide: (() => void) | null = null;

  const setupMicrophoneFlow = () => {
    microphoneFlow?.dispose?.();
    microphoneFlow = controller.setupMicrophoneFlow();

    handleReducedMotionChange = controller.handleReducedMotionChange;
    handleVisibilityChange = controller.handleVisibilityChange;
    handlePageHide = controller.handlePageHide;

    options.prefersReducedMotion?.addEventListener(
      'change',
      handleReducedMotionChange,
    );
    options.doc.addEventListener('visibilitychange', handleVisibilityChange);
    windowRef?.addEventListener('pagehide', handlePageHide);

    return microphoneFlow;
  };

  const cleanup = () => {
    microphoneFlow?.dispose?.();
    microphoneFlow = null;
    controller.cleanupAudio();
    if (handleReducedMotionChange) {
      options.prefersReducedMotion?.removeEventListener(
        'change',
        handleReducedMotionChange,
      );
    }
    if (handleVisibilityChange) {
      options.doc.removeEventListener(
        'visibilitychange',
        handleVisibilityChange,
      );
    }
    if (handlePageHide) {
      windowRef?.removeEventListener('pagehide', handlePageHide);
    }
    handleReducedMotionChange = null;
    handleVisibilityChange = null;
    handlePageHide = null;
  };

  return {
    setupMicrophoneFlow,
    cleanup,
  };
}
