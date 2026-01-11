import type { Mesh } from 'three';
import type { AnimationContext } from '../../core/animation-loop';
import { getContextFrequencyData } from '../../core/animation-loop';
import { setupMicrophonePermissionFlow } from '../../core/microphone-flow.ts';
import type WebToy from '../../core/web-toy';
import {
  applyAudioRotation,
  applyAudioScale,
} from '../../utils/animation-utils.ts';
import PatternRecognizer from '../../utils/patternRecognition.ts';
import { startToyAudio } from '../../utils/start-audio.ts';

export type AudioMode = 'microphone' | 'sample';

type AudioControllerOptions = {
  doc: Document;
  toy: WebToy;
  cube: Mesh;
  prefersReducedMotion: MediaQueryList | null;
  setStatus: (message: string, variant?: 'info' | 'error') => void;
  renderOnce: () => void;
  elements: {
    startButton: HTMLButtonElement | null;
    fallbackButton: HTMLButtonElement | null;
    statusElement: HTMLElement | null;
  };
};

export type AudioController = {
  setupMicrophoneFlow: () => ReturnType<typeof setupMicrophonePermissionFlow>;
  handleVisibilityChange: () => Promise<void>;
  handleReducedMotionChange: (event: MediaQueryListEvent) => void;
  handlePageHide: () => void;
  cleanupAudio: () => void;
};

export const createAudioController = ({
  doc,
  toy,
  cube,
  prefersReducedMotion,
  setStatus,
  renderOnce,
  elements,
}: AudioControllerOptions): AudioController => {
  let isReducedMotionPreferred = prefersReducedMotion?.matches ?? false;
  let shouldAnimate = true;
  let animationContext: AnimationContext | null = null;
  let patternRecognizer: PatternRecognizer | null = null;
  let audioMode: AudioMode | null = null;

  const clearAnimationLoop = () => {
    if (toy.renderer?.setAnimationLoop) {
      toy.renderer.setAnimationLoop(null);
    }
  };

  const animate = (ctx: AnimationContext) => {
    if (!cube) return;

    if (!shouldAnimate) {
      renderOnce();
      clearAnimationLoop();
      return;
    }

    const audioData = getContextFrequencyData(ctx);
    applyAudioRotation(cube, audioData, 0.05);
    applyAudioScale(cube, audioData, 50);

    patternRecognizer?.updatePatternBuffer();
    const detectedPattern = patternRecognizer?.detectPattern();

    const targetColor = detectedPattern ? 0xff0000 : 0x00ff00;
    const applyMaterialColor = (material: unknown) => {
      const color = (material as { color?: { setHex?: (hex: number) => void } })
        .color;
      color?.setHex?.(targetColor);
    };

    if (Array.isArray(cube.material)) {
      cube.material.forEach((material) => applyMaterialColor(material));
    } else {
      applyMaterialColor(cube.material);
    }

    renderOnce();
  };

  const restartAnimationLoop = () => {
    if (!toy.renderer || !animationContext || !shouldAnimate) return;
    const context = animationContext;
    toy.renderer.setAnimationLoop(() => animate(context));
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
    patternRecognizer = null;
  };

  const startAudio = async (mode: AudioMode) => {
    if (!toy) {
      setStatus('Renderer is not ready yet. Please retry.', 'error');
      return;
    }

    shouldAnimate = !isReducedMotionPreferred;
    audioMode = mode;

    try {
      animationContext = await startToyAudio(toy, animate, {
        fallbackToSynthetic: mode === 'microphone',
        preferSynthetic: mode === 'sample',
      });

      if (animationContext.analyser) {
        patternRecognizer = new PatternRecognizer(animationContext.analyser);
      }

      if (isReducedMotionPreferred) {
        renderOnce();
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
        restartAnimationLoop();
      }
    }
  };

  const handleReducedMotionChange = (event: MediaQueryListEvent) => {
    isReducedMotionPreferred = event.matches;
    shouldAnimate = !isReducedMotionPreferred;

    if (isReducedMotionPreferred) {
      clearAnimationLoop();
      renderOnce();
    } else {
      restartAnimationLoop();
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
      analytics: {
        log: (event, detail) =>
          console.info(`[audio-flow] ${event}`, detail ?? {}),
      },
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
      },
    });

  return {
    setupMicrophoneFlow,
    handleVisibilityChange,
    handleReducedMotionChange,
    handlePageHide,
    cleanupAudio,
  };
};
