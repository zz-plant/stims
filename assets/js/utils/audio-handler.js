export async function initAudio(options = {}) {
    const { fftSize = 256 } = options;
    try {
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = fftSize;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioSource = audioContext.createMediaStreamSource(stream);
        audioSource.connect(analyser);

        return { analyser, dataArray, audioContext, stream };
    } catch (error) {
        console.error('Error accessing audio:', error);
        throw new Error('Microphone access was denied.');
    }
}

export function getFrequencyData(analyser) {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);
    return dataArray;
}
