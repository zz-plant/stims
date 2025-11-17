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

let scene, camera, renderer, cube, analyser, patternRecognizer;
let currentLightType = 'PointLight'; // Default light type

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
  renderer = initRenderer(canvas);

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
}

function startAudioAndAnimation() {
  initAudio()
    .then((audioData) => {
      analyser = audioData.analyser;
      patternRecognizer = new PatternRecognizer(analyser);
      animate();
    })
    .catch((error) => {
      console.error('initAudio failed:', error);
      const errorMessage =
        error?.message ||
        'Microphone access is required for the visualization to work. Please allow microphone access.';
      displayError(errorMessage);
    });
}

function animate() {
  requestAnimationFrame(animate);

  if (analyser) {
    const audioData = getFrequencyData(analyser);
    applyAudioRotation(cube, audioData, 0.05);
    applyAudioScale(cube, audioData, 50);

    patternRecognizer.updatePatternBuffer();
    const detectedPattern = patternRecognizer.detectPattern();

    if (detectedPattern) {
      cube.material.color.setHex(0xff0000); // Detected pattern color
    } else {
      cube.material.color.setHex(0x00ff00); // Normal color
    }
  }

  renderer.render(scene, camera);
}

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function displayError(message) {
  const errorElement = document.getElementById('error-message');
  if (errorElement) {
    errorElement.innerText = message;
    errorElement.style.display = 'block';
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
document.getElementById('start-audio-btn').addEventListener('click', () => {
  startAudioAndAnimation();
  document.getElementById('start-audio-btn').style.display = 'none'; // Hide button after starting audio
});

// Handle window resize
window.addEventListener('resize', handleResize);
