export function applyAudioRotation(mesh, audioData) {
    const rotationSpeed = audioData[0] / 255.0 * 0.05; // Maps frequency to a speed factor.
    mesh.rotation.x += rotationSpeed;
    mesh.rotation.y += rotationSpeed;
}
