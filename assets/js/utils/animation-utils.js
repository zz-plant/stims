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
function getLowFrequency(audioData) {
  return (
    audioData
      .slice(0, audioData.length * 0.33)
      .reduce((acc, val) => acc + val, 0) /
    (audioData.length * 0.33)
  );
}

function getMidFrequency(audioData) {
  return (
    audioData
      .slice(audioData.length * 0.33, audioData.length * 0.66)
      .reduce((acc, val) => acc + val, 0) /
    (audioData.length * 0.33)
  );
}

function getHighFrequency(audioData) {
  return (
    audioData
      .slice(audioData.length * 0.66)
      .reduce((acc, val) => acc + val, 0) /
    (audioData.length * 0.33)
  );
}

function getAverageFrequency(audioData) {
  return audioData.reduce((acc, val) => acc + val, 0) / audioData.length;
}
