import type { ToyStartOptions } from '../../core/toy-interface';
import { ensureWebGL } from '../../utils/webgl-check';
import { createAudioController } from './audio';
import { applyLighting, createLightsScene, type LightType } from './lighting';
import { createLightsUI } from './ui';

type LightsStartOptions = ToyStartOptions & {
  preferDemoAudio?: boolean;
};

function renderLightsMarkup(target: HTMLElement) {
  target.innerHTML = `
    <div class="control-panel">
      <div class="control-panel__heading">Lighting controls</div>
      <p class="control-panel__description">
        Choose a light and start the visualization.
      </p>
      <div class="control-panel__row">
        <div class="control-panel__text">
          <span class="control-panel__label">Light type</span>
          <small>Update the scene illumination.</small>
        </div>
        <select id="light-type">
          <option value="PointLight">Point Light</option>
          <option value="DirectionalLight">Directional Light</option>
          <option value="SpotLight">Spot Light</option>
          <option value="HemisphereLight">Hemisphere Light</option>
        </select>
      </div>
      <div class="control-panel__row">
        <div class="control-panel__text">
          <span class="control-panel__label">Starter look</span>
          <small>Quick presets for strong first impressions.</small>
        </div>
        <select id="look-preset">
          <option value="punchy">Punchy beam</option>
          <option value="ambient">Ambient wash</option>
          <option value="focus">Focus spot</option>
        </select>
      </div>
      <div class="control-panel__row">
        <div class="control-panel__text">
          <span class="control-panel__label">Shuffle look</span>
          <small>Cycle to a random lighting style.</small>
        </div>
        <button id="shuffle-look" class="cta-button">Shuffle</button>
      </div>
      <div class="control-panel__row">
        <div class="control-panel__text">
          <span class="control-panel__label">Audio</span>
          <small>Start microphone input and animation.</small>
        </div>
        <button id="start-audio-btn" class="cta-button primary">
          Start Audio &amp; Visualization
        </button>
      </div>
      <div class="control-panel__row">
        <div class="control-panel__text">
          <span class="control-panel__label">Demo audio</span>
          <small>Try the visuals without microphone access.</small>
        </div>
        <button id="use-demo-audio" class="cta-button">Use demo audio</button>
      </div>
      <div id="audio-status" class="control-panel__status" role="status" hidden></div>
    </div>
    <canvas id="toy-canvas" class="toy-canvas"></canvas>
  `;
}

export const startLightsExperience = ({
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  container,
  preferDemoAudio = false,
}: {
  documentRef?: Document | null;
  windowRef?: Window | null;
  container?: HTMLElement | null;
  preferDemoAudio?: boolean;
} = {}) => {
  const doc = documentRef;
  const win = windowRef;
  const mountTarget =
    container ?? doc?.getElementById('active-toy-container') ?? null;

  const prefersReducedMotion =
    win?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;

  let shellRoot: HTMLDivElement | null = null;
  let scene: Awaited<ReturnType<typeof createLightsScene>> | null = null;
  let audioController: ReturnType<typeof createAudioController> | null = null;
  let microphoneFlow: { dispose?: () => void } | null = null;
  let removeLightChangeListener: (() => void) | undefined;
  let removePresetListener: (() => void) | undefined;
  let removeShuffleListener: (() => void) | undefined;

  const renderOnce = () => {
    scene?.toy.render();
  };

  const init = async () => {
    if (!doc || !win || !mountTarget) return;

    const supportsRendering = ensureWebGL({
      title: 'Graphics support required',
      description:
        'This visualizer needs WebGL or WebGPU to render. Enable hardware acceleration or update your browser to continue.',
    });

    if (!supportsRendering) return;

    shellRoot = doc.createElement('div');
    shellRoot.className = 'lights-toy-shell';
    renderLightsMarkup(shellRoot);
    mountTarget.appendChild(shellRoot);

    const ui = createLightsUI(shellRoot);

    const presetSelect = shellRoot.querySelector(
      '#look-preset',
    ) as HTMLSelectElement | null;
    const shuffleButton = shellRoot.querySelector(
      '#shuffle-look',
    ) as HTMLButtonElement | null;

    const applyLookPreset = (preset: string) => {
      const mapping: Record<string, LightType> = {
        punchy: 'PointLight',
        ambient: 'HemisphereLight',
        focus: 'SpotLight',
      };
      const lightType = mapping[preset] ?? 'PointLight';
      if (ui.elements.lightSelect) {
        ui.elements.lightSelect.value = lightType;
      }
      if (scene) {
        scene.light = applyLighting(scene.lightingGroup, lightType);
        renderOnce();
      }
    };

    const canvas = shellRoot.querySelector('#toy-canvas');
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

    if (preferDemoAudio) {
      ui.elements.fallbackButton?.click();
    }

    removeLightChangeListener = ui.bindLightTypeChange((lightType) => {
      if (!scene) return;
      scene.light = applyLighting(scene.lightingGroup, lightType);
      renderOnce();
    });

    if (presetSelect) {
      const listener = () => applyLookPreset(presetSelect.value);
      presetSelect.addEventListener('change', listener);
      removePresetListener = () =>
        presetSelect.removeEventListener('change', listener);
      listener();
    }

    if (shuffleButton) {
      const options = ['punchy', 'ambient', 'focus'];
      const listener = () => {
        const choice = options[Math.floor(Math.random() * options.length)];
        if (presetSelect) {
          presetSelect.value = choice;
        }
        applyLookPreset(choice);
      };
      shuffleButton.addEventListener('click', listener);
      removeShuffleListener = () =>
        shuffleButton.removeEventListener('click', listener);
    }
  };

  const dispose = () => {
    microphoneFlow?.dispose?.();
    microphoneFlow = null;
    audioController?.cleanup();
    removeLightChangeListener?.();
    removeLightChangeListener = undefined;
    removePresetListener?.();
    removePresetListener = undefined;
    removeShuffleListener?.();
    removeShuffleListener = undefined;
    scene?.toy.dispose();
    scene = null;
    audioController = null;
    shellRoot?.remove();
    shellRoot = null;
  };

  return { init, dispose };
};

export function start({ container, preferDemoAudio }: LightsStartOptions = {}) {
  const experience = startLightsExperience({ container, preferDemoAudio });
  void experience.init();
  return experience;
}
