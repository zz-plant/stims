// animation-utils.js

// Function to apply audio-driven rotation based on different frequency bands
export function applyAudioRotation(
  object,
  audioData,
  rotationSpeed,
  band = 'average'
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
  object,
  audioData,
  scaleFactor,
  band = 'average'
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
  audioData,
  startRatio,
  endRatio,
  denominatorRatio = endRatio - startRatio
) {
  const start = Math.trunc(audioData.length * startRatio);
  const end = Math.trunc(audioData.length * endRatio);
  const slice = audioData.slice(start, end);
  const sum = slice.reduce((acc, val) => acc + val, 0);
  const rangeLength = audioData.length * denominatorRatio;
  return sum / rangeLength;
}

function getLowFrequency(audioData) {
  return averageFrequencyRange(audioData, 0, 0.33, 0.33);
}

function getMidFrequency(audioData) {
  return averageFrequencyRange(audioData, 0.33, 0.66, 0.33);
}

function getHighFrequency(audioData) {
  return averageFrequencyRange(audioData, 0.66, 1, 0.33);
}

function getAverageFrequency(audioData) {
  return averageFrequencyRange(audioData, 0, 1, 1);
}
