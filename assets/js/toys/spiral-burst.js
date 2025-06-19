import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.module.js';
import { initScene } from '../core/scene-setup.js';
import { initCamera } from '../core/camera-setup.js';
import { initRenderer } from '../core/renderer-setup.js';
import { initLighting, initAmbientLight } from '../lighting/lighting-setup.js';
import { initAudio, getFrequencyData } from '../utils/audio-handler.js';

let scene, camera, renderer, analyser;
const lines = [];

function init() {
  scene = initScene();
  camera = initCamera({ position: { x: 0, y: 0, z: 100 } });
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  renderer = initRenderer(canvas);

  initAmbientLight(scene);
  initLighting(scene, { type: 'HemisphereLight' });

  for (let i = 0; i < 50; i++) {
    const geometry = new THREE.BufferGeometry();
    const points = [];
    for (let j = 0; j < 30; j++) {
      const angle = j * 0.2 + i * 0.1;
      const radius = j * 0.5 + i;
      points.push(
        new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, j)
      );
    }
    geometry.setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: Math.random() * 0xffffff,
    });
    const line = new THREE.Line(geometry, material);
    scene.add(line);
    lines.push(line);
  }

  window.addEventListener('resize', handleResize);
}

function handleResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

async function startAudio() {
  try {
    const audio = await initAudio();
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
  const binsPerLine = data.length / lines.length;
  lines.forEach((line, idx) => {
    const bin = Math.floor(idx * binsPerLine);
    const value = data[bin] || avg;
    line.rotation.z += 0.002 + value / 100000;
    line.rotation.x += 0.001 + idx / 10000;
    const scale = 1 + value / 256;
    line.scale.set(scale, scale, scale);
    const hue = (idx / lines.length + value / 512) % 1;
    line.material.color.setHSL(hue, 0.6, 0.5);
  });
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
