// scene-setup.js
export function initScene(config = { backgroundColor: 0x000000 }) {
    const scene = new THREE.Scene();
    if (config.backgroundColor) scene.background = new THREE.Color(config.backgroundColor);
    return scene;
}

export function initCamera(config = { fov: 75, aspectRatio: window.innerWidth / window.innerHeight, near: 0.1, far: 1000, position: { x: 0, y: 0, z: 50 } }) {
    const camera = new THREE.PerspectiveCamera(config.fov, config.aspectRatio, config.near, config.far);
    camera.position.set(config.position.x, config.position.y, config.position.z);
    return camera;
}
