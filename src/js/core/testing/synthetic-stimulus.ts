/**
 * Synthetic audio stimulus profiles for controlled audio->visual transfer
 * characterization (docs/SENSORY_ACCESSIBILITY.md, Layer 1). Each spec is a
 * pure, deterministic function of frame index -> a frequency-bin energy
 * array, plus a scalar "stimulus energy" ground truth for the same frame —
 * so a harness can drive `renderFrames({ stimulus })` and later correlate
 * the *known* input against the *measured* visual response, instead of
 * trying to re-derive the input from noisy pixels.
 *
 * Dependency-free (no DOM, no WebGL) so it's usable both in-page
 * (toy-runtime.ts, inside the real render loop) and in analysis code
 * (Node/Bun, generating ground-truth arrays and in unit tests).
 */

export type StimulusSpec =
  /** Constant energy across all bins — for measuring autonomy: how much a
   * preset moves on its own while the audio genuinely isn't changing. */
  | { type: 'flat'; level: number }
  /** Linear ramp across all bins over the full timeline — for measuring
   * responsiveness: does visual magnitude track driving energy. */
  | { type: 'ramp'; from: number; to: number }
  /** A single raised-cosine pulse across all bins, centered on `atFrame` —
   * for measuring latency (time to visual peak) and persistence (time to
   * decay back to baseline after the pulse ends). */
  | {
      type: 'transient';
      atFrame: number;
      widthFrames: number;
      magnitude: number;
      baseline?: number;
    }
  /** A ramp confined to one third of the spectrum, rest held at baseline —
   * for measuring selectivity: run once per band and compare responsiveness
   * (correlation against this same ramp) between them. Ramping rather than
   * holding a constant level, like `ramp` above, because a response metric
   * built on frame-to-frame change has nothing to correlate against a
   * signal with no variation over time. */
  | {
      type: 'band';
      band: 'bass' | 'mid' | 'treble';
      from: number;
      to: number;
      baseline?: number;
    };

const BAND_RANGES: Record<
  'bass' | 'mid' | 'treble',
  readonly [number, number]
> = {
  bass: [0, 1 / 3],
  mid: [1 / 3, 2 / 3],
  treble: [2 / 3, 1],
};

/** The scalar ground-truth energy this spec drives at a given frame, 0..1. */
export function stimulusEnergyAtFrame(
  spec: StimulusSpec,
  frameIndex: number,
  totalFrames: number,
): number {
  switch (spec.type) {
    case 'flat':
      return spec.level;
    case 'ramp': {
      const t = totalFrames <= 1 ? 1 : frameIndex / (totalFrames - 1);
      return spec.from + (spec.to - spec.from) * t;
    }
    case 'transient': {
      const baseline = spec.baseline ?? 0;
      const distance = Math.abs(frameIndex - spec.atFrame);
      if (distance > spec.widthFrames) return baseline;
      // Raised-cosine: 0 at the pulse edges, 1 at the center. Smooth and
      // differentiable, unlike a discontinuous step, so latency/persistence
      // measurements aren't confounded by an artificial edge transient of
      // their own.
      const shape =
        0.5 * (1 + Math.cos((Math.PI * distance) / spec.widthFrames));
      return baseline + (spec.magnitude - baseline) * shape;
    }
    case 'band': {
      const t = totalFrames <= 1 ? 1 : frameIndex / (totalFrames - 1);
      return spec.from + (spec.to - spec.from) * t;
    }
  }
}

/** The per-bin frequency array this spec produces at a given frame. */
export function generateStimulusFrame(
  spec: StimulusSpec,
  frameIndex: number,
  totalFrames: number,
  bins: number,
): Uint8Array {
  const out = new Uint8Array(bins);
  const energy = stimulusEnergyAtFrame(spec, frameIndex, totalFrames);
  const value = Math.max(0, Math.min(255, Math.round(energy * 255)));

  if (spec.type === 'band') {
    const [start, end] = BAND_RANGES[spec.band];
    const baseline = Math.max(
      0,
      Math.min(255, Math.round((spec.baseline ?? 0) * 255)),
    );
    out.fill(baseline);
    const startBin = Math.floor(start * bins);
    const endBin = Math.floor(end * bins);
    for (let i = startBin; i < endBin; i += 1) out[i] = value;
    return out;
  }

  out.fill(value);
  return out;
}
