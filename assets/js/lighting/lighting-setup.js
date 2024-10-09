import * as THREE from 'three';

export function initAmbientLight(scene, color = 0x404040, intensity = 0.5) {
    const ambientLight = new THREE.AmbientLight(color, intensity);
    scene.add(ambientLight);
}

export function initPointLight(scene, color = 0xffffff, intensity = 1, position = { x: 10, y: 10, z: 10 }) {
    const light = new THREE.PointLight(color, intensity);
    light.position.set(position.x, position.y, position.z);
    scene.add(light);
}
