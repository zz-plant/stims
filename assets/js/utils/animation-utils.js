// Apply scaling based on audio data
export function applyAudioScale(mesh, audioData, sensitivity = 50) {
    const { lowFreq, midFreq, highFreq } = audioData;

    mesh.scale.set(
        1 + (lowFreq / 256) * (sensitivity / 100),
        1 + (midFreq / 256) * (sensitivity / 100),
        1 + (highFreq / 256) * (sensitivity / 100)
    );
}

// Apply rotation based on audio data
export function applyAudioRotation(mesh, audioData, sensitivity = 1) {
    const { lowFreq, midFreq, highFreq } = audioData;

    mesh.rotation.x += (lowFreq / 256) * sensitivity;
    mesh.rotation.y += (midFreq / 256) * sensitivity;
    mesh.rotation.z += (highFreq / 256) * sensitivity;
}

// Apply color changes based on audio data
export function applyAudioColorChange(mesh, audioData, sensitivity = 1) {
    const { lowFreq, midFreq, highFreq } = audioData;

    const r = (lowFreq / 256) * sensitivity;
    const g = (midFreq / 256) * sensitivity;
    const b = (highFreq / 256) * sensitivity;

    mesh.material.color.setRGB(r, g, b);
}
