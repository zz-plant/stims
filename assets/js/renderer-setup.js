import * as THREE from 'three';

export function initRenderer(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.setSize(window.innerWidth, window.innerHeight);
    return renderer;
}
