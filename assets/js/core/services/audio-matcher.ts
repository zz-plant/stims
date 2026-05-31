export interface AudioProfile {
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
  beatIntensity: number;
  rms: number;
  centroid: number;
}

export function buildAudioProfile(snapshot: {
  audioEnergy?: number;
  fftBands?: number[];
}): AudioProfile {
  const energy = snapshot.audioEnergy ?? 0;

  if (snapshot.fftBands && snapshot.fftBands.length >= 3) {
    const [bass, mid, treble] = snapshot.fftBands;
    return {
      bassEnergy: bass,
      midEnergy: mid,
      trebleEnergy: treble,
      beatIntensity: energy > 0.04 ? 1 : 0,
      rms: energy,
      centroid: 500 + energy * 2000,
    };
  }

  return {
    bassEnergy: energy * 0.6,
    midEnergy: energy * 0.3,
    trebleEnergy: energy * 0.1,
    beatIntensity: energy > 0.04 ? 1 : 0,
    rms: energy,
    centroid: 500 + energy * 2000,
  };
}

export function describeAudioProfile(profile: AudioProfile): string {
  const { rms } = profile;

  if (rms < 0.005) return 'silent';

  const intensity =
    rms < 0.02 ? 'quiet calm ambient slow drift' :
    rms < 0.06 ? 'moderate gentle pulsing smooth motion' :
    rms < 0.12 ? 'energetic driving rhythmic dynamic motion' :
    'intense aggressive chaotic explosive heavy';

  return intensity;
}

export async function searchByAudioProfile(
  profile: AudioProfile,
): Promise<Array<{ presetId: string; score: number }>> {
  const description = describeAudioProfile(profile);
  const res = await fetch('/api/visual-search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results: Array<{ presetId: string; score: number }>;
  };
  return data.results || [];
}
