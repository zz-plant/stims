// lighting-setup.js
export function initLighting(scene, config = { color: 0xffffff, intensity: 1, position: { x: 10, y: 10, z: 10 } }) {
    const light = new THREE.PointLight(config.color, config.intensity);
    light.position.set(config.position.x, config.position.y, config.position.z);
    scene.add(light);
}

export function initAmbientLight(scene, config = { color: 0x404040, intensity: 0.5 }) {
    const ambientLight = new THREE.AmbientLight(config.color, config.intensity);
    scene.add(ambientLight);
}
