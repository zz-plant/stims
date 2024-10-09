export function applyAudioScale(object, audioData, sensitivity = 50) {
    const { lowFreq, midFreq, highFreq } = audioData;

    // Scale the object based on audio frequency data and sensitivity
    object.scale.set(
        1 + lowFreq / 256 * sensitivity / 100,
        1 + midFreq / 256 * sensitivity / 100,
        1 + highFreq / 256 * sensitivity / 100
    );
}
