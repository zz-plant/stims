import * as THREE from 'three';

export function initRenderer(canvas, { antialias = true, size = { width: window.innerWidth, height: window.innerHeight } } = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias });
    renderer.setSize(size.width, size.height);
    return renderer;
}
