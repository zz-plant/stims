import * as THREE from 'three';

// Initialize point light
export function initPointLight(scene, color = 0xffffff, intensity = 1, position = { x: 5, y: 5, z: 5 }) {
    const light = new THREE.PointLight(color, intensity);
    light.position.set(position.x, position.y, position.z);
    scene.add(light);
}

// Initialize ambient light
export function initAmbientLight(scene, color = 0x404040, intensity = 1) {
    const ambientLight = new THREE.AmbientLight(color, intensity); // Soft light
    scene.add(ambientLight);
}

// Initialize directional light
export function initDirectionalLight(scene, color = 0xffffff, intensity = 1, position = { x: 5, y: 5, z: 5 }) {
    const directionalLight = new THREE.DirectionalLight(color, intensity);
    directionalLight.position.set(position.x, position.y, position.z);
    scene.add(directionalLight);
}
