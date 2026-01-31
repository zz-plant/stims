import type { Mesh } from 'three';
import type { AnimationContext } from '../../core/animation-loop';
import { getContextFrequencyData } from '../../core/animation-loop';
import type WebToy from '../../core/web-toy';
import {
  applyAudioRotation,
  applyAudioScale,
} from '../../utils/animation-utils.ts';
import { createAudioFlowController } from '../../utils/audio-flow-controller';
import { getWeightedAverageFrequency } from '../../utils/audio-handler.ts';
import PatternRecognizer from '../../utils/patternRecognition.ts';

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
  setupMicrophoneFlow: ReturnType<
    typeof createAudioFlowController
  >['setupMicrophoneFlow'];
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
  let patternRecognizer: PatternRecognizer | null = null;

  const renderFrame = (ctx: AnimationContext) => {
    if (!cube) return;

    const audioData = getContextFrequencyData(ctx);
    const avg = getWeightedAverageFrequency(audioData);
    const intensity = Math.min(1, avg / 180);
    applyAudioRotation(cube, audioData, 0.05 + intensity * 0.08);
    applyAudioScale(cube, audioData, 50 - intensity * 20);

    if (!patternRecognizer && ctx.analyser) {
      patternRecognizer = new PatternRecognizer(ctx.analyser);
    }
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

  const audioFlow = createAudioFlowController({
    doc,
    toy,
    prefersReducedMotion,
    renderFrame,
    renderOnce,
    setStatus,
    elements,
    analytics: {
      log: (event, detail) =>
        console.info(`[audio-flow] ${event}`, detail ?? {}),
    },
    onSuccess: () => {
      patternRecognizer = null;
    },
  });

  return {
    ...audioFlow,
    cleanupAudio: () => {
      audioFlow.cleanupAudio();
      patternRecognizer = null;
    },
  };
};
