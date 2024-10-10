// app.js

import { initScene } from './core/scene-setup.js';
import { initCamera } from './core/camera-setup.js';
import { initRenderer } from './core/renderer-setup.js';
import { initAudio, getFrequencyData } from './utils/audio-handler.js';
import { applyAudioRotation, applyAudioScale } from './utils/animation-utils.js';
import PatternRecognizer from './utils/patternRecognition.js';

let scene, camera, renderer, cube, analyser, patternRecognizer;

function initVisualization() {
    scene = initScene();
    camera = initCamera();
    const canvas = document.getElementById('toy-canvas');
    renderer = initRenderer(canvas);

    // Add a cube to the scene
    const geometry = new THREE.BoxGeometry();
    const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    cube = new THREE.Mesh(geometry, material);
    scene.add(cube);
}

function startAudioAndAnimation() {
    initAudio().then((audioData) => {
        analyser = audioData.analyser;
        patternRecognizer = new PatternRecognizer(analyser);
        
        animate();
    }).catch((error) => {
        console.error('Error accessing microphone:', error);
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

// Start visualization
initVisualization();

// Handle audio start button click
document.getElementById('start-audio-btn').addEventListener('click', () => {
    startAudioAndAnimation();
    document.getElementById('start-audio-btn').style.display = 'none'; // Hide button after starting audio
});

// Handle window resize
window.addEventListener('resize', handleResize);
