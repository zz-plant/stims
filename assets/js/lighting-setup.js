import * as THREE from 'three';

export function initLighting(scene) {
    const light = new THREE.PointLight(0xffffff, 1);
    light.position.set(5, 5, 5);
    scene.add(light);
}
