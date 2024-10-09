import { initScene } from './scene-setup.js';
import { initPerspectiveCamera, initOrthographicCamera } from './camera-setup.js';
import { initPointLight, initAmbientLight } from './lighting-setup.js';
import { initRenderer } from './renderer-setup.js';
import { initAudio, getFrequencyData } from './audio-handler.js';
import { applyAudioScale, applyAudioRotation, applyAudioColorChange } from './animation-utils.js';
import * as yaml from 'js-yaml';

let scene, camera, renderer;
let toyObject, sensitivity = 50;

// Fetch YAML configuration from the server or local path
function fetchYamlConfig(url) {
    return fetch(url)
        .then(response => response.text())
        .then(yamlText => yaml.load(yamlText))
        .catch(err => console.error('Error loading YAML:', err));
}

// Start the application by initializing the scene, renderer, camera, and the toy from the YAML configuration
export function startApp(canvasId, yamlConfigUrl) {
    const canvas = document.getElementById(canvasId);

    // Fetch the YAML config file and load toy configuration
    fetchYamlConfig(yamlConfigUrl).then(config => {
        // Initialize the scene
        scene = initScene();

        // Initialize the camera based on YAML configuration
        if (config.toy.camera.type === 'orthographic') {
            camera = initOrthographicCamera(
                config.toy.camera.left,
                config.toy.camera.right,
                config.toy.camera.top,
                config.toy.camera.bottom,
                config.toy.camera.near,
                config.toy.camera.far,
                config.toy.camera.position
            );
        } else {
            camera = initPerspectiveCamera(
                config.toy.camera.fov,
                window.innerWidth / window.innerHeight,
                config.toy.camera.near,
                config.toy.camera.far,
                config.toy.camera.position
            );
        }

        // Initialize the renderer based on YAML config
        renderer = initRenderer(canvas, {
            antialias: config.toy.renderer.antialias,
            shadowMapEnabled: config.toy.renderer.shadowMapEnabled,
            size: {
                width: window.innerWidth,
                height: window.innerHeight
            }
        });

        // Initialize lighting based on YAML config
        if (config.toy.lighting.type === 'ambient') {
            initAmbientLight(scene, config.toy.lighting.color);
        } else {
            initPointLight(scene, config.toy.lighting.color);
        }

        // Load the toy object from the YAML configuration
        toyObject = loadObjectFromConfig(scene, config.toy.object);

        // Start the audio processing (mic input)
        initAudio().then(() => {
            animate(config.toy.animations);
        });

        // Set up sensitivity control (HTML range input) for adjusting the animation sensitivity
        document.getElementById('sensitivity').addEventListener('input', (event) => {
            sensitivity = event.target.value;
        });
    });
}

// Animate the object based on audio input and YAML-defined animations
function animate(animations) {
    requestAnimationFrame(() => animate(animations));

    // Get the current audio frequency data
    const audioData = getFrequencyData();

    // Apply animations defined in the YAML configuration
    animations.forEach(animation => {
        switch (animation.type) {
            case 'scale':
                applyAudioScale(toyObject, audioData, animation.sensitivity || sensitivity);
                break;
            case 'rotation':
                applyAudioRotation(toyObject, audioData, animation.sensitivity || sensitivity);
                break;
            case 'color-change':
                applyAudioColorChange(toyObject, audioData, animation.sensitivity || sensitivity);
                break;
            default:
                console.error('Unknown animation type:', animation.type);
        }
    });

    // Render the scene using the renderer and camera
    renderer.render(scene, camera);
}

// Load and create the object (mesh) based on YAML configuration
function loadObjectFromConfig(scene, objectConfig) {
    let geometry, material, mesh;
    switch (objectConfig.type) {
        case 'cube':
            geometry = new THREE.BoxGeometry(objectConfig.size, objectConfig.size, objectConfig.size);
            material = new THREE.MeshStandardMaterial({ color: objectConfig.color });
            mesh = new THREE.Mesh(geometry, material);
            break;
        case 'sphere':
            geometry = new THREE.SphereGeometry(objectConfig.radius, 32, 32);
            material = new THREE.MeshStandardMaterial({ color: objectConfig.color });
            mesh = new THREE.Mesh(geometry, material);
            break;
        case 'torus':
            geometry = new THREE.TorusGeometry(objectConfig.radius, objectConfig.tube, 16, 100);
            material = new THREE.MeshStandardMaterial({ color: objectConfig.color });
            mesh = new THREE.Mesh(geometry, material);
            break;
        default:
            console.error('Unknown object type:', objectConfig.type);
            return;
    }

    // Add the mesh to the scene
    scene.add(mesh);
    return mesh;
}
