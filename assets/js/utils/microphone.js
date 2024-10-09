export async function initAudio() {
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  const dataArray = new Uint8Array(analyser.frequencyBinCount);

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioSource = audioContext.createMediaStreamSource(stream);
  audioSource.connect(analyser);

  return { analyser, dataArray };
}

export function getFrequencyData(analyser) {
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(dataArray);
  return dataArray;
}
