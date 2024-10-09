// app.js: Updated version

import { initScene, initPerspectiveCamera, initRenderer } from './core/scene-setup.js';
import { initAudio, getFrequencyData } from './utils/audio-handler.js';
import { applyAudioRotation } from './utils/animation-utils.js';

let scene, camera, renderer;

async function init() {
  // Create scene, camera, and renderer
  scene = initScene();
  camera = initPerspectiveCamera();
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
      const audioData = getFrequencyData(analyser, dataArray);
      applyAudioRotation(cube, audioData);
    }
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.01;
    renderer.render(scene, camera);
  }

  animate();
}

// Handle resizing
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Initialize the scene
init();
