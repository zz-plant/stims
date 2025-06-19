import * as THREE from 'three';
import WebToy from '../core/web-toy.js';
import { getFrequencyData } from '../utils/audio-handler.js';

const toy = new WebToy({
  cameraOptions: { position: { x: 0, y: 30, z: 80 } },
  lightingOptions: {
    type: 'DirectionalLight',
    position: { x: 0, y: 50, z: 50 },
  },
  ambientLightOptions: {},
});

const cubes = [];
let analyser;

function init() {
  const { scene } = toy;
  const gridSize = 10;
  const spacing = 5;
  const geometry = new THREE.BoxGeometry(4, 4, 4);
  const material = new THREE.MeshStandardMaterial({ color: 0x66ccff });

  for (let x = -gridSize / 2; x < gridSize / 2; x++) {
    for (let z = -gridSize / 2; z < gridSize / 2; z++) {
      const cube = new THREE.Mesh(geometry, material.clone());
      cube.position.set(x * spacing, 0, z * spacing);
      scene.add(cube);
      cubes.push(cube);
    }
  }
}

async function startAudio() {
  try {
    await toy.initAudio({ fftSize: 128 });
    analyser = toy.analyser;
    animate();
  } catch (e) {
    console.error('Microphone access denied', e);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dataArray = analyser ? getFrequencyData(analyser) : new Uint8Array(0);
  const avg = dataArray.length
    ? dataArray.reduce((a, b) => a + b, 0) / dataArray.length
    : 0;

  const binsPerCube = dataArray.length / cubes.length;
  cubes.forEach((cube, i) => {
    const bin = Math.floor(i * binsPerCube);
    const value = dataArray[bin] || avg;
    const scale = 1 + value / 128;
    cube.scale.y = scale;
    cube.material.color.setHSL(0.6 - value / 512, 0.8, 0.5);
    cube.rotation.y += value / 100000;
  });

  toy.render();
}

init();
startAudio();
