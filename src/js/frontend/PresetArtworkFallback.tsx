/**
 * Generated stand-in artwork for a preset that has no thumbnail.
 *
 * Most of the catalog has no preview PNG in R2, and the fallback used to be
 * one of seven mood gradients plus the mood's name in text. Seven gradients
 * across 2,679 presets means a screen of browse tiles is the same navy square
 * repeated a dozen times: the grid stopped being a way to choose and became a
 * list with decoration. A caption already says the name and the credit, so
 * repeating the mood as words spent the art slot on text.
 *
 * So draw something per preset instead. Every visual property here is derived
 * from a hash of the preset id, which makes the artwork deterministic (the
 * same preset is the same picture on every device, every session, with no
 * network and no storage) while giving each entry its own silhouette, hue and
 * rhythm. The mood still chooses the palette anchor, so presets of a kind
 * still read as a family — individual members of a recognisable group, rather
 * than 2,679 unrelated pictures or one picture 2,679 times.
 *
 * The motif is the landing page's signal trace: layered waveforms over a
 * bloom. That is deliberate. A preset is a thing that turns sound into a
 * picture, and the same drawing already introduces the product on the home
 * page, so the placeholder reads as part of the product rather than as the
 * absence of a thumbnail.
 *
 * Cost matters — the browse grid is virtualized and mounts dozens of these
 * during a fast scroll. It is one memoized component rendering four static
 * paths from integer math: no canvas, no WebGL, no images, no animation.
 */
import { memo } from 'react';

export type PresetArtworkTone =
  | 'bright'
  | 'geometry'
  | 'space'
  | 'moody'
  | 'psychedelic'
  | 'classic'
  | 'instant';

/**
 * Hue anchor and spread per mood, in degrees.
 *
 * The anchor sets the family; the spread is how far individual presets in
 * that family may drift from it. Tight spreads (space, moody) keep a
 * recognisable group; psychedelic is deliberately wide because that is the
 * character of the group.
 */
const TONE_HUES: Record<PresetArtworkTone, { anchor: number; spread: number }> =
  {
    bright: { anchor: 38, spread: 40 },
    geometry: { anchor: 196, spread: 38 },
    space: { anchor: 224, spread: 44 },
    moody: { anchor: 280, spread: 40 },
    psychedelic: { anchor: 320, spread: 74 },
    classic: { anchor: 16, spread: 44 },
    /* "Instant pick" is the catch-all the mood classifier falls back to, so it
       holds the largest and least related share of the catalog. It gets the
       widest spread of any named mood for that reason: there is no family here
       to keep recognisable, only presets that matched no keyword. */
    instant: { anchor: 172, spread: 96 },
  };

/**
 * FNV-1a. Chosen over the `hash = hash * 31 + c` idiom used elsewhere in the
 * app because that one leaves the low bits barely mixed for short, similar
 * strings — and preset ids are exactly that ("krash-1", "krash-2"), which is
 * the case this whole component exists to tell apart.
 */
function hashPresetId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Pull `bits` bits starting at `offset`, as a 0..1 fraction. */
function slice(hash: number, offset: number, bits: number): number {
  const mask = (1 << bits) - 1;
  return ((hash >>> offset) & mask) / mask;
}

/**
 * A single waveform across the 0..120 viewBox.
 *
 * Sampled every 3 units rather than every 6: a tile is ~165px wide, so a
 * 6-unit step puts a vertex roughly every 8 screen pixels, and a polyline
 * through those at the higher frequencies read as an EKG zigzag instead of a
 * wave. 41 points is still trivial to draw and the curve looks continuous at
 * every size the art slot is used.
 */
function wavePath(
  frequency: number,
  amplitude: number,
  phase: number,
  centre: number,
  harmonic: number,
): string {
  const points: string[] = [];
  for (let x = 0; x <= 120; x += 3) {
    const t = (x / 120) * Math.PI * 2;
    const y =
      centre +
      Math.sin(t * frequency + phase) * amplitude +
      Math.sin(t * frequency * harmonic + phase * 1.7) * (amplitude * 0.4);
    points.push(`${x},${y.toFixed(2)}`);
  }
  return `M${points.join(' L')}`;
}

export const PresetArtworkFallback = memo(function PresetArtworkFallback({
  presetId,
  tone,
}: {
  presetId: string;
  tone: PresetArtworkTone;
}) {
  const hash = hashPresetId(presetId);
  const { anchor, spread } = TONE_HUES[tone];

  // Every draw parameter reads a different slice of the hash, so two presets
  // that happen to share one trait rarely share the next.
  const hue = Math.round(anchor + (slice(hash, 0, 8) - 0.5) * 2 * spread);
  const accentHue = Math.round(hue + 40 + slice(hash, 8, 6) * 120);
  const frequency = 1 + Math.round(slice(hash, 14, 4) * 3);
  const harmonic = 2 + Math.round(slice(hash, 18, 3) * 3);
  const amplitude = 9 + slice(hash, 21, 5) * 15;
  const phase = slice(hash, 26, 6) * Math.PI * 2;
  const bloomX = 22 + slice(hash, 4, 6) * 76;
  const bloomY = 26 + slice(hash, 11, 5) * 48;
  const tilt = Math.round((slice(hash, 17, 5) - 0.5) * 24);

  // Unique per preset: two tiles mounted at once must not share gradient ids,
  // or the second one silently adopts the first one's fill.
  const uid = `pa-${hash.toString(36)}`;

  return (
    <svg
      className="stims-shell__preset-art-generated"
      viewBox="0 0 120 90"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${uid}-bloom`} cx="50%" cy="50%" r="50%">
          <stop
            offset="0%"
            stopColor={`hsl(${accentHue} 90% 68%)`}
            stopOpacity="0.62"
          />
          <stop
            offset="100%"
            stopColor={`hsl(${accentHue} 90% 60%)`}
            stopOpacity="0"
          />
        </radialGradient>
        <linearGradient id={`${uid}-ground`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={`hsl(${hue} 46% 22%)`} />
          <stop offset="100%" stopColor={`hsl(${hue} 54% 7%)`} />
        </linearGradient>
      </defs>

      <rect width="120" height="90" fill={`url(#${uid}-ground)`} />
      <ellipse
        cx={bloomX}
        cy={bloomY}
        rx="46"
        ry="38"
        fill={`url(#${uid}-bloom)`}
      />

      <g transform={`rotate(${tilt} 60 45)`}>
        <path
          d={wavePath(frequency, amplitude * 0.72, phase + 1.1, 45, harmonic)}
          fill="none"
          stroke={`hsl(${accentHue} 88% 72%)`}
          strokeWidth="1.6"
          strokeOpacity="0.5"
          strokeLinecap="round"
        />
        <path
          d={wavePath(frequency, amplitude, phase, 45, harmonic)}
          fill="none"
          stroke={`hsl(${hue} 92% 78%)`}
          strokeWidth="2.1"
          strokeOpacity="0.92"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
});
