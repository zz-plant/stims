import { ensureWebGL } from '../../utils/webgl-check';
import { createAudioController } from './audio';
import { applyLighting, createLightsScene } from './lighting';
import { createLightsUI } from './ui';

export const startLightsExperience = ({
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
} = {}) => {
  const doc = documentRef;
  const win = windowRef;

  const prefersReducedMotion =
    win?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;

  const ui = createLightsUI(doc);

  let scene: Awaited<ReturnType<typeof createLightsScene>> | null = null;
  let audioController: ReturnType<typeof createAudioController> | null = null;
  let microphoneFlow: { dispose?: () => void } | null = null;
  let removeLightChangeListener: (() => void) | undefined;

  const renderOnce = () => {
    scene?.toy.render();
  };

  const init = async () => {
    if (!doc || !win) return;

    const supportsRendering = ensureWebGL({
      title: 'Graphics support required',
      description:
        'This visualizer needs WebGL or WebGPU to render. Enable hardware acceleration or update your browser to continue.',
    });

    if (!supportsRendering) return;

    const canvas = doc.getElementById('toy-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      ui.setStatus('Canvas element not found.', 'error');
      return;
    }

    scene = await createLightsScene({
      canvas,
      lightType: ui.getSelectedLightType(),
      setStatus: ui.setStatus,
    });

    if (!scene) return;

    renderOnce();

    audioController = createAudioController({
      doc,
      toy: scene.toy,
      cube: scene.cube,
      getLight: () => scene?.light ?? null,
      prefersReducedMotion,
      setStatus: ui.setStatus,
      renderOnce,
      elements: {
        startButton: ui.elements.startButton,
        fallbackButton: ui.elements.fallbackButton,
        statusElement: ui.elements.statusElement,
      },
    });

    microphoneFlow?.dispose?.();
    microphoneFlow = audioController.setupMicrophoneFlow();

    removeLightChangeListener = ui.bindLightTypeChange((lightType) => {
      if (!scene) return;
      scene.light = applyLighting(scene.lightingGroup, lightType);
      renderOnce();
    });
  };

  const dispose = () => {
    microphoneFlow?.dispose?.();
    microphoneFlow = null;
    audioController?.cleanup();
    removeLightChangeListener?.();
    removeLightChangeListener = undefined;
    scene?.toy.dispose();
    scene = null;
    audioController = null;
  };

  return { init, dispose };
};

const experience = startLightsExperience();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => experience.init(), {
    once: true,
  });
} else {
  void experience.init();
}
