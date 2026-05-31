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
}): AudioProfile {
  const energy = snapshot.audioEnergy ?? 0;
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
  const parts: string[] = [];
  if (profile.beatIntensity > 0) parts.push('rhythmic with beats');
  if (profile.bassEnergy > 0.1) parts.push('strong bass');
  if (profile.midEnergy > 0.1) parts.push('moderate mids');
  if (profile.trebleEnergy > 0.05) parts.push('crisp treble');
  if (profile.rms < 0.02) parts.push('quiet');
  else if (profile.rms > 0.1) parts.push('loud');
  return parts.join(', ') || 'ambient';
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
