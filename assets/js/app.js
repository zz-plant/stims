/* global HTMLButtonElement, HTMLCanvasElement, HTMLSelectElement */
import * as THREE from 'three';
import WebToy from './core/web-toy';
import { getContextFrequencyData } from './core/animation-loop';
import { setupMicrophonePermissionFlow } from './core/microphone-flow.ts';
import { ensureWebGL } from './utils/webgl-check.ts';
import {
  applyAudioRotation,
  applyAudioScale,
} from './utils/animation-utils.ts';
import { startToyAudio } from './utils/start-audio.ts';
import PatternRecognizer from './utils/patternRecognition.ts';

const DEFAULT_RENDERER_OPTIONS = { maxPixelRatio: 2 };

const LIGHT_CONFIGS = {
  PointLight: {
    type: 'PointLight',
    position: { x: 10, y: 10, z: 20 },
    intensity: 1,
  },
  DirectionalLight: {
    type: 'DirectionalLight',
    position: { x: 10, y: 10, z: 20 },
    intensity: 1,
  },
  SpotLight: {
    type: 'SpotLight',
    position: { x: 10, y: 15, z: 18 },
    intensity: 1.25,
  },
  HemisphereLight: {
    type: 'HemisphereLight',
    position: { x: 0, y: 10, z: 0 },
    intensity: 1,
  },
};

function createLightsExperience({
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
} = {}) {
  const doc = documentRef;
  const win = windowRef;

  const prefersReducedMotion =
    win?.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null;

  let isReducedMotionPreferred = prefersReducedMotion?.matches ?? false;
  let shouldAnimate = true;
  /** @type {WebToy | null} */
  let toy = null;
  /** @type {THREE.Group | null} */
  let lightingGroup = null;
  /** @type {THREE.Mesh | null} */
  let cube = null;
  /** @type {AnimationContext | null} */
  let animationContext = null;
  /** @type {PatternRecognizer | null} */
  let patternRecognizer = null;
  /** @type {'microphone' | 'sample' | null} */
  let audioMode = null;
  /** @type {ReturnType<typeof setupMicrophonePermissionFlow> | null} */
  let microphoneFlow = null;

  const elements = {
    startButton: doc?.getElementById('start-audio-btn'),
    fallbackButton: doc?.getElementById('use-demo-audio'),
    statusElement: doc?.getElementById('audio-status'),
    lightSelect: doc?.getElementById('light-type'),
  };

  const setStatus = (message, variant = 'info') => {
    if (!elements.statusElement) return;
    elements.statusElement.textContent = message;
    elements.statusElement.dataset.variant = variant;
    elements.statusElement.hidden = !message;
  };

  const getSelectedLightType = () => {
    if (elements.lightSelect instanceof HTMLSelectElement) {
      return elements.lightSelect.value;
    }
    return 'PointLight';
  };

  const renderOnce = () => {
    if (toy) {
      toy.render();
    }
  };

  const clearAnimationLoop = () => {
    if (toy?.renderer?.setAnimationLoop) {
      toy.renderer.setAnimationLoop(null);
    }
  };

  const applyLighting = (lightType) => {
    if (!toy || !lightingGroup) return;

    while (lightingGroup.children.length > 0) {
      lightingGroup.remove(lightingGroup.children[0]);
    }

    const config = LIGHT_CONFIGS[lightType] ?? LIGHT_CONFIGS.PointLight;
    const { type, intensity, position } = config;

    /** @type {THREE.Light} */
    let light;
    switch (type) {
      case 'DirectionalLight':
        light = new THREE.DirectionalLight(0xffffff, intensity);
        break;
      case 'SpotLight':
        light = new THREE.SpotLight(0xffffff, intensity);
        break;
      case 'HemisphereLight':
        light = new THREE.HemisphereLight(0xffffff, 0x444444, intensity);
        break;
      default:
        light = new THREE.PointLight(0xffffff, intensity);
        break;
    }

    light.position.set(position.x, position.y, position.z);
    lightingGroup.add(light);
  };

  /** @param {import('./core/animation-loop').AnimationContext} ctx */
  const animate = (ctx) => {
    if (!toy || !cube) return;

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

    if (Array.isArray(cube.material)) {
      cube.material.forEach((material) => {
        if ('color' in material && material.color) {
          material.color.setHex(detectedPattern ? 0xff0000 : 0x00ff00);
        }
      });
    } else if ('color' in cube.material && cube.material.color) {
      cube.material.color.setHex(detectedPattern ? 0xff0000 : 0x00ff00);
    }

    renderOnce();
  };

  const restartAnimationLoop = () => {
    if (!toy?.renderer || !animationContext || !shouldAnimate) return;
    toy.renderer.setAnimationLoop(() => animate(animationContext));
  };

  const cleanupAudio = () => {
    clearAnimationLoop();
    toy?.audioCleanup?.();
    if (toy) {
      toy.analyser = null;
      toy.audioListener = null;
      toy.audio = null;
      toy.audioStream = null;
      toy.audioCleanup = null;
    }
    animationContext = null;
    patternRecognizer = null;
  };

  const initializeToy = async () => {
    if (!doc) return;

    const canvas = doc.getElementById('toy-canvas');
    if (!(canvas instanceof HTMLCanvasElement)) {
      setStatus('Canvas element not found.', 'error');
      return;
    }

    try {
      toy = new WebToy({
        rendererOptions: DEFAULT_RENDERER_OPTIONS,
        ambientLightOptions: { color: 0x404040, intensity: 0.5 },
        cameraOptions: { position: { x: 0, y: 0, z: 5 } },
        canvas,
      });
    } catch (error) {
      console.error('Unable to create WebToy instance', error);
      setStatus('WebGL support is required to render this visual.', 'error');
      toy = null;
      return;
    }

    lightingGroup = new THREE.Group();
    toy.scene.add(lightingGroup);
    applyLighting(getSelectedLightType());

    cube = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0x00ff00,
        metalness: 0.3,
        roughness: 0.4,
      })
    );
    toy.scene.add(cube);

    await toy.rendererReady;
    renderOnce();
  };

  const startAudio = async (mode) => {
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
    if (!doc || !toy) return;

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
            'error'
          );
          console.error(
            'Unable to restart audio after visibility change',
            error
          );
        }
      }

      if (animationContext) {
        restartAnimationLoop();
      }
    }
  };

  const handleLightChange = () => {
    applyLighting(getSelectedLightType());
    renderOnce();
  };

  const handleReducedMotionChange = (event) => {
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

  const init = async () => {
    if (!doc || !win) return;

    const supportsRendering = ensureWebGL({
      title: 'Graphics support required',
      description:
        'This visualizer needs WebGL or WebGPU to render. Enable hardware acceleration or update your browser to continue.',
    });

    if (!supportsRendering) return;

    await initializeToy();

    microphoneFlow?.dispose?.();
    microphoneFlow = null;

    microphoneFlow = setupMicrophonePermissionFlow({
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

    elements.lightSelect?.addEventListener('change', handleLightChange);
    prefersReducedMotion?.addEventListener('change', handleReducedMotionChange);
    doc.addEventListener('visibilitychange', handleVisibilityChange);
    win.addEventListener('pagehide', handlePageHide);
  };

  const dispose = () => {
    microphoneFlow?.dispose?.();
    microphoneFlow = null;
    cleanupAudio();
    clearAnimationLoop();
    elements.lightSelect?.removeEventListener('change', handleLightChange);
    prefersReducedMotion?.removeEventListener(
      'change',
      handleReducedMotionChange
    );
    doc?.removeEventListener('visibilitychange', handleVisibilityChange);
    win?.removeEventListener('pagehide', handlePageHide);
    toy?.dispose();
    toy = null;
    cube = null;
    lightingGroup = null;
  };

  return { init, dispose };
}

const experience = createLightsExperience();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => experience.init(), {
    once: true,
  });
} else {
  void experience.init();
}
