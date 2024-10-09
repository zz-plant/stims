import { initScene } from './scene-setup.js';
import { initPerspectiveCamera, initOrthographicCamera } from './camera-setup.js';
import { initPointLight, initAmbientLight } from './lighting-setup.js';
import { initRenderer } from './renderer-setup.js';
import { initAudio, getFrequencyData } from './audio-handler.js';
import { applyAudioScale, applyAudioRotation, applyAudioColorChange } from './animation-utils.js';

let scene, camera, renderer;
let toyObject, sensitivity = 50;

// Start the application by initializing the scene, renderer, camera, and the toy from the HTML configuration
export function startApp(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error('Canvas element not found.');
        return;
    }

    if (!config) {
        console.error('Failed to load configuration.');
        return;
    }
    console.log('Loaded Config:', config);

    // Initialize the scene
    scene = initScene();

    // Initialize the camera based on configuration
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
    console.log('Camera Initialized:', camera);

    // Initialize the renderer based on config
    renderer = initRenderer(canvas, {
        antialias: config.toy.renderer.antialias,
        shadowMapEnabled: config.toy.renderer.shadowMapEnabled,
        size: {
            width: window.innerWidth,
            height: window.innerHeight
        }
    });
    if (!renderer) {
        console.error('Renderer initialization failed.');
        return;
    }
    console.log('Renderer Initialized:', renderer);

    // Initialize lighting based on config
    if (config.toy.lighting.type === 'ambient') {
        initAmbientLight(scene, config.toy.lighting.color);
    } else {
        initPointLight(scene, config.toy.lighting.color);
    }

    // Load the toy object from the configuration
    toyObject = loadObjectFromConfig(scene, config.toy.object);
    if (!toyObject) {
        console.error('Failed to initialize toy object.');
        return;
    }
    console.log('Toy Object Initialized:', toyObject);

    // Start the audio processing (mic input)
    initAudio().then(() => {
        animate(config.toy.animations);
    }).catch(err => {
        console.error('Audio initialization failed:', err);
        animate(config.toy.animations);  // Start animation without audio
    });

    // Set up sensitivity control (HTML range input) for adjusting the animation sensitivity
    document.getElementById('sensitivity').addEventListener('input', (event) => {
        sensitivity = event.target.value;
    });
}

// Animate the object based on audio input and defined animations
function animate(animations) {
    requestAnimationFrame(() => animate(animations));

    // Get the current audio frequency data
    const audioData = getFrequencyData();

    // Apply animations defined in the configuration
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
    if (renderer && camera && scene) {
        renderer.render(scene, camera);
    } else {
        console.error('Renderer, camera, or scene not initialized properly.');
    }
}

// Load and create the object (mesh) based on configuration
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
