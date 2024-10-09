// Apply scaling based on audio data
export function applyAudioScale(object, audioData, sensitivity = 50) {
    const { lowFreq, midFreq, highFreq } = audioData;

    object.scale.set(
        1 + (lowFreq / 256) * (sensitivity / 100),
        1 + (midFreq / 256) * (sensitivity / 100),
        1 + (highFreq / 256) * (sensitivity / 100)
    );
}

// Apply rotation based on audio data
export function applyAudioRotation(object, audioData, sensitivity = 1) {
    const { lowFreq, midFreq, highFreq } = audioData;

    object.rotation.x += (lowFreq / 256) * sensitivity;
    object.rotation.y += (midFreq / 256) * sensitivity;
    object.rotation.z += (highFreq / 256) * sensitivity;
}

// Apply color changes based on audio data
export function applyAudioColorChange(object, audioData, sensitivity = 1) {
    const { lowFreq, midFreq, highFreq } = audioData;

    const r = (lowFreq / 256) * sensitivity;
    const g = (midFreq / 256) * sensitivity;
    const b = (highFreq / 256) * sensitivity;

    object.material.color.setRGB(r, g, b);
}
