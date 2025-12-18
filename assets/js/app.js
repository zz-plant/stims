import * as THREE from 'three';
import { initScene } from './core/scene-setup.ts';
import { initCamera } from './core/camera-setup.ts';
import { initRenderer } from './core/renderer-setup.ts';
import { ensureWebGL } from './utils/webgl-check.ts';
import { initLighting, initAmbientLight } from './lighting/lighting-setup';
import { initAudio, getFrequencyData } from './utils/audio-handler.ts';
import {
  applyAudioRotation,
  applyAudioScale,
} from './utils/animation-utils.ts';
import PatternRecognizer from './utils/patternRecognition.ts';

const DEFAULT_RENDERER_OPTIONS = { maxPixelRatio: 2 };

let scene, camera, renderer, cube, analyser, patternRecognizer, audioCleanup;
let currentLightType = 'PointLight'; // Default light type
let animationFrameId = null;
let isAnimating = false;
let audioListener = null;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let isReducedMotionPreferred = prefersReducedMotion.matches;

function initVisualization() {
  if (!ensureWebGL()) {
    return;
  }
  if (renderer) {
    renderer.dispose();
  }

  if (scene) {
    scene.traverse((object) => {
      if (object.isMesh) {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((mat) => mat.dispose());
          } else {
            object.material.dispose();
          }
        }
      }
    });
    while (scene.children.length > 0) {
      scene.remove(scene.children[0]);
    }
  }

  scene = initScene();
  camera = initCamera();
  const canvas = document.getElementById('toy-canvas');
  renderer = initRenderer(canvas, DEFAULT_RENDERER_OPTIONS);

  // Set up lighting based on user selection
  initLighting(scene, {
    type: currentLightType,
    color: 0xffffff,
    intensity: 1,
    position: { x: 10, y: 10, z: 20 },
  });
  initAmbientLight(scene, { color: 0x404040, intensity: 0.5 });

  // Add a cube to the scene
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  renderSceneOnce();
}

function startAnimationLoop() {
  if (isAnimating || isReducedMotionPreferred) return;

  isAnimating = true;
  animationFrameId = requestAnimationFrame(animate);
}

function stopAnimationLoop() {
  if (!isAnimating) return;

  isAnimating = false;
  if (animationFrameId !== null) {
    window.cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

async function startAudioAndAnimation() {
  try {
    const audioData = await initAudio();
    analyser = audioData.analyser;
    audioListener = audioData.listener ?? null;
    audioCleanup = audioData.cleanup;
    patternRecognizer = new PatternRecognizer(analyser);

    if (isReducedMotionPreferred) {
      renderSceneOnce();
    } else {
      startAnimationLoop();
    }
    return true;
  } catch (error) {
    console.error('initAudio failed:', error);
    displayError(
      'Microphone access is required for the visualization to work. Please allow microphone access.'
    );
    return false;
  }
}

function animate() {
  if (!isAnimating) return;

  if (analyser) {
    const audioData = getFrequencyData(analyser);

    if (!isReducedMotionPreferred) {
      applyAudioRotation(cube, audioData, 0.05);
      applyAudioScale(cube, audioData, 50);
    }

    patternRecognizer.updatePatternBuffer();
    const detectedPattern = patternRecognizer.detectPattern();

    if (detectedPattern) {
      cube.material.color.setHex(0xff0000); // Detected pattern color
    } else {
      cube.material.color.setHex(0x00ff00); // Normal color
    }
  }

  renderer.render(scene, camera);

  animationFrameId = requestAnimationFrame(animate);
}

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function renderSceneOnce() {
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

function displayError(message) {
  const errorElement = document.getElementById('error-message');
  if (errorElement) {
    errorElement.innerText = message;
    errorElement.hidden = !message;
  }
}

// Update lighting type on change
document.getElementById('light-type').addEventListener('change', (event) => {
  currentLightType = event.target.value;
  // Reinitialize lighting
  initVisualization();
});

// Start visualization
initVisualization();

// Handle audio start button click
document
  .getElementById('start-audio-btn')
  .addEventListener('click', async () => {
    const startButton = document.getElementById('start-audio-btn');
    startButton.disabled = true;
    const started = await startAudioAndAnimation();
    if (started) {
      startButton.style.display = 'none'; // Hide button after starting audio
      displayError('');
    } else {
      startButton.disabled = false;
    }
  });

// Handle window resize
window.addEventListener('resize', handleResize);

// Clean up audio when navigating away
window.addEventListener('pagehide', () => {
  if (audioCleanup) {
    audioCleanup();
    analyser = null;
    patternRecognizer = null;
    audioListener = null;
  }
  stopAnimationLoop();
});

async function handleVisibilityChange() {
  if (document.visibilityState === 'hidden') {
    stopAnimationLoop();

    if (audioListener?.context?.state === 'running') {
      try {
        await audioListener.context.suspend();
      } catch (error) {
        console.error('Error suspending audio context:', error);
      }
    } else if (audioCleanup) {
      audioCleanup();
      analyser = null;
      patternRecognizer = null;
      audioListener = null;
    }

    return;
  }

  if (document.visibilityState === 'visible') {
    if (audioListener?.context?.state === 'suspended') {
      try {
        await audioListener.context.resume();
      } catch (error) {
        console.error('Error resuming audio context:', error);
      }
    } else if (!analyser && audioCleanup) {
      await startAudioAndAnimation();
    }

    if (analyser) {
      startAnimationLoop();
    }
  }
}

document.addEventListener('visibilitychange', () => {
  handleVisibilityChange();
});

function handleReducedMotionChange(event) {
  isReducedMotionPreferred = event.matches;

  if (isReducedMotionPreferred) {
    stopAnimationLoop();
    renderSceneOnce();
  } else if (analyser) {
    startAnimationLoop();
  }
}

prefersReducedMotion.addEventListener('change', handleReducedMotionChange);
