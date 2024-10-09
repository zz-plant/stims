import * as THREE from 'three';

export function initCamera({
    fov = 75, 
    aspect = window.innerWidth / window.innerHeight, 
    near = 0.1, 
    far = 1000, 
    position = { x: 0, y: 0, z: 50 }
}) {
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.position.set(position.x, position.y, position.z);
    return camera;
}
