// app.js: Updated version

import { initScene } from './core/scene-setup.js';
import { initCamera } from './core/camera-setup.js';
import { initRenderer } from './core/renderer-setup.js';
import { initAudio, getFrequencyData } from './utils/audio-handler.js';
import { applyAudioRotation, applyAudioScale } from './utils/animation-utils.js';

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

  // Initialize audio
  const { analyser, dataArray } = await initAudio();

  // Animation loop
  function animate() {
    requestAnimationFrame(animate);
    if (analyser) {
      const audioData = getFrequencyData(analyser);
      applyAudioRotation(cube, audioData, 0.05);
      applyAudioScale(cube, audioData, 50);
    }
    renderer.render(scene, camera);
  }

  animate();
}

// Debounce resize to optimize performance
function debounce(func, wait = 100) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Handle resizing with debounce
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
