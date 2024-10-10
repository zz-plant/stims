// app.js

import { initScene } from './core/scene-setup.js';
import { initCamera } from './core/camera-setup.js';
import { initRenderer } from './core/renderer-setup.js';
import { initAudio, getFrequencyData } from './utils/audio-handler.js';
import { applyAudioRotation, applyAudioScale } from './utils/animation-utils.js';
import PatternRecognizer from './utils/patternRecognition.js';

let scene, camera, renderer;

async function init() {
  // Create scene, camera, and renderer
  scene = initScene();
  camera = initCamera();
  const canvas = document.getElementById('toy-canvas');
  renderer = initRenderer(canvas);

  // Add a cube to the scene
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const cube = new THREE.Mesh(geometry, material);
  scene.add(cube);

  // Initialize audio and pattern recognition
  const { analyser } = await initAudio();
  const patternRecognizer = new PatternRecognizer(analyser);

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);

    if (analyser) {
      const audioData = getFrequencyData(analyser);
      applyAudioRotation(cube, audioData, 0.05);
      applyAudioScale(cube, audioData, 50);

      // Update pattern buffer and detect pattern
      patternRecognizer.updatePatternBuffer();
      const detectedPattern = patternRecognizer.detectPattern();

      if (detectedPattern) {
        // Do something when a pattern is detected, e.g., change cube color
        cube.material.color.setHex(0xff0000); // Example change
      } else {
        cube.material.color.setHex(0x00ff00); // Reset color
      }
    }

    renderer.render(scene, camera);
  }

  animate();
}

// Handle window resizing with debounce
function debounce(func, wait = 100) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

window.addEventListener(
  'resize',
  debounce(() => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  })
);

// Initialize the scene
init();
