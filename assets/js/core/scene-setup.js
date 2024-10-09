import * as THREE from 'three';

export function initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);
    return scene;
}

export function initPerspectiveCamera(fov = 75, aspect = window.innerWidth / window.innerHeight, near = 0.1, far = 1000) {
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.position.set(0, 0, 60);
    return camera;
}

export function initRenderer(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);
    return renderer;
}
