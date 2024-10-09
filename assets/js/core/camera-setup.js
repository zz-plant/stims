import * as THREE from 'three';

// Initialize perspective camera
export function initPerspectiveCamera(fov = 75, aspect = window.innerWidth / window.innerHeight, near = 0.1, far = 1000, position = { x: 0, y: 0, z: 5 }) {
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.position.set(position.x, position.y, position.z);
    return camera;
}

// Initialize orthographic camera
export function initOrthographicCamera(left = -5, right = 5, top = 5, bottom = -5, near = 0.1, far = 1000, position = { x: 0, y: 0, z: 5 }) {
    const camera = new THREE.OrthographicCamera(left, right, top, bottom, near, far);
    camera.position.set(position.x, position.y, position.z);
    return camera;
}
