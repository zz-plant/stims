// animation-utils.js

// Function to apply audio-driven rotation based on different frequency bands
export function applyAudioRotation(
  object: { rotation: { x: number; y: number } },
  audioData: Uint8Array,
  rotationSpeed: number,
  band: 'low' | 'mid' | 'high' | 'average' = 'average'
) {
  let avgFrequency;

  switch (band) {
    case 'low':
      avgFrequency = getLowFrequency(audioData);
      break;
    case 'mid':
      avgFrequency = getMidFrequency(audioData);
      break;
    case 'high':
      avgFrequency = getHighFrequency(audioData);
      break;
    default:
      avgFrequency = getAverageFrequency(audioData);
      break;
  }

  object.rotation.x += rotationSpeed * (avgFrequency / 255);
  object.rotation.y += rotationSpeed * (avgFrequency / 255);
}

// Function to apply audio-driven scaling based on different frequency bands
export function applyAudioScale(
  object: { scale: { set: (x: number, y: number, z: number) => void } },
  audioData: Uint8Array,
  scaleFactor: number,
  band: 'low' | 'mid' | 'high' | 'average' = 'average'
) {
  let avgFrequency;

  switch (band) {
    case 'low':
      avgFrequency = getLowFrequency(audioData);
      break;
    case 'mid':
      avgFrequency = getMidFrequency(audioData);
      break;
    case 'high':
      avgFrequency = getHighFrequency(audioData);
      break;
    default:
      avgFrequency = getAverageFrequency(audioData);
      break;
  }

  const scale = 1 + avgFrequency / scaleFactor;
  object.scale.set(scale, scale, scale);
}

// Helper functions to extract different frequency ranges
function averageFrequencyRange(
  audioData: Uint8Array,
  startRatio: number,
  endRatio: number
) {
  const start = Math.max(0, Math.trunc(audioData.length * startRatio));
  const end = Math.min(
    audioData.length,
    Math.trunc(audioData.length * endRatio)
  );
  const rangeLength = end - start;

  if (rangeLength <= 0) return 0;

  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += audioData[i];
  }

  return sum / rangeLength;
}

function getLowFrequency(audioData: Uint8Array) {
  return averageFrequencyRange(audioData, 0, 0.33);
}

function getMidFrequency(audioData: Uint8Array) {
  return averageFrequencyRange(audioData, 0.33, 0.66);
}

function getHighFrequency(audioData: Uint8Array) {
  return averageFrequencyRange(audioData, 0.66, 1);
}

function getAverageFrequency(audioData: Uint8Array) {
  return averageFrequencyRange(audioData, 0, 1);
}
