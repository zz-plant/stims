import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.module.js';
import { initScene } from '../core/scene-setup.js';
import { initCamera } from '../core/camera-setup.js';
import { initRenderer } from '../core/renderer-setup.js';
import { initLighting, initAmbientLight } from '../lighting/lighting-setup.js';
import { initAudio, getFrequencyData } from '../utils/audio-handler.js';

let scene, camera, renderer, analyser;
let particles, particlesMaterial;

function init() {
  scene = initScene();
  camera = initCamera({ position: { x: 0, y: 0, z: 60 } });
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  renderer = initRenderer(canvas);

  initAmbientLight(scene);
  initLighting(scene, {
    type: 'PointLight',
    position: { x: 20, y: 20, z: 20 },
  });

  const particlesGeometry = new THREE.BufferGeometry();
  const count = 2000;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) {
    positions[i] = (Math.random() - 0.5) * 80;
  }
  particlesGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3)
  );
  particlesMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5 });
  particles = new THREE.Points(particlesGeometry, particlesMaterial);
  scene.add(particles);

  window.addEventListener('resize', handleResize);
}

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function startAudio() {
  try {
    const audio = await initAudio({ fftSize: 256 });
    analyser = audio.analyser;
    animate();
  } catch (e) {
    console.error('Microphone access denied', e);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const data = analyser ? getFrequencyData(analyser) : new Uint8Array(0);
  const avg = data.length ? data.reduce((a, b) => a + b, 0) / data.length : 0;
  const rotationSpeed = 0.001 + avg / 100000;
  particles.rotation.y += rotationSpeed;
  particles.rotation.x += rotationSpeed / 2;

  particlesMaterial.size = 1.5 + avg / 50;
  const hue = (avg / 256) % 1;
  particlesMaterial.color.setHSL(hue, 0.7, 0.6);

  renderer.render(scene, camera);
}

init();

const startButton = document.getElementById('startButton');
if (startButton) {
  startButton.addEventListener('click', () => {
    startButton.remove();
    startAudio();
  });
}
