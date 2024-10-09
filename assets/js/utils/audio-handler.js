export async function initAudio() {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(stream);

    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    return { analyser, dataArray };
}

export function getFrequencyData(analyser, dataArray) {
    analyser.getByteFrequencyData(dataArray);
    return dataArray;
}
