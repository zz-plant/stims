import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.module.js';
import WebToy from '../core/web-toy.js';
import { getFrequencyData } from '../utils/audio-handler.js';

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 0, z: 60 } },
  lightingOptions: {
    type: 'PointLight',
    position: { x: 20, y: 20, z: 20 },
  },
  ambientLightOptions: {},
});

let particles, particlesMaterial;
let analyser;

function init() {
  const scene = toy.scene;
  const particlesGeometry = new THREE.BufferGeometry();
  const count = 2000;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) {
    positions[i] = (Math.random() - 0.5) * 80;
  }
  particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particlesMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5 });
  particles = new THREE.Points(particlesGeometry, particlesMaterial);
  scene.add(particles);
}

async function startAudio() {
  try {
    await toy.initAudio({ fftSize: 256 });
    analyser = toy.analyser;
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

  toy.render();
}

init();
startAudio();
