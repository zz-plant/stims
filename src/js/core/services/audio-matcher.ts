import {
  type VisualSearchRequest,
  VisualSearchResponseSchema,
} from '../edge-contracts.ts';
import { resolveOptionalApiUrl } from './optional-api.ts';

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

/**
 * Turns a profile into query text in the same vocabulary the catalog is
 * described with (see describeFrame in visual-embedding.ts).
 *
 * This used to read `rms` and ignore the other five fields, which left the
 * whole feature with five possible queries — two tracks at equal loudness got
 * byte-identical results regardless of what they actually sounded like.
 * Spectral balance now picks the palette and edge language, and loudness
 * picks the motion language, so the query varies with the music rather than
 * just its volume.
 */
export function describeAudioProfile(profile: AudioProfile): string {
  const { rms, bassEnergy, midEnergy, trebleEnergy, beatIntensity } = profile;

  if (rms < 0.005)
    return 'dominant monochrome neutral, smooth gradients, static';

  // Which band leads decides the colour language. The mapping is a
  // convention, not physics: bass reads warm and heavy, treble reads cool and
  // bright, which is how the catalog's own palettes tend to be described.
  const bands = bassEnergy + midEnergy + trebleEnergy || 1;
  const bassShare = bassEnergy / bands;
  const trebleShare = trebleEnergy / bands;
  const hue =
    bassShare > 0.5
      ? 'red'
      : trebleShare > 0.4
        ? 'cyan'
        : bassShare > trebleShare
          ? 'orange'
          : 'blue';

  const palette =
    rms < 0.02
      ? `monochrome ${hue}`
      : rms < 0.08
        ? `${hue}-dominant palette`
        : `vibrant ${hue}-centered palette`;

  // Treble and transients are where visual busyness comes from.
  const edges =
    trebleShare > 0.35 || beatIntensity > 0
      ? trebleShare > 0.5
        ? 'dense edges'
        : 'moderate edges'
      : 'smooth gradients';

  const motion =
    rms < 0.02
      ? 'subtle motion'
      : rms < 0.06
        ? 'moderate motion'
        : 'high motion';

  return `dominant ${palette}, ${edges}, ${motion}`;
}

export async function searchByAudioProfile(
  profile: AudioProfile,
  signal?: AbortSignal,
): Promise<Array<{ presetId: string; score: number }>> {
  const endpoint = resolveOptionalApiUrl('/api/visual-search');
  if (!endpoint) return [];

  const request: VisualSearchRequest = {
    description: describeAudioProfile(profile),
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) return [];
  // Audio match is a background suggestion, so a malformed body degrades to
  // "no suggestions" rather than throwing into the caller's render path.
  const parsed = VisualSearchResponseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.results : [];
}
