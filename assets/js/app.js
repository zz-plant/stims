import { initScene } from './scene-setup.js';
import { initCamera } from './camera-setup.js';
import { initLighting } from './lighting-setup.js';
import { initRenderer } from './renderer-setup.js';
import { initAudio, getFrequencyData } from './audio-handler.js';
import { applyAudioScale } from './animation-utils.js';

let scene, camera, renderer;
let toyObject, sensitivity = 50;

export function startApp(canvasId, toyType) {
    const canvas = document.getElementById(canvasId);

    // Initialize scene, camera, lighting, and renderer using modular setup
    scene = initScene();
    camera = initCamera();
    renderer = initRenderer(canvas);
    initLighting(scene);

    // Load the specific toy based on its type
    toyObject = loadToy(scene, toyType);

    // Start the audio processing
    initAudio().then(() => {
        animate();
    });

    // Set up sensitivity control
    document.getElementById('sensitivity').addEventListener('input', (event) => {
        sensitivity = event.target.value;
    });
}

function animate() {
    requestAnimationFrame(animate);

    // Get the current audio data (frequencies)
    const audioData = getFrequencyData();

    // Apply audio-based scaling or other animations to the toy
    applyAudioScale(toyObject, audioData, sensitivity);

    // Render the scene
    renderer.render(scene, camera);
}

function loadToy(scene, toyType) {
    let object;
    switch (toyType) {
        case '3dtoy':
            object = new THREE.TorusKnotGeometry(1, 0.3, 100, 16);
            break;
        case 'stickman':
            object = new THREE.BoxGeometry(0.5, 1, 0.2);
            break;
        default:
            object = new THREE.SphereGeometry(1, 32, 32);  // Fallback toy
    }

    const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    const mesh = new THREE.Mesh(object, material);
    scene.add(mesh);

    return mesh;
}
