import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r155/three.module.js';
import { initScene } from '../core/scene-setup.js';
import { initCamera } from '../core/camera-setup.js';
import { initRenderer } from '../core/renderer-setup.js';
import { initLighting, initAmbientLight } from '../lighting/lighting-setup.js';
import { initAudio, getFrequencyData } from '../utils/audio-handler.js';

let scene, camera, renderer, torusKnot, particles;
const shapes = [];

function createRandomShape() {
    const shapeType = Math.floor(Math.random() * 3);
    let geometry;
    const material = new THREE.MeshStandardMaterial({
        color: Math.random() * 0xffffff,
        emissive: Math.random() * 0x444444,
        metalness: 0.8,
        roughness: 0.4
    });

    switch (shapeType) {
        case 0:
            geometry = new THREE.SphereGeometry(5, 32, 32);
            break;
        case 1:
            geometry = new THREE.BoxGeometry(7, 7, 7);
            break;
        default:
            geometry = new THREE.TetrahedronGeometry(6, 0);
            break;
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(Math.random() * 120 - 60, Math.random() * 120 - 60, Math.random() * -800);
    scene.add(mesh);
    shapes.push(mesh);
}

function init() {
    scene = initScene();
    camera = initCamera({ position: { x: 0, y: 0, z: 80 } });

    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    renderer = initRenderer(canvas);

    torusKnot = new THREE.Mesh(
        new THREE.TorusKnotGeometry(10, 3, 100, 16),
        new THREE.MeshStandardMaterial({ color: 0x00ffcc, metalness: 0.7, roughness: 0.4 })
    );
    scene.add(torusKnot);

    const particlesGeometry = new THREE.BufferGeometry();
    const particlesCount = 1500;
    const particlesPosition = new Float32Array(particlesCount * 3);
    for (let i = 0; i < particlesCount * 3; i++) {
        particlesPosition[i] = (Math.random() - 0.5) * 800;
    }
    particlesGeometry.setAttribute('position', new THREE.BufferAttribute(particlesPosition, 3));
    const particlesMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8 });
    particles = new THREE.Points(particlesGeometry, particlesMaterial);
    scene.add(particles);

    initAmbientLight(scene, { color: 0x404040, intensity: 0.8 });
    initLighting(scene, {
        type: 'PointLight',
        color: 0xff00ff,
        intensity: 2,
        position: { x: 20, y: 30, z: 20 }
    });

    for (let i = 0; i < 7; i++) {
        createRandomShape();
    }

    window.addEventListener('resize', handleResize);
}

function handleResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

let analyser;

async function startAudio() {
    try {
        const audioData = await initAudio();
        analyser = audioData.analyser;
        animate();
    } catch (e) {
        console.error('Error accessing microphone:', e);
    }
}

function animate() {
    requestAnimationFrame(animate);

    const dataArray = analyser ? getFrequencyData(analyser) : new Uint8Array(0);
    const avgFrequency = dataArray.length ? dataArray.reduce((a, b) => a + b, 0) / dataArray.length : 0;

    torusKnot.rotation.x += avgFrequency / 5000;
    torusKnot.rotation.y += avgFrequency / 7000;

    particles.rotation.y += 0.001 + avgFrequency / 15000;

    shapes.forEach((shape) => {
        shape.rotation.x += Math.random() * 0.03;
        shape.rotation.y += Math.random() * 0.03;
        shape.position.z += 1.5 + avgFrequency / 50;
        if (shape.position.z > 20) {
            shape.position.z = -800;
            shape.position.x = Math.random() * 120 - 60;
            shape.position.y = Math.random() * 120 - 60;
            shape.material.color.set(Math.random() * 0xffffff);
        }
    });

    const randomScale = 1 + Math.sin(Date.now() * 0.001) * 0.3;
    torusKnot.scale.set(randomScale, randomScale, randomScale);

    renderer.render(scene, camera);
}

init();
startAudio();
