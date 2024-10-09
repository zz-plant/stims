export function applyAudioRotation(object, audioData, factor) {
    object.rotation.x += audioData * factor;
    object.rotation.y += audioData * factor;
}

export function applyAudioScale(object, audioData, maxScale) {
    const scale = Math.min(audioData / 50, maxScale);
    object.scale.set(scale, scale, scale);
}
