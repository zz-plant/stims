import * as THREE from 'three';
import {
  type AnimationContext,
  getContextFrequencyData,
} from '../core/animation-loop';
import {
  DEFAULT_QUALITY_PRESETS,
  getActiveQualityPreset,
  getSettingsPanel,
  type QualityPreset,
} from '../core/settings-panel';
import { registerToyGlobals } from '../core/toy-globals';
import WebToy from '../core/web-toy';
import { getAverageFrequency } from '../utils/audio-handler';
import {
  resolveToyAudioOptions,
  type ToyAudioRequest,
} from '../utils/audio-start';
import { setupCanvasResize } from '../utils/canvas-resize';
import PatternRecognizer from '../utils/patternRecognition';
import {
  createPointerInput,
  type GestureUpdate,
  type PointerSummary,
} from '../utils/pointer-input';
import { startToyAudio } from '../utils/start-audio';

export function start({ container }: { container?: HTMLElement | null } = {}) {
  const settingsPanel = getSettingsPanel();
  let activeQuality: QualityPreset = getActiveQualityPreset();

  const toy = new WebToy({
    cameraOptions: {
      fov: 45,
      near: 0.1,
      far: 10,
      position: { x: 0, y: 0, z: 1 },
    },
    rendererOptions: {
      maxPixelRatio: activeQuality.maxPixelRatio,
      renderScale: activeQuality.renderScale,
    },
    canvas: container?.querySelector('canvas.gl-canvas'),
  });

  toy.rendererReady.then((result) => {
    const canvasElement = result?.renderer.domElement;
    if (!canvasElement) return;
    canvasElement.classList.add('sgpat-canvas');
    Object.assign(canvasElement.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
    });
  });

  let spectroCanvas: HTMLCanvasElement;
  const existingSpectro = container?.querySelector('#glCanvas');
  if (existingSpectro) {
    spectroCanvas = existingSpectro as HTMLCanvasElement;
  } else {
    spectroCanvas = document.createElement('canvas');
    spectroCanvas.id = 'glCanvas';
    if (container) {
      container.appendChild(spectroCanvas);
    } else {
      document.body.appendChild(spectroCanvas);
    }
  }

  const spectroCtx = spectroCanvas.getContext('2d');
  if (!spectroCtx) {
    throw new Error('Unable to acquire 2D rendering context for spectrograph.');
  }

  const spectroContext = spectroCtx;

  spectroCanvas.style.position = 'absolute';
  spectroCanvas.style.top = '0';
  spectroCanvas.style.left = '0';
  spectroCanvas.style.width = '100%';
  spectroCanvas.style.height = '100%';
  spectroCanvas.style.pointerEvents = 'none';
  spectroCanvas.classList.add('toy-canvas');
  const originalTouchAction = document.documentElement.style.touchAction;
  document.documentElement.style.touchAction = 'none';

  const uniforms = {
    u_time: { value: 0 },
    u_resolution: {
      value: new THREE.Vector2(window.innerWidth, window.innerHeight),
    },
    u_audioData: { value: 0 },
    u_colorOffset: { value: new THREE.Vector3(0, 0, 0) },
    u_touch: { value: new THREE.Vector2(0, 0) },
    u_touchScale: { value: 1 },
    u_touchRotation: { value: 0 },
  };

  const fragmentShader = `
    uniform float u_time;
    uniform vec2 u_resolution;
    uniform float u_audioData;
    uniform vec3 u_colorOffset;
    uniform vec2 u_touch;
    uniform float u_touchScale;
    uniform float u_touchRotation;

    varying vec2 vUv;

    vec3 dreamyGradient(vec2 uv, float timeOffset) {
      vec3 color = vec3(
        0.4 + 0.4 * sin(uv.x * 10.0 + u_audioData * 6.0 + timeOffset),
        0.4 + 0.4 * cos(uv.y * 10.0 + u_audioData * 6.0 + timeOffset),
        0.5 + 0.4 * sin((uv.x + uv.y) * 8.0 + u_audioData * 6.0 + timeOffset)
      );
      return color + u_colorOffset * 0.7;
    }

    void main() {
      vec2 uv = vUv * 2.0 - 1.0;
      float c = cos(u_touchRotation);
      float s = sin(u_touchRotation);
      uv = mat2(c, -s, s, c) * uv * u_touchScale;
      float dist = distance(uv, u_touch);
      float ripple = sin(dist * 15.0 - u_time * 3.0) * 0.15;
      float bloom = 0.3 / (dist * dist + 0.25);
      uv += ripple;

      vec3 color = dreamyGradient(uv, u_time * 0.6) * u_audioData;
      color += vec3(
        0.4 + 0.4 * sin(u_time * 0.4 + u_audioData * 2.0),
        0.4 + 0.4 * cos(u_time * 0.5 + u_audioData * 3.0),
        0.5 + 0.4 * sin(u_time * 0.6 + u_audioData * 1.5)
      );
      color += bloom * 0.6;

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const vertexShader = `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
    }),
  );

  toy.scene.add(quad);

  let patternRecognizer: PatternRecognizer | null = null;
  const clock = new THREE.Clock();
  let viewportWidth = window.innerWidth;
  let viewportHeight = window.innerHeight;
  let disposeResize = setupCanvasResize(spectroCanvas, spectroCtx, {
    maxPixelRatio:
      (activeQuality.renderScale ?? 1) * activeQuality.maxPixelRatio,
    onResize: ({ cssWidth, cssHeight }) => {
      viewportWidth = cssWidth;
      viewportHeight = cssHeight;
      uniforms.u_resolution.value.set(cssWidth, cssHeight);
    },
  });

  function handlePointerUpdate(summary: PointerSummary) {
    uniforms.u_touch.value.set(
      summary.normalizedCentroid.x,
      summary.normalizedCentroid.y,
    );
    if (!summary.pointers.length) {
      uniforms.u_colorOffset.value.z = 0;
    }
  }

  function handleGestureUpdate(gesture: GestureUpdate) {
    uniforms.u_touchScale.value = THREE.MathUtils.clamp(
      gesture.scale,
      0.6,
      2.8,
    );
    uniforms.u_touchRotation.value = gesture.rotation;
    uniforms.u_colorOffset.value.z = THREE.MathUtils.clamp(
      Math.abs(gesture.translation.x) + Math.abs(gesture.translation.y),
      0,
      1,
    );
  }

  const disposePointerInput = createPointerInput({
    target: window,
    boundsElement: spectroCanvas,
    onChange: handlePointerUpdate,
    onGesture: handleGestureUpdate,
  });

  function applyQualityPreset(preset: QualityPreset) {
    activeQuality = preset;
    toy.updateRendererSettings({
      maxPixelRatio: preset.maxPixelRatio,
      renderScale: preset.renderScale,
    });

    disposeResize();
    disposeResize = setupCanvasResize(spectroCanvas, spectroContext, {
      maxPixelRatio:
        (activeQuality.renderScale ?? 1) * activeQuality.maxPixelRatio,
      onResize: ({ cssWidth, cssHeight }) => {
        viewportWidth = cssWidth;
        viewportHeight = cssHeight;
        uniforms.u_resolution.value.set(cssWidth, cssHeight);
      },
    });
  }

  function setupSettingsPanel() {
    settingsPanel.configure({
      title: 'Spectrograph',
      description:
        'Quality presets update DPI caps for both the shader view and renderer.',
    });
    settingsPanel.setQualityPresets({
      presets: DEFAULT_QUALITY_PRESETS,
      defaultPresetId: activeQuality.id,
      onChange: applyQualityPreset,
    });
  }

  function stopCurrentAudio() {
    if (toy.audioCleanup) {
      toy.audioCleanup();
    }

    toy.audioCleanup = null;
    toy.analyser = null;
    toy.audio = null;
    toy.audioListener = null;
    toy.audioStream = null;
  }

  function updateSpectrograph(dataArray: Uint8Array) {
    if (!dataArray.length) {
      spectroContext.clearRect(0, 0, viewportWidth, viewportHeight);
      return;
    }

    spectroContext.clearRect(0, 0, viewportWidth, viewportHeight);
    const gradient = spectroContext.createLinearGradient(
      0,
      0,
      viewportWidth,
      viewportHeight,
    );
    gradient.addColorStop(0, '#ff6ec7');
    gradient.addColorStop(0.5, '#8e44ad');
    gradient.addColorStop(1, '#3498db');
    spectroContext.fillStyle = gradient;
    const barWidth = (viewportWidth / dataArray.length) * 1.5;
    let barHeight = 0;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
      barHeight = dataArray[i] / 2;
      spectroContext.fillRect(
        x,
        viewportHeight - barHeight,
        barWidth,
        barHeight,
      );
      x += barWidth + 1;
    }
  }

  function animate(ctx: AnimationContext) {
    uniforms.u_time.value = clock.getElapsedTime();
    const dataArray = getContextFrequencyData(ctx);
    const average = getAverageFrequency(dataArray);
    uniforms.u_audioData.value = average / 128.0;

    if (ctx.analyser && patternRecognizer) {
      patternRecognizer.updatePatternBuffer();
      const detectedPattern = patternRecognizer.detectPattern();
      uniforms.u_colorOffset.value.set(detectedPattern ? 1.0 : 0.0, 0.0, 0.0);
    }

    updateSpectrograph(dataArray);
    toy.render();
  }

  let isStarting = false;

  async function startAudio(request: ToyAudioRequest = false) {
    if (isStarting) return;
    isStarting = true;

    stopCurrentAudio();

    const rendererResult = await toy.rendererReady;
    if (!rendererResult?.renderer) {
      isStarting = false;
      throw new Error('WebGL is not supported in this browser.');
    }

    try {
      const ctx = await startToyAudio(
        toy,
        animate,
        resolveToyAudioOptions(request, { fftSize: 256 }),
      );

      if (ctx.analyser) {
        patternRecognizer = new PatternRecognizer(ctx.analyser);
      }
      isStarting = false;
      return ctx;
    } catch (error) {
      console.error('Error capturing audio: ', error);
      isStarting = false;
      throw error;
    }
  }

  setupSettingsPanel();

  // Register globals for toy.html buttons
  // Register globals for toy.html buttons
  const unregisterGlobals = registerToyGlobals(container, startAudio);

  return {
    dispose: () => {
      toy.dispose();
      stopCurrentAudio();
      disposePointerInput.dispose();
      disposeResize();
      if (spectroCanvas?.parentElement) {
        spectroCanvas.parentElement.removeChild(spectroCanvas);
      }
      document.documentElement.style.touchAction = originalTouchAction;
      document.documentElement.style.touchAction = originalTouchAction;
      unregisterGlobals();
    },
  };
}
