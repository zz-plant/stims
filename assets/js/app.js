import { initScene } from './scene-setup.js';
import { initPerspectiveCamera, initOrthographicCamera } from './camera-setup.js';
import { initPointLight, initAmbientLight } from './lighting-setup.js';
import { initRenderer } from './renderer-setup.js';
import { initAudio, getFrequencyData } from './audio-handler.js';
import { applyAudioScale, applyAudioRotation, applyAudioColorChange } from './animation-utils.js';
import * as yaml from 'js-yaml';  // YAML parser

let scene, camera, renderer;
let toyObject, sensitivity = 50;

// Fetch YAML config from server or local
function fetchYamlConfig(url) {
    return fetch(url)
        .then(response => response.text())
        .then(yamlText => yaml.load(yamlText))
        .catch(err => console.error('Error loading YAML:', err));
}

export function startApp(canvasId, yamlConfigUrl) {
    const canvas = document.getElementById(canvasId);

    // Fetch the YAML file and load the toy configuration
    fetchYamlConfig(yamlConfigUrl).then(config => {
        // Initialize scene
        scene = initScene();

        // Initialize camera based on YAML config
        if (config.toy.camera.type === 'orthographic') {
            camera = initOrthographicCamera(config.toy.camera);
        } else {
            camera = initPerspectiveCamera(config.toy.camera);
        }

        // Initialize renderer based on YAML config
        renderer = initRenderer(canvas, {
            antialias: config.toy.renderer.antialias,
            shadowMapEnabled: config.toy.renderer.shadowMapEnabled
        });

        // Initialize lighting based on YAML config
        if (config.toy.lighting.type === 'ambient') {
            initAmbientLight(scene, config.toy.lighting.color);
        } else {
            initPointLight(scene, config.toy.lighting.color);
        }

        // Load the object based on YAML config
        toyObject = loadObjectFromConfig(scene, config.toy.object);

        // Start the audio processing
        initAudio().then(() => {
            animate(config.toy.animations);
        });

        // Set up sensitivity control
        document.getElementById('sensitivity').addEventListener('input', (event) => {
            sensitivity = event.target.value;
        });
    });
}

function animate(animations) {
    requestAnimationFrame(() => animate(animations));

    // Get the current audio data (frequencies)
    const audioData = getFrequencyData();

    // Apply animations based on YAML config
    animations.forEach(animation => {
        switch (animation.type) {
            case 'scale':
                applyAudioScale(toyObject, audioData, animation.sensitivity);
                break;
            case 'rotation':
                applyAudioRotation(toyObject, audioData, animation.sensitivity);
                break;
            case 'color-change':
                applyAudioColorChange(toyObject, audioData, animation.sensitivity);
                break;
        }
    });

    // Render the scene
    renderer.render(scene, camera);
}

function loadObjectFromConfig(scene, objectConfig) {
    let geometry, material, mesh;
    switch (objectConfig.type) {
        case 'cube':
            geometry = new THREE.BoxGeometry(objectConfig.size, objectConfig.size, objectConfig.size);
            material = new THREE.MeshStandardMaterial({ color: objectConfig.color });
            mesh = new THREE.Mesh(geometry, material);
            scene.add(mesh);
            break;
        // Add other object types (sphere, torus, etc.)
    }
    return mesh;
}
