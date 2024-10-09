// animation-utils.js
export function applyAudioRotation(object, audioData, rotationSpeed) {
    const avgFrequency = audioData.reduce((acc, val) => acc + val, 0) / audioData.length;
    object.rotation.x += rotationSpeed * (avgFrequency / 255);
    object.rotation.y += rotationSpeed * (avgFrequency / 255);
}

export function applyAudioScale(object, audioData, scaleFactor) {
    const avgFrequency = audioData.reduce((acc, val) => acc + val, 0) / audioData.length;
    const scale = 1 + avgFrequency / scaleFactor;
    object.scale.set(scale, scale, scale);
}
