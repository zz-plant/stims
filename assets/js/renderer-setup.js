import * as THREE from 'three';

export function initRenderer(canvas, { antialias = true, shadowMapEnabled = false, size = { width: window.innerWidth, height: window.innerHeight } } = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias });
    renderer.setSize(size.width, size.height);
    
    // Enable or disable shadow mapping based on the configuration
    renderer.shadowMap.enabled = shadowMapEnabled;

    return renderer;
}
