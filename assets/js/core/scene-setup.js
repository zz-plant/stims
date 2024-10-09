import * as THREE from 'three';

// Initialize the Three.js scene
export function initScene({ backgroundColor = 0x000000 }) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor);
    return scene;
}
