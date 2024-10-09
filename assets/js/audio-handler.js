let audioAnalyser, dataArray;

export function initAudio() {
    return navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            audioAnalyser = audioContext.createAnalyser();
            audioAnalyser.fftSize = 512;

            const bufferLength = audioAnalyser.frequencyBinCount;
            dataArray = new Uint8Array(bufferLength);

            source.connect(audioAnalyser);
        })
        .catch(err => {
            console.error("Microphone access denied or not available", err);
        });
}

export function getFrequencyData() {
    if (audioAnalyser) {
        audioAnalyser.getByteFrequencyData(dataArray);
        const lowFreq = dataArray.slice(0, dataArray.length / 3).reduce((a, b) => a + b, 0) / (dataArray.length / 3);
        const midFreq = dataArray.slice(dataArray.length / 3, 2 * dataArray.length / 3).reduce((a, b) => a + b, 0) / (dataArray.length / 3);
        const highFreq = dataArray.slice(2 * dataArray.length / 3).reduce((a, b) => a + b, 0) / (dataArray.length / 3);

        return { lowFreq, midFreq, highFreq };
    }
    return { lowFreq: 0, midFreq: 0, highFreq: 0 };
}
