import type { HemisphereLight, Light, Mesh } from 'three';
import { Color, MathUtils } from 'three';
import type { AnimationContext } from '../../core/animation-loop';
import { getContextFrequencyData } from '../../core/animation-loop';
import type WebToy from '../../core/web-toy';
import {
  applyAudioRotation,
  applyAudioScale,
  createManagedAudioFlow,
  getWeightedAverageFrequency,
  PatternRecognizer,
} from '../../utils';

type AudioControllerOptions = {
  doc: Document;
  toy: WebToy;
  cube: Mesh;
  getLight: () => Light | null;
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
    typeof createManagedAudioFlow
  >['setupMicrophoneFlow'];
  cleanup: () => void;
};

export const createAudioController = ({
  doc,
  toy,
  cube,
  getLight,
  prefersReducedMotion,
  setStatus,
  renderOnce,
  elements,
}: AudioControllerOptions): AudioController => {
  let patternRecognizer: PatternRecognizer | null = null;
  const lightBaselines = new WeakMap<Light, { intensity: number; y: number }>();
  const cubeColor = new Color();
  const groundColor = new Color();
  let pulse = 0;

  const renderFrame = (ctx: AnimationContext) => {
    if (!cube) return;

    const audioData = getContextFrequencyData(ctx);
    const avg = getWeightedAverageFrequency(audioData);
    const intensity = Math.min(1, avg / 180);
    const time = ctx.time ?? 0;

    applyAudioRotation(cube, audioData, 0.05 + intensity * 0.1);
    applyAudioScale(cube, audioData, 46 - intensity * 18);

    const pulseTarget = Math.max(0, intensity - 0.35) / 0.65;
    pulse = MathUtils.lerp(pulse, pulseTarget, 0.12);

    if (!patternRecognizer && ctx.analyser) {
      patternRecognizer = new PatternRecognizer(ctx.analyser);
    }
    patternRecognizer?.updatePatternBuffer();
    const detectedPattern = patternRecognizer?.detectPattern();

    const hue = (time * 0.05 + intensity * 0.3) % 1;
    const saturation = detectedPattern ? 0.95 : 0.75;
    const lightness = detectedPattern ? 0.65 : 0.5 + pulse * 0.25;
    cubeColor.setHSL(hue, saturation, lightness);

    const applyMaterialColor = (material: unknown) => {
      const targetMaterial = material as {
        color?: { copy?: (color: Color) => void };
        emissive?: { copy?: (color: Color) => void };
        emissiveIntensity?: number;
      };
      targetMaterial.color?.copy?.(cubeColor);
      targetMaterial.emissive?.copy?.(cubeColor);
      if (typeof targetMaterial.emissiveIntensity === 'number') {
        targetMaterial.emissiveIntensity = 0.4 + pulse * 0.9;
      }
    };

    if (Array.isArray(cube.material)) {
      cube.material.forEach((material) => applyMaterialColor(material));
    } else {
      applyMaterialColor(cube.material);
    }

    const activeLight = getLight();
    if (activeLight) {
      if (!lightBaselines.has(activeLight)) {
        lightBaselines.set(activeLight, {
          intensity: activeLight.intensity,
          y: activeLight.position.y,
        });
      }
      const baseline = lightBaselines.get(activeLight);
      const orbitRadius = 12 + intensity * 8;
      const orbitSpeed = 0.35 + intensity * 0.9;
      const orbit = time * orbitSpeed;
      const height =
        (baseline?.y ?? activeLight.position.y) + 3 + intensity * 6;
      activeLight.position.set(
        Math.cos(orbit) * orbitRadius,
        height,
        Math.sin(orbit) * orbitRadius,
      );
      activeLight.intensity =
        (baseline?.intensity ?? activeLight.intensity) * (0.7 + pulse * 1.4);
      activeLight.color?.setHSL(hue, 0.8, 0.6);
      if ('groundColor' in activeLight) {
        const hemi = activeLight as HemisphereLight;
        groundColor.setHSL((hue + 0.55) % 1, 0.6, 0.35);
        hemi.groundColor.copy(groundColor);
      }
    }

    renderOnce();
  };

  const audioFlow = createManagedAudioFlow({
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
    setupMicrophoneFlow: audioFlow.setupMicrophoneFlow,
    cleanup: () => {
      audioFlow.cleanup();
      patternRecognizer = null;
    },
  };
};
