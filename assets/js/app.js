import { initScene } from './scene-setup.js';
import { initPerspectiveCamera, initOrthographicCamera } from './camera-setup.js';
import { initPointLight, initAmbientLight } from './lighting-setup.js';
import { initRenderer } from './renderer-setup.js';
import { initAudio, getFrequencyData } from './audio-handler.js';
import { applyAudioScale, applyAudioRotation, applyAudioColorChange } from './animation-utils.js';
import * as yaml from 'js-yaml';

let scene, camera, renderer, toyObject, sensitivity = 50;

function fetchYamlConfig(url) {
    return fetch(url)
        .then(response => response.text())
        .then(yamlText => yaml.load(yamlText))
        .catch(err => console.error('Error loading YAML:', err));
}

export function startApp(canvasId, yamlConfigUrl) {
    const canvas = document.getElementById(canvasId);

    fetchYamlConfig(yamlConfigUrl).then(config => {
        scene = initScene();
        camera = config.toy.camera.type === 'orthographic' 
            ? initOrthographicCamera(config.toy.camera) 
            : initPerspectiveCamera(config.toy.camera);

        renderer = initRenderer(canvas, {
            antialias: config.toy.renderer.antialias,
            shadowMapEnabled: config.toy.renderer.shadowMapEnabled
        });

        if (config.toy.lighting.type === 'ambient') {
            initAmbientLight(scene, config.toy.lighting.color);
        } else {
            initPointLight(scene, config.toy.lighting.color);
        }

        toyObject = loadObjectFromConfig(scene, config.toy.object);

        initAudio().then(() => {
            animate(config.toy.animations);
        });

        document.getElementById('sensitivity').addEventListener('input', (event) => {
            sensitivity = event.target.value;
        });
    });
}

function animate(animations) {
    requestAnimationFrame(() => animate(animations));
    const audioData = getFrequencyData();

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
        // Add more object types as needed
    }
    return mesh;
}
