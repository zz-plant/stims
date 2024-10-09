import * as THREE from 'three';

export function initScene({ backgroundColor = 0x000000 } = {}) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(backgroundColor);
    return scene;
}

export function initPerspectiveCamera({ fov = 75, aspect = window.innerWidth / window.innerHeight, near = 0.1, far = 1000, position = { x: 0, y: 0, z: 50 } } = {}) {
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.position.set(position.x, position.y, position.z);
    return camera;
}

export function initRenderer(canvas, { antialias = true } = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias });
    renderer.setSize(window.innerWidth, window.innerHeight);
    return renderer;
}
