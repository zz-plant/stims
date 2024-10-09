export async function initAudio() {
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamSource(stream);

        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        return { analyser, dataArray };
    } catch (error) {
        console.error("Audio initialization failed:", error);
        return null;
    }
}

export function getFrequencyData(analyser, dataArray) {
    analyser.getByteFrequencyData(dataArray);
    return {
        lowFreq: dataArray.slice(0, 64).reduce((a, b) => a + b) / 64,
        midFreq: dataArray.slice(64, 128).reduce((a, b) => a + b) / 64,
        highFreq: dataArray.slice(128, 256).reduce((a, b) => a + b) / 128,
    };
}
