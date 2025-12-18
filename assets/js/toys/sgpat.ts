import * as THREE from 'three';
import WebToy from '../core/web-toy';
import {
  AnimationContext,
  AudioLoopController,
  getContextFrequencyData,
  startAudioLoop,
} from '../core/animation-loop';
import { AudioAccessError, getAverageFrequency } from '../utils/audio-handler';
import { setupCanvasResize } from '../utils/canvas-resize';
import PatternRecognizer from '../utils/patternRecognition';

const toy = new WebToy({
  cameraOptions: {
    fov: 45,
    near: 0.1,
    far: 10,
    position: { x: 0, y: 0, z: 1 },
  },
});

toy.renderer?.domElement.classList.add('sgpat-canvas');
if (toy.renderer?.domElement) {
  Object.assign(toy.renderer.domElement.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
  });
}

type SpectroContext = CanvasRenderingContext2D;

const spectroCanvas =
  (document.getElementById('glCanvas') as HTMLCanvasElement | null) ||
  document.createElement('canvas');

if (!spectroCanvas.id) {
  spectroCanvas.id = 'glCanvas';
}

if (!spectroCanvas.parentElement) {
  document.body.appendChild(spectroCanvas);
}

const spectroCtx = spectroCanvas.getContext('2d') as SpectroContext | null;

if (!spectroCtx) {
  throw new Error('Unable to acquire 2D rendering context for spectrograph.');
}

spectroCanvas.style.position = 'fixed';
spectroCanvas.style.top = '0';
spectroCanvas.style.left = '0';
spectroCanvas.style.width = '100vw';
spectroCanvas.style.height = '100vh';
spectroCanvas.style.pointerEvents = 'none';

const uniforms = {
  u_time: { value: 0 },
  u_resolution: {
    value: new THREE.Vector2(window.innerWidth, window.innerHeight),
  },
  u_audioData: { value: 0 },
  u_colorOffset: { value: new THREE.Vector3(0, 0, 0) },
  u_touch: { value: new THREE.Vector2(0, 0) },
};

const startButton = document.getElementById('start-audio-button') as
  | HTMLButtonElement
  | null;

let audioController: AudioLoopController | null = null;

const fragmentShader = `
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_audioData;
  uniform vec3 u_colorOffset;
  uniform vec2 u_touch;

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
  })
);

toy.scene.add(quad);

let patternRecognizer: PatternRecognizer | null = null;
const clock = new THREE.Clock();
let viewportWidth = window.innerWidth;
let viewportHeight = window.innerHeight;
let isStarting = false;
let hasAudioStarted = false;
const disposeResize = setupCanvasResize(spectroCanvas, spectroCtx, {
  maxPixelRatio: 2,
  onResize: ({ cssWidth, cssHeight }) => {
    viewportWidth = cssWidth;
    viewportHeight = cssHeight;
    uniforms.u_resolution.value.set(cssWidth, cssHeight);
  },
});

function displayError(message: string) {
  const errorMessageElement = document.getElementById('error-message');
  if (!errorMessageElement) return;
  errorMessageElement.textContent = message;
  errorMessageElement.style.display = message ? 'block' : 'none';
}

function updateStartButton(label: string, disabled: boolean) {
  if (!startButton) return;
  startButton.textContent = label;
  startButton.disabled = disabled;
}

function stopCurrentAudio() {
  if (audioController) {
    audioController.stop();
  } else {
    toy.renderer?.setAnimationLoop?.(null);
    toy.stopAudio();
  }
  patternRecognizer = null;
}

function updateSpectrograph(dataArray: Uint8Array) {
  if (!dataArray.length) {
    spectroCtx.clearRect(0, 0, viewportWidth, viewportHeight);
    return;
  }

  spectroCtx.clearRect(0, 0, viewportWidth, viewportHeight);
  const gradient = spectroCtx.createLinearGradient(0, 0, viewportWidth, viewportHeight);
  gradient.addColorStop(0, '#ff6ec7');
  gradient.addColorStop(0.5, '#8e44ad');
  gradient.addColorStop(1, '#3498db');
  spectroCtx.fillStyle = gradient;
  const barWidth = (viewportWidth / dataArray.length) * 1.5;
  let barHeight;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    barHeight = dataArray[i] / 2;
    spectroCtx.fillRect(
      x,
      viewportHeight - barHeight,
      barWidth,
      barHeight
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

function handlePointerMove(event: PointerEvent) {
  const x = (event.clientX / window.innerWidth) * 2.0 - 1.0;
  const y = -(event.clientY / window.innerHeight) * 2.0 + 1.0;
  uniforms.u_touch.value.set(x, y);
}

async function start() {
  if (isStarting) return;
  isStarting = true;
  updateStartButton(hasAudioStarted ? 'Restarting...' : 'Starting...', true);
  if (!toy.renderer) {
    displayError('WebGL is not supported in this browser.');
    updateStartButton('Start / Retry Audio', false);
    isStarting = false;
    return;
  }
  try {
    stopCurrentAudio();
    audioController =
      audioController || startAudioLoop(toy, animate, { fftSize: 256 });
    const ctx = await audioController.start();
    if (ctx.analyser) {
      patternRecognizer = new PatternRecognizer(ctx.analyser);
    }
    hasAudioStarted = true;
    displayError('');
    updateStartButton('Restart Audio', false);
  } catch (error) {
    console.error('Error capturing audio: ', error);
    const isAudioError = error instanceof AudioAccessError;
    const reason = isAudioError ? error.reason : null;
    const message =
      reason === 'denied'
        ? 'Microphone access was denied. Please enable it to drive the spectrograph.'
        : reason === 'unsupported'
          ? 'This browser does not support microphone capture.'
          : 'Microphone access is required for the visualization to work. Please allow microphone access.';
    displayError(message);
    updateStartButton('Start / Retry Audio', false);
  }
  isStarting = false;
}

startButton?.addEventListener('click', start);
window.addEventListener('pointermove', handlePointerMove);
window.addEventListener('pagehide', disposeResize);
