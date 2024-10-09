export async function initAudio() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioSource = audioContext.createMediaStreamSource(stream);
    audioSource.connect(analyser);

    return { analyser, dataArray };
}

export function getFrequencyData(analyser, dataArray) {
    analyser.getByteFrequencyData(dataArray);
    return dataArray.reduce((sum, value) => sum + value, 0) / dataArray.length;  // Average frequency
}
