// renderer-setup.js
export function initRenderer(canvas, config = { antialias: true }) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: config.antialias });
    renderer.setSize(window.innerWidth, window.innerHeight);
    return renderer;
}
